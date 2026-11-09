import { readFileSync } from "node:fs";
import { classifyCollectorTitle } from "../src/lib/catalogue/titleClassification.mjs";
const { raw, cleaned } = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(classifyCollectorTitle(raw, cleaned)));
