/** @vitest-environment node */
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { openOpsDb, closeOpsDbForTests } from "@/lib/db/client";
import { insertSuggestion } from "@/lib/db/suggestionsRepo";
import { importCandidateBatch, getCandidateIdentitySnapshot } from "./candidateQueue";
const original = process.env.STUMBLR_DB_PATH;
let dir: string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(), "stumblr-queue-"));process.env.STUMBLR_DB_PATH=path.join(dir,"queue.sqlite");});
afterEach(()=>{closeOpsDbForTests();fs.rmSync(dir,{recursive:true,force:true});if(original===undefined)delete process.env.STUMBLR_DB_PATH;else process.env.STUMBLR_DB_PATH=original;});
test("collector and community converge on pending review without publishing or overriding a review",()=>{
 const row={id:"fixture",canonical_url:"https://example.org/",domain:"example.org",source_id:"fixture",source_family:"webring",source_url:"https://source.example/",topics:["art"],title_hint:"Fixture",selection_status:"evaluation_candidate",availability_status:200,x_frame_options:null,content_security_policy:null};
 expect(importCandidateBatch([row]).inserted).toBe(1);
 expect(importCandidateBatch([row]).existing).toBe(1);
 const db=openOpsDb();
 expect(db.prepare("SELECT status FROM discovery_candidates WHERE id='fixture'").get()?.status).toBe("pending_review");
 db.prepare("UPDATE discovery_candidates SET status='reviewed_exportable' WHERE id='fixture'").run();
 importCandidateBatch([row]);
 expect(db.prepare("SELECT status FROM discovery_candidates WHERE id='fixture'").get()?.status).toBe("reviewed_exportable");
 importCandidateBatch([{...row,source_family:"runtime-recheck",selection_status:"blocked"}]);
 expect(db.prepare("SELECT status FROM discovery_candidates WHERE id='fixture'").get()?.status).toBe("quarantined");
 insertSuggestion({id:"community-fixture",canonicalUrl:"https://community.example/",domain:"community.example",submittedAt:new Date().toISOString(),status:"pending_review",source:"community",title:"Community",note:null,topics:[],submitterHash:"test-only"});
 expect(db.prepare("SELECT status FROM discovery_candidates WHERE canonical_url='https://community.example/'").get()?.status).toBe("pending_review");
 expect(()=>importCandidateBatch([{...row,selection_status:"launch_approved"}])).toThrow();
});

const githubRow = (id: string, canonical_url: string, repository_id: string | number = "123", selection_status = "evaluation_candidate") => ({
 id, canonical_url, domain: new URL(canonical_url).hostname, source_id: "github", source_family: "github", source_url: "https://github.com/", topics: ["art"], title_hint: "Demo", selection_status, availability_status: 200, x_frame_options: null, content_security_policy: null,
 provenance: { repository_id, repository_full_name: "owner/demo", repository_url: "https://github.com/owner/demo", demo_url: canonical_url, description: "Demo", topics: ["art"], stars: 42, pushed_at: "2026-11-01T00:00:00Z", archived: false, source_query: "topic:art" },
});

test("collector persists only screened terminal identity and preserves it through rechecks", () => {
 const row = githubRow("first", "https://demo.example/start");
 importCandidateBatch([row]);
 const db = openOpsDb();
 const screen = () => JSON.parse(String(db.prepare("SELECT screen_json FROM discovery_candidates WHERE id = 'first'").get()?.screen_json));
 const screened_destination = { final_url_origin: "https://demo.example", final_url_sha256: "c".repeat(64), metadata_denied: false };
 expect(importCandidateBatch([{ ...row, screened_destination }]).existing).toBe(1);
 expect(screen().screened_destination).toEqual(screened_destination);
 importCandidateBatch([row]);
 importCandidateBatch([{ ...row, source_family: "runtime-recheck", availability_status: 404 }]);
 expect(screen()).toMatchObject({ status: 404, screened_destination });
 for (const invalid of [{ ...screened_destination, final_url_sha256: "x".repeat(64) },
   { ...screened_destination, final_url_origin: "https://demo.example/secret?q=token" },
   { ...screened_destination, final_url_origin: "https://machine.local" },
   { ...screened_destination, final_url_origin: "https://127.0.0.1" },
   { ...screened_destination, final_url: "https://demo.example/secret?q=token" }]) {
   expect(() => importCandidateBatch([{ ...row, screened_destination: invalid }])).toThrow();
 }
 importCandidateBatch([{ ...row, screened_final_url: "https://demo.example/legacy?token=do-not-store" }]);
 expect(JSON.stringify(screen())).not.toContain("do-not-store");
 expect(screen().screened_destination).toEqual(screened_destination);
});
test("repository replay across URLs preserves review and GitHub evidence",()=>{
 expect(importCandidateBatch([githubRow("first", "https://demo.example/", 123)]).inserted).toBe(1);
 const db=openOpsDb();
 db.prepare("UPDATE discovery_candidates SET status='reviewed_exportable' WHERE id='first'").run();
 expect(importCandidateBatch([githubRow("replay", "https://renamed.example/")]).existing).toBe(1);
 const row=db.prepare("SELECT * FROM discovery_candidates").get()!;
 expect(row.status).toBe("reviewed_exportable");
 const provenance=JSON.parse(String(row.provenance_json));
 expect(provenance.repository_id).toBe(123);
 expect(provenance.github_evidence.stars).toBe(42);
 expect(provenance.source_query).toBe("topic:art");
 expect(provenance.review_only).toBe(true);
 expect(provenance.auto_rotation).toBe(false);
 expect(getCandidateIdentitySnapshot()).toEqual({occupied_demo_domains:["demo.example"],known_repository_ids:["123"]});
});
test("two repositories sharing a domain create one reviewable destination across batches",()=>{
 importCandidateBatch([githubRow("first", "https://demo.example/one")]);
 expect(importCandidateBatch([githubRow("second", "https://demo.example/two", "456")]).existing).toBe(1);
 expect(openOpsDb().prepare("SELECT COUNT(*) AS count FROM discovery_candidates").get()?.count).toBe(1);
});
test("quarantined feed and docs identities allow a corrected homepage",()=>{
 importCandidateBatch([githubRow("feed", "https://demo.example/feed.xml", "123", "blocked"),githubRow("docs", "https://demo.example/docs", "123", "blocked")]);
 expect(getCandidateIdentitySnapshot()).toEqual({occupied_demo_domains:[],known_repository_ids:[]});
 expect(importCandidateBatch([githubRow("corrected", "https://demo.example/")]).inserted).toBe(1);
 expect(openOpsDb().prepare("SELECT COUNT(*) AS count FROM discovery_candidates WHERE status='pending_review'").get()?.count).toBe(1);
});

test("GitHub evidence enriches an existing destination without changing its review",()=>{
 const row=githubRow("existing", "https://demo.example/");
 const plain: Partial<typeof row>={...row};
 delete plain.provenance;
 importCandidateBatch([plain]);
 const db=openOpsDb();
 db.prepare("UPDATE discovery_candidates SET status='reviewed_exportable'").run();
 importCandidateBatch([githubRow("enrichment", "https://demo.example/", 123)]);
 const stored=db.prepare("SELECT * FROM discovery_candidates").get()!;
 expect(stored.repository_id).toBe("123");
 expect(JSON.parse(String(stored.provenance_json)).repository_id).toBe(123);
 expect(stored.status).toBe("reviewed_exportable");
});

for (const secondUrl of ["https://demo.example/two", "https://demo.example/one"]) {
 test(`shared destination retains both identities through later domain changes: ${secondUrl}`,()=>{
  importCandidateBatch([githubRow("first", "https://demo.example/one")]);
  const second=githubRow("second", secondUrl, "456");
  second.provenance.repository_full_name="owner/other";
  expect(importCandidateBatch([second]).existing).toBe(1);
  expect(getCandidateIdentitySnapshot().known_repository_ids).toEqual(["123","456"]);
  const db=openOpsDb();
  const primary=db.prepare("SELECT repository_id, provenance_json FROM discovery_candidates").get()!;
  expect(primary.repository_id).toBe("123");
  expect(JSON.parse(String(primary.provenance_json)).repository_full_name).toBe("owner/demo");
  for (const identity of ["123","456"]) {
   expect(importCandidateBatch([githubRow(`changed-${identity}`, "https://changed.example/", identity)]).existing).toBe(1);
  }
  expect(db.prepare("SELECT COUNT(*) AS count FROM discovery_candidates").get()?.count).toBe(1);
  expect(db.prepare("SELECT repository_id FROM discovery_candidate_repositories ORDER BY repository_id").all().map(row=>row.repository_id)).toEqual(["123","456"]);
 });
}
test("fresh raw metadata updates grouped evidence without discarding other evidence",()=>{
 const initial=githubRow("first", "https://demo.example/");
 importCandidateBatch([{...initial,provenance:{...initial.provenance,github_evidence:{stars:42,review_note:"retained"}}}]);
 const fresh=githubRow("refresh", "https://demo.example/");
 fresh.provenance.stars=99;
 importCandidateBatch([fresh]);
 const db=openOpsDb();
 const stored=JSON.parse(String(db.prepare("SELECT provenance_json FROM discovery_candidates").get()?.provenance_json));
 expect(stored.stars).toBe(99);
 expect(stored.github_evidence).toMatchObject({stars:99,review_note:"retained"});
 const association=JSON.parse(String(db.prepare("SELECT provenance_json FROM discovery_candidate_repositories").get()?.provenance_json));
 expect(association.github_evidence.stars).toBe(99);
});

for (const [homepages, known] of [
 [["https://demo.example/play", "https://demo.example/play"], null],
 [["https://demo.example/one", "https://demo.example/two"], null],
 [["https://demo.example/play", "https://demo.example/play"], "https://demo.example/play"],
] as const) {
 test(`collector artifacts retain every repository at shared import: ${homepages.join(",")} known=${known}`,()=>{
  const artifacts=JSON.parse(execFileSync("python3", ["-c", "import json,sys; from scripts.tests.test_github_demo_provider import collect_fixture; print(json.dumps(collect_fixture(*json.loads(sys.argv[1]))))", JSON.stringify([homepages,known])], {encoding:"utf8"}));
  if (known) {
   const plain: Partial<ReturnType<typeof githubRow>>=githubRow("known",known);
   delete plain.provenance;
   importCandidateBatch([plain]);
   openOpsDb().prepare("UPDATE discovery_candidates SET status='reviewed_exportable'").run();
  }
  importCandidateBatch(artifacts.selected);
  if (!known) expect(getCandidateIdentitySnapshot().known_repository_ids).toEqual(["1","2"]);
  importCandidateBatch(artifacts.associations);
  expect(getCandidateIdentitySnapshot().known_repository_ids).toEqual(["1","2"]);
  expect(openOpsDb().prepare("SELECT COUNT(*) AS count FROM discovery_candidates").get()?.count).toBe(1);
  if (known) expect(openOpsDb().prepare("SELECT status FROM discovery_candidates").get()?.status).toBe("reviewed_exportable");
 });
}
test("association-only rows cannot create candidates, alter status, or bypass field validation",()=>{
 const row=githubRow("primary","https://demo.example/");
 const update={association_update:true,canonical_url:row.canonical_url,domain:row.domain,repository_associations:[row.provenance]};
 expect(importCandidateBatch([update]).inserted).toBe(0);
 expect(openOpsDb().prepare("SELECT COUNT(*) AS count FROM discovery_candidates").get()?.count).toBe(0);
 importCandidateBatch([row]);
 openOpsDb().prepare("UPDATE discovery_candidates SET status='quarantined'").run();
 importCandidateBatch([update]);
 expect(openOpsDb().prepare("SELECT status FROM discovery_candidates").get()?.status).toBe("quarantined");
 for (const provenance of [{repository_id:0},{repository_id:"123",demo_url:"http://bad.example/"},{repository_id:"123",repository_url:"javascript:bad"},{}]) {
  expect(()=>importCandidateBatch([{...update,repository_associations:[provenance]}])).toThrow();
 }
 expect(()=>importCandidateBatch([{...update,repository_associations:Array(101).fill(row.provenance)}])).toThrow();
});

async function workflowAssociationImporter() {
 const modulePath=pathToFileURL(path.resolve("scripts/import_repository_associations.mjs")).href;
 const associationImporter=await import(/* @vite-ignore */ modulePath);
 return associationImporter.persistRepositoryAssociations;
}
test("workflow association import fails before authentication for a missing artifact",async()=>{
 const persist=await workflowAssociationImporter();
 let requests=0;
 await expect(persist(path.join(dir,"missing.json"),{getToken:async()=>{requests++;return "fixture";}})).rejects.toThrow();
 expect(requests).toBe(0);
});
test("workflow association import makes no request for an empty artifact",async()=>{
 const persist=await workflowAssociationImporter();
 const artifact=path.join(dir,"empty.json");fs.writeFileSync(artifact,"[]");
 let requests=0;
 expect(await persist(artifact,{getToken:async()=>{requests++;return "fixture";}})).toEqual({batches:0,association_updates:0});
 expect(requests).toBe(0);
});
test("workflow association import sends bounded metadata updates through shared validation",async()=>{
 const persist=await workflowAssociationImporter();
 const base=githubRow("known","https://demo.example/");
 importCandidateBatch([base]);
 openOpsDb().prepare("UPDATE discovery_candidates SET status='reviewed_exportable'").run();
 const updates=Array.from({length:25},(_,index)=>({association_update:true,canonical_url:base.canonical_url,domain:base.domain,repository_associations:[{...base.provenance,repository_id:index+1}]}));
 const artifact=path.join(dir,"associations.json");fs.writeFileSync(artifact,JSON.stringify(updates));
 const sizes:number[]=[];
 const result=await persist(artifact,{getToken:async()=>"fixture",request:async(url:string,options:{body:string;headers:Record<string,string>})=>{
  expect(url).toBe("https://stumblr.dev/api/catalogue/candidates");
  expect(options.headers.Authorization).toBe("Bearer fixture");
  const chunk=JSON.parse(options.body);sizes.push(chunk.length);
  return {ok:true,status:200,json:async()=>({ok:true,...importCandidateBatch(chunk)})};
 }});
 expect(result).toEqual({batches:2,association_updates:25});
 expect(sizes).toEqual([24,1]);
 expect(getCandidateIdentitySnapshot().known_repository_ids).toHaveLength(26);
 expect(openOpsDb().prepare("SELECT status FROM discovery_candidates").get()?.status).toBe("reviewed_exportable");
});

for (const [known, available] of [[null,true],["https://demo.example/play",true],[null,false]] as const) {
 test(`unsuitable GitHub leads cannot poison shared import: known=${known} available=${available}`,()=>{
  const artifacts=JSON.parse(execFileSync("python3",["-c","import json,sys; from scripts.tests.test_github_demo_provider import collect_fixture, UNSUITABLE_HOMEPAGES; args=json.loads(sys.argv[1]); print(json.dumps(collect_fixture(UNSUITABLE_HOMEPAGES + ['https://Demo.Example:443/play'], *args)))",JSON.stringify([known,available])],{encoding:"utf8"}));
  if (known) {
   const plain: Partial<ReturnType<typeof githubRow>>=githubRow("known",known);delete plain.provenance;
   importCandidateBatch([plain]);openOpsDb().prepare("UPDATE discovery_candidates SET status='reviewed_exportable'").run();
  }
  importCandidateBatch(artifacts.selected);importCandidateBatch(artifacts.associations);
  expect(artifacts.associations.flatMap((row:{repository_associations:unknown[]})=>row.repository_associations)).toHaveLength(1);
  expect(getCandidateIdentitySnapshot().known_repository_ids).toEqual(available?["17"]:[]);
  if (available) {
   const stored=JSON.parse(String(openOpsDb().prepare("SELECT provenance_json FROM discovery_candidate_repositories").get()?.provenance_json));
   expect(stored.demo_url).toBe("https://demo.example/play");expect(stored.raw_homepage).toBe("https://Demo.Example:443/play");
  }
 });
}
test("shared metadata schema rejects invalid DNS and unsafe URL forms",()=>{
 const row=githubRow("target","https://demo.example/");
 for (const demo_url of ["https://bad_host.example/","https://bad..example/","https://-bad.example/","https://demo.example:/","https://demo%2eexample/","https://demo.example/%0Asecret","https://demo.example/%zz"]) {
  expect(()=>importCandidateBatch([{association_update:true,canonical_url:row.canonical_url,domain:row.domain,repository_associations:[{...row.provenance,demo_url}]}])).toThrow();
  expect(()=>importCandidateBatch([{...row,provenance:{...row.provenance,demo_url}}])).toThrow();
 }
});

test("shared association normalization retains the original default-port homepage",()=>{
 const row=githubRow("target","https://demo.example/");
 importCandidateBatch([row]);
 importCandidateBatch([{association_update:true,canonical_url:row.canonical_url,domain:row.domain,repository_associations:[{...row.provenance,repository_id:"456",demo_url:"https://Demo.Example:443/play"}]}]);
 const stored=JSON.parse(String(openOpsDb().prepare("SELECT provenance_json FROM discovery_candidate_repositories WHERE repository_id='456'").get()?.provenance_json));
 expect(stored.demo_url).toBe("https://demo.example/play");
 expect(stored.raw_homepage).toBe("https://Demo.Example:443/play");
});


test("collector path correction survives a full shared-import chunk and replay after quarantine",()=>{
 const artifacts=JSON.parse(execFileSync("python3",["-c","import json; from scripts.tests.test_github_demo_provider import collect_homepage_correction_fixture; print(json.dumps(collect_homepage_correction_fixture()))"],{encoding:"utf8"}));
 const old=artifacts.old.selected[0];
 const corrected=artifacts.corrected.selected[0];
 const replay=artifacts.replay.selected[0];
 expect(artifacts.chunk).toHaveLength(24);
 const unchangedMetadata=(row: typeof old)=>Object.fromEntries(Object.entries(row.provenance).filter(([key])=>!["demo_url","raw_homepage"].includes(key)));
 expect(unchangedMetadata(corrected)).toEqual(unchangedMetadata(old));
 expect(importCandidateBatch(artifacts.old.selected).inserted).toBe(1);
 importCandidateBatch(artifacts.old.associations);
 const db=openOpsDb();
 db.prepare("UPDATE discovery_candidates SET status='quarantined' WHERE id=?").run(old.id);
 const oldRow=db.prepare("SELECT * FROM discovery_candidates WHERE id=?").get(old.id);
 const oldAssociation=db.prepare("SELECT * FROM discovery_candidate_repositories WHERE candidate_id=?").get(old.id);
 expect(getCandidateIdentitySnapshot()).toEqual({occupied_demo_domains:[],known_repository_ids:[]});
 // This used to throw UNIQUE(discovery_candidates.id) and roll back all 23 peers.
 expect(importCandidateBatch(artifacts.chunk)).toMatchObject({inserted:24,existing:0});
 importCandidateBatch(artifacts.corrected.associations);
 const associations=db.prepare("SELECT * FROM discovery_candidate_repositories ORDER BY candidate_id, repository_id").all();
 expect(importCandidateBatch(artifacts.chunk)).toMatchObject({inserted:0,existing:24});
 expect(importCandidateBatch(artifacts.replay.selected)).toMatchObject({inserted:0,existing:1});
 importCandidateBatch(artifacts.replay.associations);
 expect(db.prepare("SELECT COUNT(*) AS count FROM discovery_candidates").get()?.count).toBe(25);
 expect(db.prepare("SELECT id,canonical_url,status FROM discovery_candidates WHERE domain='demo.example' ORDER BY canonical_url").all()).toEqual([
  {id:old.id,canonical_url:"https://demo.example/old-play",status:"quarantined"},
  {id:corrected.id,canonical_url:"https://demo.example/play",status:"pending_review"},
 ]);
 expect(db.prepare("SELECT * FROM discovery_candidates WHERE id=?").get(old.id)).toEqual(oldRow);
 expect(db.prepare("SELECT * FROM discovery_candidate_repositories WHERE candidate_id=?").get(old.id)).toEqual(oldAssociation);
 expect(db.prepare("SELECT * FROM discovery_candidate_repositories ORDER BY candidate_id, repository_id").all()).toEqual(associations);
 const identityRows=db.prepare("SELECT candidate_id,provenance_json FROM discovery_candidate_repositories WHERE repository_id='1'").all();
 expect(Object.fromEntries(identityRows.map(row=>[row.candidate_id,JSON.parse(String(row.provenance_json)).demo_url]))).toEqual({
  [old.id]:"https://demo.example/old-play",[corrected.id]:"https://demo.example/play",
 });
 expect(corrected.id).not.toBe(old.id);
 expect(replay.id).toBe(corrected.id);
});
