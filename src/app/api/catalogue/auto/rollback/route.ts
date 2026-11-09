import { z } from "zod";
import { rollbackFreshAdditions } from "@/lib/catalogue/autoPublisher";
import { autoPublicationPost, autoReleaseRevision } from "../request";

export const POST = autoPublicationPost(z.strictObject({
  releaseRevision: autoReleaseRevision, failedIds: z.array(z.string().min(1).max(200)).min(1).max(20),
}), (actor, { releaseRevision, failedIds }) => rollbackFreshAdditions(actor, releaseRevision, failedIds));
