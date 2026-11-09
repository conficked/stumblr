import { afterEach, expect, test } from "vitest";
import { buildHealthResponse } from "@/lib/security/readiness";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test("health reports process/config readiness without app or database details", async () => {
  process.env.STUMBLR_BASIC_AUTH_USERNAME = "preview-user";
  process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256 =
    "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=";
  const response = buildHealthResponse(process.env);
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("health fails when auth configuration is unavailable", async () => {
  delete process.env.STUMBLR_BASIC_AUTH_USERNAME;
  delete process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256;
  expect(buildHealthResponse(process.env).status).toBe(503);
});

test("health accepts Render's validated automatic external URL", () => {
  process.env.STUMBLR_BASIC_AUTH_USERNAME = "preview-user";
  process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256 =
    "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=";
  process.env.RENDER = "true";
  process.env.RENDER_EXTERNAL_URL = "https://stumblr-private-preview.onrender.com";
  delete process.env.STUMBLR_EXPECTED_ORIGIN;

  expect(buildHealthResponse(process.env).status).toBe(204);
});

test.each([undefined, "http://stumblr-private-preview.onrender.com", "https://preview.example"])(
  "health fails closed on Render when the automatic external URL is %s",
  (renderExternalUrl) => {
    process.env.STUMBLR_BASIC_AUTH_USERNAME = "preview-user";
    process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256 =
      "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=";
    process.env.RENDER = "true";
    if (renderExternalUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = renderExternalUrl;
    delete process.env.STUMBLR_EXPECTED_ORIGIN;

    expect(buildHealthResponse(process.env).status).toBe(503);
  },
);

test("health does not fall back when an explicit origin override is malformed", () => {
  process.env.STUMBLR_BASIC_AUTH_USERNAME = "preview-user";
  process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256 =
    "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=";
  process.env.STUMBLR_EXPECTED_ORIGIN = "";
  process.env.RENDER = "true";
  process.env.RENDER_EXTERNAL_URL = "https://stumblr-private-preview.onrender.com";

  expect(buildHealthResponse(process.env).status).toBe(503);
});
