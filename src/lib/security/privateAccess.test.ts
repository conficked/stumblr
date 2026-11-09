import { describe, expect, test } from "vitest";
import {
  authorizeBasicHeader,
  readPrivateAccessConfig,
} from "./privateAccess";

const validEnv = {
  STUMBLR_BASIC_AUTH_USERNAME: "preview-user",
  STUMBLR_BASIC_AUTH_PASSWORD_SHA256:
    "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=",
};

describe("readPrivateAccessConfig", () => {
  test.each([
    {},
    { STUMBLR_BASIC_AUTH_USERNAME: "preview-user" },
    {
        STUMBLR_BASIC_AUTH_USERNAME: "preview-user",
        STUMBLR_BASIC_AUTH_PASSWORD_SHA256: "not-base64!",
    },
    {
        STUMBLR_BASIC_AUTH_USERNAME: "bad:user",
        STUMBLR_BASIC_AUTH_PASSWORD_SHA256:
          "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=",
    },
  ])("fails closed for malformed config %#", (env) => {
    expect(readPrivateAccessConfig(env)).toEqual({ ok: false });
  });

  test("accepts an exact 32-byte base64 SHA-256 verifier", () => {
    expect(readPrivateAccessConfig(validEnv)).toMatchObject({
      ok: true,
      username: "preview-user",
    });
  });
});

describe("authorizeBasicHeader", () => {
  const config = readPrivateAccessConfig(validEnv);

  test.each([null, "", "Bearer anything", "Basic !!!", "Basic dXNlcg=="])(
    "rejects missing or malformed header %s",
    (header) => {
      expect(authorizeBasicHeader(header, config)).toBe(false);
    },
  );

  test("rejects wrong credentials", () => {
    const header = `Basic ${Buffer.from("preview-user:wrong").toString("base64")}`;
    expect(authorizeBasicHeader(header, config)).toBe(false);
  });

  test("accepts the configured dummy credentials", () => {
    const header = `Basic ${Buffer.from("preview-user:dummy-password").toString("base64")}`;
    expect(authorizeBasicHeader(header, config)).toBe(true);
  });
});
