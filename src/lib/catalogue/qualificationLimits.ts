// Shared by the browser artifact producer and its evidence importer.
export const MAX_QUALIFICATION_FINAL_URL_LENGTH = 16 * 1024;
export const OVERSIZED_QUALIFICATION_FINAL_URL_REASON = "final document URL exceeds evidence limit";

export const MAX_QUALIFICATION_EVIDENCE_AGE_MS = 48 * 60 * 60 * 1000;

// v2: blocked third-party subresources and nested frames no longer void an observation.
// v3: records whether the rendered page carries product sales language.
// v4: records whether the page is generated documentation.
export const QUALIFIER_VERSION = "browser-qualification-v4";
