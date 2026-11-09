import { z } from "zod";
import { createAutoPublicationPreview } from "@/lib/catalogue/autoPublisher";
import { autoPublicationPost } from "../request";

export const POST = autoPublicationPost(z.strictObject({ requestedCap: z.int().min(1).max(20) }),
  (actor, { requestedCap }) => createAutoPublicationPreview(actor, requestedCap));
