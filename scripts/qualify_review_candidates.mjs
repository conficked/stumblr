#!/usr/bin/env node
/** Evidence only. Direct browser frames preserve destination XFO/CSP enforcement. */
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { chromium, devices } from "playwright";
import { getQualificationUrlIdentity } from "../src/lib/catalogue/destinationIdentity.mjs";
import {
  FRAME_SANDBOX,
  FRAME_PERMISSIONS_POLICY,
  LOAD_TIMEOUT_MS,
} from "../src/components/frame-host/framePolicies.ts";

import {
  MAX_QUALIFICATION_FINAL_URL_LENGTH,
  OVERSIZED_QUALIFICATION_FINAL_URL_REASON,
} from "../src/lib/catalogue/qualificationLimits.ts";

// Only this empty harness is fulfilled locally; destination responses are untouched.
export const HARNESS_PATH = "/__review_qualification_harness";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const READINESS_GRACE_MS = 600;
const READINESS_POLL_MS = 50;
const SAFE_CONTROL_SELECTOR = 'button[type="button"]:visible:not([disabled]), input[type="checkbox"]:visible:not([disabled]), summary:visible';
const POLICY_BLOCKED_NAVIGATION = /^net::ERR_BLOCKED_BY_(?:RESPONSE|CSP)$/;

function boundedInteger(value, name, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return number;
}

function options(args) {
  const [input, output, ...flags] = args;
  if (!input || !output || flags.length % 2) throw new Error("usage: qualify_review_candidates.mjs INPUT OUTPUT --max-candidates N [--timeout-ms N] [--budget-ms N]");
  if (path.resolve(input) === path.resolve(output)) throw new Error("output must differ from the candidate artifact");
  const values = new Map();
  for (let i = 0; i < flags.length; i += 2) {
    if (!["--max-candidates", "--timeout-ms", "--budget-ms", "--host-origin", "--fixture-origins"].includes(flags[i]) || values.has(flags[i])) throw new Error("unknown or duplicate option");
    values.set(flags[i], flags[i + 1]);
  }
  // Fixture exceptions are explicit exact origins, never a blanket private-net bypass.
  let origin = "https://stumblr.dev";
  const fixtureOrigins = new Set();
  if (values.has("--host-origin") || values.has("--fixture-origins")) {
    if (!values.has("--host-origin") || !values.has("--fixture-origins")) throw new Error("fixture mode requires host and destination origins");
    const declared = JSON.parse(values.get("--fixture-origins"));
    if (!Array.isArray(declared) || !declared.length || declared.length > 8) throw new Error("invalid fixture origin list");
    for (const value of [...declared, values.get("--host-origin")]) {
      const local = new URL(value);
      if (local.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(local.hostname)
        || local.username || local.password || local.pathname !== "/" || local.search || local.hash) {
        throw new Error("fixture origins must be credential-free literal HTTP loopback origins");
      }
    }
    declared.forEach((value) => fixtureOrigins.add(new URL(value).origin));
    origin = new URL(values.get("--host-origin")).origin;
    if (!fixtureOrigins.has(origin)) throw new Error("fixture host must be declared");
  }
  return {
    input, output, harness: origin + HARNESS_PATH, fixtureOrigins,
    maximum: boundedInteger(values.get("--max-candidates"), "max-candidates", 220),
    timeout: boundedInteger(values.get("--timeout-ms") ?? LOAD_TIMEOUT_MS, "timeout-ms", 30000),
    budget: boundedInteger(values.get("--budget-ms") ?? 120000, "budget-ms", 300000),
  };
}

// Product landing pages, not something to stumble onto. Only unambiguous
// sales language: subscription prices and app-store links also appear on
// donation-funded and hobby sites.
const COMMERCIAL_TEXT = /\b(?:(?:see|view|plans (?:and|&)) pricing|pricing plans|free trial|(?:book|request|get|schedule) a demo|(?:talk to|contact) sales|download for (?:mac|macos|windows)|join (?:the )?waitlist)\b/i;

function observation(url, device) {
  return {
    canonical_url: url,
    render_result: "error",
    meaningful_text_length: 0,
    document_http_status: null,
    final_url_identity: null,
    functionality_result: "not_demonstrated",
    network_failure_reasons: [],
    interaction_evidence: { attempted: false, visible_state_changed: false },
    observed_at: new Date().toISOString(),
    device,
    console_failure_reasons: [],
    frame_failure_reasons: [],
    commercial_signal: false,
  };
}

function record(list, reason) {
  if (list.length < 20) list.push(String(reason).slice(0, 300));
}

// Fail closed on special-use IPv4 ranges and non-global IPv6 (including mapped
// IPv4, transition/NAT64, documentation and reserved allocation space).
const forbidden = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) forbidden.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) forbidden.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !forbidden.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !forbidden.check(address, "ipv6");
}
function hostKey(url) { return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`; }
function checkURL(raw, config) {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("credentials_disallowed");
  if (config.fixtureOrigins.has(url.origin)) return url;
  if (url.protocol !== "https:") throw new Error("https_required");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || /(?:^|\.)(?:local|internal|arpa)$/.test(host)) throw new Error("local_hostname_disallowed");
  if (isIP(host) && !publicAddress(host)) throw new Error("non_public_ip");
  return url;
}
async function resolvePin(url, config, deadline) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (config.fixtureOrigins.has(url.origin)) return { address: host, family: isIP(host) };
  if (isIP(host)) return { address: host, family: isIP(host) };
  let timer;
  try {
    const addresses = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("dns_timeout")), Math.max(1, Math.min(2000, deadline - Date.now()))); }),
    ]);
    if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new Error("non_public_dns_answer");
    return addresses[0];
  } catch (error) {
    if (error.code === "ENOTFOUND") throw new Error("dns_not_found");
    throw error;
  } finally { clearTimeout(timer); }
}
async function preflightHeaders(url, pin, deadline) {
  if (Date.now() >= deadline) throw new Error("preflight_timeout");
  const signal = AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now())));
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET", agent: false, signal, maxHeaderSize: 16384,
      servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? "" : url.hostname,
      // The browser and preflight both use the validated address, avoiding a
      // second DNS resolution/rebinding window while preserving Host/TLS SNI.
      lookup: (_hostname, opts, callback) => opts.all ? callback(null, [pin]) : callback(null, pin.address, pin.family),
      headers: { "User-Agent": "StumblrReviewQualifier/1.0", Connection: "close" },
    }, (response) => {
      const headers = { status: response.statusCode, location: response.headers.location };
      response.destroy(); // Header-only preflight: never accumulate destination bodies.
      resolve(headers);
    });
    request.on("error", () => reject(new Error(signal.aborted ? "preflight_timeout" : "preflight_connection_failed")));
    request.end();
  });
}
async function preflight(raw, config, deadline) {
  const plan = { origins: new Set(), pins: new Map() };
  for (const fixture of config.fixtureOrigins) {
    const url = new URL(fixture);
    plan.origins.add(url.origin);
    plan.pins.set(hostKey(url), { address: url.hostname.replace(/^\[|\]$/g, ""), family: isIP(url.hostname.replace(/^\[|\]$/g, "")) });
  }
  let rawURL = raw;
  const initialOrigin = new URL(raw).origin;
  for (let hop = 0; hop < 6; hop += 1) {
    if (config.sameOriginRedirects && new URL(rawURL).origin !== initialOrigin) throw new Error("cross_origin_redirect");
    const url = checkURL(rawURL, config);
    const pin = await resolvePin(url, config, deadline);
    plan.origins.add(url.origin);
    plan.pins.set(hostKey(url), pin);
    const headers = await preflightHeaders(url, pin, deadline);
    if (!REDIRECT_STATUSES.has(headers.status) || !headers.location) return plan;
    rawURL = new URL(headers.location, url).href;
  }
  throw new Error("redirect_limit");
}
function resolverRules(plan) {
  return [...plan.pins].map(([host, pin]) => `MAP ${host} ${pin.family === 6 ? `[${pin.address}]` : pin.address}:${host.slice(host.lastIndexOf(":") + 1)}`).concat("MAP * ~NOTFOUND").join(", ");
}

// Raw child CDP sessions preserve Fetch interception across OOPIFs and workers.
// Pause new targets before scripts execute; unsupported targets are closed.
function childSession(parent, sessionId) {
  let next = 0;
  const pending = new Map();
  const listeners = new Map();
  parent.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const packet = JSON.parse(event.message);
    if (packet.id) {
      const entry = pending.get(packet.id);
      if (!entry) return;
      pending.delete(packet.id);
      clearTimeout(entry.timer);
      if (packet.error) entry.reject(new Error("child_protocol_failed")); else entry.resolve(packet.result);
    } else {
      for (const callback of listeners.get(packet.method) ?? []) callback(packet.params);
    }
  });
  return {
    on(method, callback) { listeners.set(method, [...listeners.get(method) ?? [], callback]); },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("child_protocol_timeout")); }, 1000);
        pending.set(id, { resolve, reject, timer });
        parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(() => { clearTimeout(timer); pending.delete(id); reject(new Error("child_target_closed")); });
      });
    },
  };
}
async function installGuard(context, page, url, row, navigation, plan, config) {
  const root = await context.newCDPSession(page);
  const initial = new URL(url);
  initial.hash = "";
  async function install(session) {
    session.on("Fetch.requestPaused", (event) => {
      void (async () => {
        const document = event.resourceType === "Document";
        if (document && event.request.url === initial.href && !navigation.cdpFrameId) navigation.cdpFrameId = event.frameId;
        // Only the empty first-party harness is synthesized. Destination responses stay untouched.
        if ((!config.fixtureOrigins.size || config.proofFramePolicy) && event.request.url === config.harness) {
          const responseHeaders = [{ name: "Content-Type", value: "text/html" }];
          if (config.proofFramePolicy) responseHeaders.push({ name: "Content-Security-Policy", value: config.proofFramePolicy });
          await session.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, responseHeaders, body: Buffer.from("<!doctype html><html><body style='margin:0'></body></html>").toString("base64") });
          return;
        }
        const candidate = document && event.frameId === navigation.cdpFrameId;
        let blockedReason;
        try {
          const requested = checkURL(event.request.url, config);
          if (config.sameOriginRedirects && candidate && requested.origin !== initial.origin) blockedReason = "cross_origin_redirect";
          else if (!plan.origins.has(requested.origin) || !plan.pins.has(hostKey(requested))) blockedReason = "outside validated HTTPS/public origins";
        } catch {
          blockedReason = "outside validated HTTPS/public origins";
        }
        if (!blockedReason) {
          await session.send("Fetch.continueRequest", { requestId: event.requestId });
          return;
        }
        const kind = candidate ? "candidate" : document ? "nested" : "resource";
        record(row.network_failure_reasons, blockedReason === "cross_origin_redirect"
          ? "candidate: cross_origin_redirect" : `${kind}: blocked ${event.resourceType} ${blockedReason}`);
        if (candidate) navigation.networkBlocked = true;
        else if (!document) navigation.resourceBlocked = true;
        await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      })().catch(() => { navigation.guardFailed = true; void context.close().catch(() => {}); });
    });
    session.on("Target.attachedToTarget", (event) => {
      const child = childSession(session, event.sessionId);
      void install(child).then(() => child.send("Runtime.runIfWaitingForDebugger")).catch(() => {
        record(row.network_failure_reasons, "resource: unsupported browser target closed before execution");
        navigation.resourceBlocked = true;
        void root.send("Target.closeTarget", { targetId: event.targetInfo.targetId }).catch(() => {});
      });
    });
    await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await session.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  }
  await install(root);
  await context.routeWebSocket("**", (socket) => {
    record(row.network_failure_reasons, "resource: WebSocket transport disabled");
    navigation.resourceBlocked = true;
    socket.close();
  });
  // WebRTC is not an HTTP request and must not become an alternate egress path.
  await context.exposeBinding("__stumblrQualificationTransportBlocked", () => {
    record(row.network_failure_reasons, "resource: alternate transport disabled");
    navigation.resourceBlocked = true;
  });
  await context.addInitScript(() => {
    const report = window.__stumblrQualificationTransportBlocked;
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
      Object.defineProperty(window, name, { configurable: false, writable: false, value: class { constructor() { void report().catch(() => {}); throw new Error("Transport disabled during browser qualification"); } } });
    }
  });
}

async function inspect(page, url, row, timeout, config, navigation, plan, deadline) {
  // Identify the candidate by its Frame object, not URL or page-wide console
  // messages: destinations may contain their own blocked or failing frames.
  page.on("frameattached", (frame) => {
    if (!navigation.frame && frame.parentFrame() === page.mainFrame()) navigation.frame = frame;
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/x-frame-options/i.test(text)) record(row.console_failure_reasons, "browser x-frame-options error");
    else if (/frame-ancestors/i.test(text)) record(row.console_failure_reasons, "browser frame-ancestors error");
    else record(row.console_failure_reasons, "browser console error");
  });
  page.on("pageerror", () => record(row.console_failure_reasons, "page script error"));
  page.on("requestfailed", (request) => {
    if (!request.isNavigationRequest()) return;
    const failure = request.failure()?.errorText;
    const reason = failure && /^net::ERR_[A-Z0-9_]+$/.test(failure) ? failure : "frame navigation failed";
    const candidate = navigation.frame !== null && request.frame() === navigation.frame;
    record(row.frame_failure_reasons, `${candidate ? "candidate" : "nested"}: ${reason}`);
    if (candidate) {
      navigation.failed = true;
      navigation.denied ||= POLICY_BLOCKED_NAVIGATION.test(reason);
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    // Only redirect responses with a usable next hop are intermediates. Other
    // 3xx responses are terminal documents whose status must remain evidence.
    const redirectIntermediate = REDIRECT_STATUSES.has(response.status()) && Boolean(response.headers().location);
    if (request.isNavigationRequest() && navigation.frame && request.frame() === navigation.frame && !redirectIntermediate) {
      row.document_http_status = response.status();
      const finalUrl = response.url();
      navigation.oversizedFinalUrl = finalUrl.length > MAX_QUALIFICATION_FINAL_URL_LENGTH;
      row.final_url_identity = navigation.oversizedFinalUrl ? null : getQualificationUrlIdentity(finalUrl);
    }
  });
  await installGuard(page.context(), page, url, row, navigation, plan, config);
  // Popups never become a second destination under observation.
  page.context().on("page", (popup) => { if (popup !== page) void popup.close(); });
  await page.goto(config.harness, { waitUntil: "domcontentloaded", timeout });
  const loaded = await page.evaluate(({ url, sandbox, permissions, timeout, detectFrameCsp }) => new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", sandbox);
    frame.setAttribute("allow", permissions);
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.style.cssText = "border:0;width:100vw;height:100vh;display:block";
    let loadTimer;
    const settle = (result) => {
      clearTimeout(timer);
      clearTimeout(loadTimer);
      resolve(result);
    };
    const timer = setTimeout(() => settle("timeout"), timeout);
    if (detectFrameCsp) {
      document.addEventListener("securitypolicyviolation", (event) => {
        if (event.effectiveDirective === "frame-src") settle("csp_denied");
      });
    }
    // Chromium can fire a blocked iframe's load event before its CSP violation event.
    frame.onload = () => {
      if (detectFrameCsp) loadTimer = setTimeout(() => settle("loaded"), 75);
      else settle("loaded");
    };
    frame.onerror = () => settle("error");
    frame.src = url;
    document.body.append(frame);
  }), { url, sandbox: FRAME_SANDBOX, permissions: FRAME_PERMISSIONS_POLICY, timeout, detectFrameCsp: Boolean(config.proofFramePolicy) });
  if (loaded === "timeout") {
    row.render_result = "timeout";
    record(row.frame_failure_reasons, "frame load timeout");
    return;
  }
  if (loaded === "csp_denied" || navigation.denied) {
    navigation.denied = true;
    row.render_result = "frame_denied";
    record(row.frame_failure_reasons, "browser enforced destination frame policy");
    return;
  }
  const handle = await page.locator("iframe").elementHandle();
  const frame = await handle?.contentFrame();
  if (loaded === "error" || !frame || frame.url().startsWith("chrome-error:") || navigation.failed) {
    record(row.frame_failure_reasons, "frame navigation failed");
    return;
  }
  if (row.document_http_status >= 300) {
    row.render_result = "http_error";
    record(row.frame_failure_reasons, `candidate: HTTP ${row.document_http_status}`);
    return;
  }
  // Hydration may finish after iframe load. Observe blank/visual-only shells
  // briefly, reserving time inside the existing deadline for one control probe.
  const readyBy = Math.min(Date.now() + READINESS_GRACE_MS, deadline - 200);
  let text = "";
  let loginOnly = false;
  while (true) {
    if (navigation.networkBlocked || navigation.guardFailed || navigation.denied || navigation.failed || row.document_http_status >= 300) return;
    // innerText excludes hidden content. Text is counted, never retained.
    text = (await frame.locator("body").innerText({ timeout: Math.max(1, deadline - Date.now()) })).replace(/\s+/g, " ").trim();
    row.meaningful_text_length = text.length;
    row.commercial_signal = COMMERCIAL_TEXT.test(text);
    const password = frame.locator('input[type="password"]:visible');
    const authControl = frame.locator('input[type="email"]:visible, button:visible, a:visible');
    loginOnly = text.length < 500 && ((await password.count()) > 0 || (/\b(sign[ -]?in|log[ -]?in|continue with|authenticate)\b/i.test(text) && (await authControl.count()) > 0));
    const visual = text.length < 40 ? await frame.locator("canvas:visible, video:visible, svg:visible, img:visible").count() : 0;
    row.render_result = loginOnly ? "login_only" : text.length >= 40 ? "text_observed" : visual ? "inconclusive" : "blank";
    row.functionality_result = row.render_result === "inconclusive" ? "inconclusive" : "not_demonstrated";
    if (!["blank", "inconclusive"].includes(row.render_result) || Date.now() >= readyBy || await frame.locator(SAFE_CONTROL_SELECTOR).count()) break;
    await page.waitForTimeout(Math.min(READINESS_POLL_MS, Math.max(0, readyBy - Date.now())));
  }
  if (loginOnly || navigation.networkBlocked || navigation.guardFailed || navigation.denied || navigation.failed || row.document_http_status >= 300) return;

  // Avoid submit buttons, links and authentication flows. Try at most one control.
  const control = frame.locator(SAFE_CONTROL_SELECTOR).first();
  if (await control.count()) {
    row.interaction_evidence.attempted = true;
    const before = await control.isChecked().catch(() => null);
    try {
      await control.click({ timeout: Math.max(1, Math.min(timeout, 1500, deadline - Date.now())) });
      await page.waitForTimeout(Math.max(0, Math.min(150, deadline - Date.now())));
      const afterText = (await frame.locator("body").innerText({ timeout })).replace(/\s+/g, " ").trim();
      const after = await control.isChecked().catch(() => null);
      row.interaction_evidence.visible_state_changed = text !== afterText || (before !== null && after !== null && before !== after);
      if (row.interaction_evidence.visible_state_changed) {
        row.render_result = "interaction_observed";
        row.functionality_result = "demonstrated";
      }
    } catch {
      record(row.frame_failure_reasons, "interaction unavailable or timed out");
    }
  }
}

async function qualify(browser, url, device, timeout, config, plan) {
  const row = observation(url, device);
  const navigation = { frame: null, oversizedFinalUrl: false, failed: false, denied: false, cdpFrameId: null, networkBlocked: false, resourceBlocked: false, guardFailed: false };
  const context = await browser.newContext(device === "mobile"
    ? { ...devices["Pixel 7"], viewport: { width: 400, height: 985 }, serviceWorkers: "block" }
    : { viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
  let timer;
  try {
    const page = await context.newPage();
    const deadline = Date.now() + timeout;
    await Promise.race([
      inspect(page, url, row, timeout, config, navigation, plan, deadline),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          row.render_result = "timeout";
          record(row.frame_failure_reasons, "per-observation time budget exhausted");
          resolve();
        }, timeout);
      }),
    ]);
  } catch (error) {
    record(row.frame_failure_reasons, error.name === "TimeoutError" ? "browser operation timed out" : "browser operation failed");
    if (error.name === "TimeoutError") row.render_result = "timeout";
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
  }
  // Candidate failures retain priority over diagnostic failures in child frames.
  if (navigation.networkBlocked || navigation.guardFailed) {
    row.render_result = "network_blocked";
  } else if (navigation.denied) {
    row.render_result = "frame_denied";
    if (!row.frame_failure_reasons.includes("browser enforced destination frame policy")) record(row.frame_failure_reasons, "browser enforced destination frame policy");
  } else if (row.document_http_status >= 300) {
    row.render_result = "http_error";
    row.functionality_result = "not_demonstrated";
  } else if (navigation.failed && row.render_result !== "timeout") {
    row.render_result = "error";
  }
  // Keep the observation usable if a destination constructs an unusually long
  // terminal URL. An omitted identity cannot support a positive qualification.
  if (navigation.oversizedFinalUrl) {
    if (["text_observed", "interaction_observed"].includes(row.render_result)) {
      row.render_result = "inconclusive";
      row.functionality_result = "inconclusive";
    }
    record(row.frame_failure_reasons, OVERSIZED_QUALIFICATION_FINAL_URL_REASON);
  }
  return row;
}

export async function observeCandidates(urls, config) {
  const rows = [];
  const deadline = Date.now() + config.budget;
  for (const url of urls) {
    let plan;
    let preflightError;
    if (Date.now() < deadline) {
      try { plan = await preflight(url, config, Math.min(deadline, Date.now() + config.timeout)); }
      catch (error) { preflightError = error.message; }
    }
    let browser;
    try {
      if (plan && Date.now() < deadline) {
        browser = await chromium.launch({ headless: true, timeout: Math.min(deadline - Date.now(), 30000), args: [
          `--host-resolver-rules=${resolverRules(plan)}`, "--no-proxy-server", "--disable-quic", "--disable-background-networking",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          // A synthetic harness has public address space even on loopback. Allow only
          // explicitly pinned loopback fixture origins through the existing request guard.
          ...(config.fixtureOrigins.size && config.proofFramePolicy ? ["--disable-features=LocalNetworkAccessChecks"] : []),
        ] });
      }
      for (const device of ["desktop", "mobile"]) {
        const remaining = deadline - Date.now();
        if (remaining <= 0 || !plan) {
          const row = observation(url, device);
          row.render_result = remaining <= 0 ? "budget_exhausted" : preflightError === "preflight_timeout" ? "timeout" : "network_blocked";
          if (row.render_result === "network_blocked") record(row.network_failure_reasons, `candidate: ${preflightError ?? "preflight_not_completed"}`);
          else record(row.frame_failure_reasons, row.render_result === "timeout" ? "candidate: preflight timeout" : "whole-run time budget exhausted; not observed");
          rows.push(row);
        } else {
          rows.push(await qualify(browser, url, device, Math.min(config.timeout, remaining), config, plan));
        }
      }
    } finally { if (browser) await browser.close(); }
  }
  return rows;
}

async function main() {
  const config = options(process.argv.slice(2));
  if ((await stat(config.input)).size > MAX_INPUT_BYTES) throw new Error("candidate artifact exceeds 5 MiB");
  const candidates = JSON.parse(await readFile(config.input, "utf8"));
  if (!Array.isArray(candidates)) throw new Error("candidate artifact must be an array");
  const urls = candidates.slice(0, config.maximum).map((candidate) => {
    if (typeof candidate?.canonical_url !== "string") throw new Error("candidate URL missing");
    return candidate.canonical_url;
  });
  const rows = await observeCandidates(urls, config);
  // Exclusive creation also prevents overwriting an existing review DB or artifact.
  await writeFile(config.output, `${JSON.stringify(rows, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ observations: rows.length, evidence_only: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Do not log candidate URLs, destination bodies, or environment credentials.
    console.error("Candidate qualification failed; verify arguments, input artifact and browser installation.");
    process.exitCode = 1;
  });
}
