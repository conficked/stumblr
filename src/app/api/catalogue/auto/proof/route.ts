import { z } from "zod";
import { completeAutoPublicationProof, completeAutoPublicationPublicCheck, getAutoPublicationProof } from "@/lib/catalogue/autoPublisher";
import { autoPublicationPost, autoReleaseRevision } from "../request";

export const POST = autoPublicationPost(z.strictObject({
  releaseRevision: autoReleaseRevision,
  action: z.enum(["read", "verified", "unverified", "confirm_public", "reject_public"]),
}), (actor, { releaseRevision, action }) => {
  if (action === "read") return getAutoPublicationProof(actor, releaseRevision);
  if (action === "confirm_public" || action === "reject_public") {
    return completeAutoPublicationPublicCheck(actor, releaseRevision, action === "confirm_public" ? "confirmed" : "failed");
  }
  return completeAutoPublicationProof(actor, releaseRevision, action);
});
