const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

// Verified from each official repository's major tag and peeled commit using
// git ls-remote on 2026-09-17. Updating an action requires reviewing its upstream
// changes and updating both its workflow pin and this reviewed commit list.
const reviewed = new Map(
  Object.entries({
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262", // v4
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020", // v4
    "actions/setup-dotnet": "67a3573c9a986a3f9c594539f4ab511d57bb3ce9", // v4
    "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093", // v4
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02", // v4
    "actions/github-script": "f28e40c7f34bde8b3046d885e986cb6290c5673b", // v7
    "azure/login": "a641126d1b8aa4d1fa005f4f92df94a3a4c4c906", // v3 (peeled commit)
    "azure/webapps-deploy": "02a81bead70021f5284939794bcec79c271ab383", // v3 (peeled commit)
  }),
);

function requireReviewedReference(reference) {
  assert.equal(typeof reference, "string");
  if (/^\.\/\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/.test(reference))
    return;
  const match = /^([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)@([a-f0-9]{40})$/.exec(
    reference,
  );
  assert.ok(match, `Mutable or unsupported action reference: ${reference}`);
  assert.equal(
    reviewed.get(match[1]),
    match[2],
    `Unreviewed action commit: ${reference}`,
  );
}

test("all artifact, migration and deployment workflow actions are commit-pinned", () => {
  const directory = path.join(__dirname, "../../.github/workflows");
  const files = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length >= 3);
  for (const file of files) {
    const workflow = yaml.load(
      readFileSync(path.join(directory, file), "utf8"),
    );
    for (const job of Object.values(workflow.jobs)) {
      if (job.uses) requireReviewedReference(job.uses);
      for (const step of job.steps || []) {
        if (step.uses) requireReviewedReference(step.uses);
      }
    }
  }
});

test("the action policy accepts reviewed commits and repository-local reusable workflows", () => {
  for (const [action, commit] of reviewed)
    requireReviewedReference(`${action}@${commit}`);
  requireReviewedReference("./.github/workflows/family-pilot-ci.yml");
});

test("the action policy rejects mutable, abbreviated, unreviewed and tag-object refs", () => {
  for (const reference of [
    "actions/checkout@v4",
    "actions/checkout@main",
    "actions/checkout@11d5960",
    "actions/checkout@" + "a".repeat(40),
    "unreviewed/action@" + "a".repeat(40),
    "azure/login@935127ca5bb3c4b02c9c2c10060028383878f33f",
    "docker://unreviewed/action:latest",
    "./.github/workflows/../../other.yml",
  ])
    assert.throws(() => requireReviewedReference(reference));
});
