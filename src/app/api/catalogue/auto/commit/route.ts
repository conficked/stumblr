import { z } from "zod";
import { commitAutoPublicationPreview } from "@/lib/catalogue/autoPublisher";
import { autoPublicationPost, catalogueRevision } from "../request";

export const POST = autoPublicationPost(z.strictObject({
  proposalId: z.uuid(), expectedRevision: catalogueRevision.nullable(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}), (actor, { proposalId, expectedRevision, contentHash }) => commitAutoPublicationPreview(actor, proposalId, expectedRevision, contentHash));
