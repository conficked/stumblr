import type { NextRequest } from "next/server";

type RuntimeEnv = Record<string, string | undefined>;

type DeploymentOriginConfig =
  | { ok: true; origin: string | null }
  | { ok: false };

function canonicalHttpsOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== value ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function readDeploymentOriginConfig(env: RuntimeEnv): DeploymentOriginConfig {
  const explicit = env.STUMBLR_EXPECTED_ORIGIN;
  if (explicit !== undefined) {
    const url = canonicalHttpsOrigin(explicit);
    return url ? { ok: true, origin: url.origin } : { ok: false };
  }

  if (env.RENDER !== "true") return { ok: true, origin: null };

  const automatic = env.RENDER_EXTERNAL_URL;
  if (!automatic) return { ok: false };
  const url = canonicalHttpsOrigin(automatic);
  if (
    !url ||
    url.port ||
    !url.hostname.endsWith(".onrender.com") ||
    url.hostname === "onrender.com"
  ) {
    return { ok: false };
  }
  return { ok: true, origin: url.origin };
}

export function validateSameOriginJson(
  request: NextRequest,
  env: RuntimeEnv = process.env,
): Response | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return Response.json({ ok: false, code: "unsupported_media_type" }, { status: 415 });
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return Response.json({ ok: false, code: "origin_required" }, { status: 403 });
  }
  try {
    const deploymentOrigin = readDeploymentOriginConfig(env);
    const allowedOrigin = deploymentOrigin.ok
      ? deploymentOrigin.origin ?? request.nextUrl.origin
      : null;
    if (!allowedOrigin || new URL(origin).origin !== origin || origin !== allowedOrigin) {
      return Response.json({ ok: false, code: "origin_denied" }, { status: 403 });
    }
  } catch {
    return Response.json({ ok: false, code: "origin_denied" }, { status: 403 });
  }
  return null;
}
