import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

const issuer = "https://token.actions.githubusercontent.com";
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
export const publisherAudience = "https://stumblr.dev/catalogue-ingest";
export const autoPublisherAudience = "https://stumblr.dev/catalogue-auto-publish";
const authorities = {
  publish: { workflow: "catalogue-publish.yml", audience: publisherAudience },
  collect: { workflow: "discovery-manual-review.yml", audience: "https://stumblr.dev/catalogue-collect" },
  auto_publish: { workflow: "catalogue-auto-publish.yml", audience: autoPublisherAudience },
} as const;

export type CataloguePurpose = keyof typeof authorities;
type PublisherActor = { revision: string; issuedAt: number };
export type CollectionActor = PublisherActor & { runId: string; runAttempt: number };
export type AutoPublishActor = CollectionActor & { event: "schedule" | "workflow_dispatch" };

type ActorFor = { publish: PublisherActor; collect: CollectionActor; auto_publish: AutoPublishActor };

export function validatePublisherClaims(claims: JWTPayload): PublisherActor;
export function validatePublisherClaims<Purpose extends CataloguePurpose>(claims: JWTPayload, purpose: Purpose): ActorFor[Purpose];
export function validatePublisherClaims(claims: JWTPayload, purpose: CataloguePurpose = "publish") {
  const event = claims.event_name;
  if (claims.repository_id !== "1450399070" || claims.repository !== "conficked/stumblr" ||
    claims.ref !== "refs/heads/main" ||
    claims.workflow_ref !== `conficked/stumblr/.github/workflows/${authorities[purpose].workflow}@refs/heads/main` ||
    !(event === "workflow_dispatch" || (purpose !== "publish" && event === "schedule")) ||
    typeof claims.sha !== "string" || !/^[a-f0-9]{40}$/.test(claims.sha) ||
    typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat)) throw new Error("Unauthorized publisher");

  const publisher = { revision: claims.sha, issuedAt: claims.iat };
  if (purpose === "publish") return publisher;
  const runAttempt = Number(claims.run_attempt);
  if (typeof claims.run_id !== "string" || !/^[1-9][0-9]{0,19}$/.test(claims.run_id) ||
    typeof claims.run_attempt !== "string" || !/^[1-9][0-9]*$/.test(claims.run_attempt) ||
    !Number.isSafeInteger(runAttempt)) throw new Error("Unauthorized publisher");
  const actor = { ...publisher, runId: claims.run_id, runAttempt };
  return purpose === "collect" ? actor : { ...actor, revision: `${claims.sha}:${actor.runId}:${runAttempt}`, event };
}

export function authenticatePublisher(header: string | null, resolver?: JWTVerifyGetKey): Promise<PublisherActor>;
export function authenticatePublisher<Purpose extends CataloguePurpose>(header: string | null, resolver: JWTVerifyGetKey | undefined, purpose: Purpose): Promise<ActorFor[Purpose]>;
export async function authenticatePublisher(header: string | null, resolver: JWTVerifyGetKey = keys, purpose: CataloguePurpose = "publish") {
  if (!header?.startsWith("Bearer ") || header.length > 20000) throw new Error("Unauthorized publisher");
  const audience = authorities[purpose].audience;
  const { payload } = await jwtVerify(header.slice(7), resolver, { issuer, audience, algorithms: ["RS256"], maxTokenAge: "10m", requiredClaims: ["exp", "iat", "nbf"] });
  if (purpose === "auto_publish" && payload.aud !== audience) throw new Error("Unauthorized publisher");
  return validatePublisherClaims(payload, purpose);
}
