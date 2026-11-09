import { z } from "zod";
import { publicHttpsUrl } from "./destinationIdentity.mjs";

export const screenedDestinationSchema = z.strictObject({
  final_url_origin: z.string().max(261).refine(value => publicHttpsUrl(value)?.origin === value),
  final_url_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  metadata_denied: z.boolean(),
});

export type ScreenedDestination = z.infer<typeof screenedDestinationSchema>;
