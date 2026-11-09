import { z } from "zod";
const topics = z.enum(["art", "science", "maps", "music", "games", "culture", "archives", "education", "nature"]);
export const reviewedEntrySchema = z.object({
  id: z.string().min(1).max(200), title: z.string().min(1).max(200),
  canonicalUrl: z.url().refine(value => { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.port && /\.[a-z]{2,}$/i.test(u.hostname); }),
  domain: z.string().min(3).max(253), topics: z.array(topics).min(1).max(9),
  description: z.string().max(1000), status: z.literal("evaluation_only"), policyBasis: z.null(),
  provenance: z.object({ sourceNote: z.string().min(1).max(1000), reviewer: z.string().min(1).max(200), reviewedAt: z.iso.datetime() }),
  embedEvidence: z.object({ observedHeaders: z.string().max(1000), observedRenderResult: z.literal("rendered"), observedAt: z.iso.datetime(), device: z.enum(["desktop", "mobile-emulation"]) }),
}).refine(entry => new URL(entry.canonicalUrl).hostname === entry.domain);
export const runtimeCatalogueSchema = z.object({ entries: z.array(reviewedEntrySchema).max(1000) }).superRefine((data, ctx) => {
  for (const field of ["id", "canonicalUrl", "domain"] as const) {
    const values = data.entries.map(entry => entry[field]);
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "Duplicate catalogue key" });
  }
});
