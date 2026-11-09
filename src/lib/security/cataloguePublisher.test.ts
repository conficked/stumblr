import { expect, test } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticatePublisher, publisherAudience } from "./cataloguePublisher";
const claims = { repository_id: "1450399070", repository: "conficked/stumblr", ref: "refs/heads/main", workflow_ref: "conficked/stumblr/.github/workflows/catalogue-publish.yml@refs/heads/main", event_name: "workflow_dispatch", sha: "a".repeat(40) };
test("only signed exact main-branch publisher identity is trusted", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const token = (extra = {}, audience = publisherAudience, expiration = "5m") => new SignJWT({ ...claims, ...extra }).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://token.actions.githubusercontent.com").setAudience(audience).setIssuedAt().setNotBefore("0s").setExpirationTime(expiration).sign(privateKey);
  expect(await authenticatePublisher(`Bearer ${await token()}`, resolver)).toMatchObject({ revision: claims.sha });
  for (const extra of [{ repository_id: "wrong" }, { repository: "evil/stumblr" }, { ref: "refs/heads/feature" }, { workflow_ref: "conficked/stumblr/.github/workflows/discovery-manual-review.yml@refs/heads/main" }, { event_name: "pull_request" }]) await expect(authenticatePublisher(`Bearer ${await token(extra)}`, resolver)).rejects.toThrow();
  await expect(authenticatePublisher(`Bearer ${await token({}, "evil")}`, resolver)).rejects.toThrow();
  await expect(authenticatePublisher(`Bearer ${await token({}, publisherAudience, "-1s")}`, resolver)).rejects.toThrow();
  await expect(authenticatePublisher("Bearer unsigned", resolver)).rejects.toThrow();
  await expect(authenticatePublisher(null, resolver)).rejects.toThrow();
  const collector = await token({ workflow_ref: "conficked/stumblr/.github/workflows/discovery-manual-review.yml@refs/heads/main", event_name: "schedule", run_id: "1234", run_attempt: "2" }, "https://stumblr.dev/catalogue-collect");
  expect(await authenticatePublisher(`Bearer ${collector}`, resolver, "collect")).toMatchObject({ revision: claims.sha });
  await expect(authenticatePublisher(`Bearer ${collector}`, resolver)).rejects.toThrow();
});

test("auto publication is isolated by audience, exact workflow, main ref, and immutable run identity", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "auto", alg: "RS256" }] });
  const autoAudience = "https://stumblr.dev/catalogue-auto-publish";
  const collectAudience = "https://stumblr.dev/catalogue-collect";
  const workflow = (name: string) => `conficked/stumblr/.github/workflows/${name}.yml@refs/heads/main`;
  const token = async (extra = {}, audience = autoAudience) => `Bearer ${await new SignJWT({
    ...claims, workflow_ref: workflow("catalogue-auto-publish"), event_name: "schedule", run_id: "1234", run_attempt: "2", ...extra,
  }).setProtectedHeader({ alg: "RS256", kid: "auto" }).setIssuer("https://token.actions.githubusercontent.com")
    .setAudience(audience).setIssuedAt().setNotBefore("0s").setExpirationTime("5m").sign(privateKey)}`;
  const auto = await token();
  expect(await authenticatePublisher(auto, resolver, "auto_publish")).toMatchObject({
    revision: `${claims.sha}:1234:2`, runId: "1234", runAttempt: 2, event: "schedule",
  });
  expect(await authenticatePublisher(await token({ event_name: "workflow_dispatch", run_attempt: "3" }), resolver, "auto_publish"))
    .toMatchObject({ revision: `${claims.sha}:1234:3`, event: "workflow_dispatch" });
  expect(await authenticatePublisher(await token({ run_id: "1235" }), resolver, "auto_publish"))
    .toMatchObject({ revision: `${claims.sha}:1235:2` });
  for (const extra of [
    { repository_id: "999" }, { ref: "refs/heads/feature" }, { workflow_ref: workflow("catalogue-publish") },
    { workflow_ref: workflow("discovery-manual-review") }, { event_name: "push" },
    { run_id: "0" }, { run_attempt: "1e1" }, { run_attempt: "99999999999999999999" },
  ]) await expect(authenticatePublisher(await token(extra), resolver, "auto_publish")).rejects.toThrow();
  await expect(authenticatePublisher(await token({}, publisherAudience), resolver, "auto_publish")).rejects.toThrow();
  await expect(authenticatePublisher(await token({}, collectAudience), resolver, "auto_publish")).rejects.toThrow();
  await expect(authenticatePublisher(await token({ workflow_ref: workflow("catalogue-publish"), event_name: "workflow_dispatch" }, publisherAudience), resolver, "auto_publish")).rejects.toThrow();
  await expect(authenticatePublisher(await token({ workflow_ref: workflow("discovery-manual-review") }, collectAudience), resolver, "auto_publish")).rejects.toThrow();
  await expect(authenticatePublisher(auto, resolver)).rejects.toThrow();
  await expect(authenticatePublisher(auto, resolver, "collect")).rejects.toThrow();
  await expect(authenticatePublisher(await token({ event_name: "workflow_dispatch" }, publisherAudience), resolver)).rejects.toThrow();
  await expect(authenticatePublisher(await token({}, collectAudience), resolver, "collect")).rejects.toThrow();
});
