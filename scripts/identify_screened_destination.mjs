import { readFileSync } from "node:fs";
import { deniedUrl, getQualificationUrlIdentity, publicHttpsUrl } from "../src/lib/catalogue/destinationIdentity.mjs";

const url = publicHttpsUrl(readFileSync(0, "utf8"), 16_384);
process.stdout.write(JSON.stringify(url && {
  ...getQualificationUrlIdentity(url.href),
  metadata_denied: deniedUrl(url),
}));
