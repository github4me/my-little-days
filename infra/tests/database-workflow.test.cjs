const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const read = (name) =>
  readFileSync(path.join(__dirname, "../../", name), "utf8");
const release = yaml.load(read(".github/workflows/deploy-family-pilot.yml"));
const ci = yaml.load(read(".github/workflows/family-pilot-ci.yml"));
const infra = yaml.load(read(".github/workflows/deploy-family-infra.yml"));

test("only manual reviewed release can reach migration then API", () => {
  assert.deepEqual(Object.keys(release.on), ["workflow_dispatch"]);
  assert.equal(
    release.on.workflow_dispatch.inputs.database_bootstrapped.default,
    false,
  );
  assert.equal(release.on.workflow_dispatch.inputs.adopt_ef.default, false);
  assert.equal(release.on.workflow_dispatch.inputs.release_sha, undefined);
  assert.equal(release.jobs.verify.with.revision, "${{ github.sha }}");
  assert.equal(release.jobs.migrate.env.RELEASE_SHA, "${{ github.sha }}");
  assert.equal(
    release.jobs.validate.steps[0].env.RELEASE_SHA,
    "${{ github.sha }}",
  );
  assert.ok(!JSON.stringify(release).includes("inputs.release_sha"));
  assert.equal(release.jobs.verify.needs, "validate");
  assert.equal(release.jobs.migrate.needs, "verify");
  assert.equal(release.jobs.deploy.needs, "migrate");
  assert.equal(release.jobs.migrate.environment, "family-database");
  assert.equal(release.jobs.deploy.environment.name, "family-pilot");
  assert.equal(release.concurrency.group, infra.jobs.deploy.concurrency.group);
  assert.equal(release.concurrency["cancel-in-progress"], false);
  assert.equal(release.permissions["id-token"], undefined);
  assert.match(
    JSON.stringify(release.jobs.validate.steps),
    /current.data.object.sha !== sha/,
  );
});
test("migration uses a separate OIDC identity, reviewed artifact and always-cleanup", () => {
  const steps = release.jobs.migrate.steps;
  const login = steps.find((x) => x.uses?.startsWith("azure/login@"));
  assert.equal(
    login.with["client-id"],
    "${{ vars.AZURE_DB_MIGRATION_CLIENT_ID }}",
  );
  assert.notEqual(
    login.with["client-id"],
    release.jobs.deploy.steps.find((x) => x.uses?.startsWith("azure/login@"))
      .with["client-id"],
  );
  assert.equal(
    steps.find((x) => x.uses?.startsWith("actions/checkout@")).with.ref,
    "${{ github.sha }}",
  );
  assert.equal(
    steps.find((x) => x.uses?.startsWith("actions/download-artifact@")).with
      .name,
    "family-database-${{ github.run_id }}",
  );
  assert.match(
    steps.find((x) => x.run?.includes("-Mode Cleanup")).if,
    /always\(\).*azure-login.outcome == 'success'/,
  );
  assert.equal(release.jobs.migrate.permissions["id-token"], "write");
  assert.equal(
    release.jobs.migrate.env.FAMILY_DB_APPROVED_FIREWALL_RULES_JSON,
    "${{ vars.FAMILY_DB_APPROVED_FIREWALL_RULES_JSON }}",
  );
  assert.ok(!JSON.stringify(release).includes("continue-on-error"));
});
test("CI runs both real-SQL test projects and publishes the standalone migrator", () => {
  const steps = ci.jobs.api.steps;
  assert.ok(
    steps.some((x) => x.run?.includes("dotnet test server/LittleDays.slnx")),
  );
  assert.ok(steps.some((x) => x.run?.includes("github-database.Tests.ps1")));
  assert.ok(steps.some((x) => x.run?.includes("action-pins.test.cjs")));
  assert.ok(
    steps.some((x) =>
      x.run?.includes("dotnet publish server/LittleDays.DatabaseMigrator/"),
    ),
  );
  assert.ok(
    steps.some((x) => x.with?.name === "family-database-${{ github.run_id }}"),
  );
});
test("API has no migration execution or embedded schema files", () => {
  assert.ok(
    !read("server/LittleDays.FamilyApi/Program.cs").includes("MigrateAsync"),
  );
  assert.match(
    read("server/LittleDays.FamilyApi/LittleDays.FamilyApi.csproj"),
    /Compile Remove="Migrations\/\*\*\/\*.cs"/,
  );
  assert.ok(
    !read("server/LittleDays.FamilyApi/LittleDays.FamilyApi.csproj").includes(
      "dbup",
    ),
  );
});
