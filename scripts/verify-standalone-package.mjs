#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const nextRoot = path.join(root, ".next");
const standaloneRoot = path.join(nextRoot, "standalone");
const forbiddenRuntimePattern = /(?:^|\/)(?:data\/.*)?[^/]*(?:\.sqlite3?(?:-(?:wal|shm|journal))?|\.db(?:-(?:wal|shm|journal))?)$/i;
const forbiddenPrivateArtifactPattern = /(?:^|\/)(?:\.env(?:\..*)?|render-private-prep-(?:details\.md|result\.txt)|verification\/.*)$/i;

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

await stat(path.join(standaloneRoot, "server.js"));

const standaloneFiles = await filesUnder(standaloneRoot);
const packagedRuntimeArtifacts = standaloneFiles
  .map((file) => path.relative(standaloneRoot, file).split(path.sep).join("/"))
  .filter((file) => forbiddenRuntimePattern.test(file));
const packagedPrivateArtifacts = standaloneFiles
  .map((file) => path.relative(standaloneRoot, file).split(path.sep).join("/"))
  .filter((file) => forbiddenPrivateArtifactPattern.test(file));

const traceFiles = (await filesUnder(nextRoot)).filter((file) => file.endsWith(".nft.json"));
const tracedRuntimeArtifacts = [];
for (const traceFile of traceFiles) {
  const trace = JSON.parse(await readFile(traceFile, "utf8"));
  for (const tracedFile of trace.files ?? []) {
    const normalized = String(tracedFile).split(path.sep).join("/");
    if (forbiddenRuntimePattern.test(normalized)) {
      tracedRuntimeArtifacts.push(
        `${path.relative(nextRoot, traceFile).split(path.sep).join("/")}: ${normalized}`,
      );
    }
  }
}

if (packagedRuntimeArtifacts.length || tracedRuntimeArtifacts.length || packagedPrivateArtifacts.length) {
  const details = [
    ...packagedRuntimeArtifacts.map((file) => `packaged: ${file}`),
    ...tracedRuntimeArtifacts.map((file) => `traced: ${file}`),
    ...packagedPrivateArtifacts.map((file) => `private artifact: ${file}`),
  ];
  throw new Error(`standalone package contains forbidden runtime artifacts:\n${details.join("\n")}`);
}

console.log(
  `standalone-package-hygiene: PASS (${standaloneFiles.length} packaged files, ${traceFiles.length} traces checked)`,
);
