/** Import bounded metadata attribution without creating or qualifying destinations. */
import { readFile, stat } from "node:fs/promises";

export async function persistRepositoryAssociations(artifactPath, { getToken, request = fetch }) {
  if ((await stat(artifactPath)).size > 1000000) throw new Error("association artifact exceeds 1 MiB");
  const rows = JSON.parse(await readFile(artifactPath, "utf8"));
  if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !row || row.association_update !== true ||
      !Array.isArray(row.repository_associations) || row.repository_associations.length < 1 || row.repository_associations.length > 100) ||
      rows.reduce((count, row) => count + row.repository_associations.length, 0) > 100) {
    throw new Error("invalid bounded repository association artifact");
  }
  let batches = 0;
  for (let offset = 0; offset < rows.length; offset += 24) {
    const token = await getToken();
    const response = await request("https://stumblr.dev/api/catalogue/candidates", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(rows.slice(offset, offset + 24)),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`Association import rejected: ${response.status}`);
    batches++;
  }
  return { batches, association_updates: rows.length };
}
