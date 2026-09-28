const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const workflowPath = path.resolve(
  __dirname,
  "../../.github/workflows/deploy-family-infra.yml",
);
const source = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(source);
const { validate, preview, deploy } = workflow.jobs;
const steps = (job) => job.steps || [];
const runs = (job) =>
  steps(job)
    .map((step) => step.run || "")
    .join("\n");
const actions = (job, name) =>
  steps(job).filter((step) => step.uses?.startsWith(`${name}@`));
const environmentName = (job) =>
  typeof job.environment === "string" ? job.environment : job.environment?.name;

// Interpret only the small, explicit Actions expression subset used by the gate.
// Do not evaluate workflow text as JavaScript or execute any Azure/GitHub command.
function evaluateGate(expression, context) {
  const input = expression
    .trim()
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "");
  const tokens =
    input.match(
      /\s+|'(?:[^']|'')*'|&&|\|\||==|!=|[(),]|[A-Za-z_][A-Za-z0-9_.]*/g,
    ) || [];
  assert.equal(
    tokens.join(""),
    input,
    "The branch gate must use the supported explicit expression syntax.",
  );
  const significant = tokens.filter((token) => !/^\s+$/.test(token));
  let index = 0;
  const take = (token) => significant[index] === token && ++index > 0;
  const requireToken = (token) =>
    assert.ok(take(token), `Expected ${token} in the branch gate.`);
  function primary() {
    if (take("(")) {
      const value = or();
      requireToken(")");
      return value;
    }
    const token = significant[index++];
    assert.ok(token, "The branch gate expression is incomplete.");
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    if (token === "true" || token === "false") return token === "true";
    if (take("(")) {
      const args = [or()];
      while (take(",")) args.push(or());
      requireToken(")");
      if (token === "startsWith")
        return String(args[0])
          .toLowerCase()
          .startsWith(String(args[1]).toLowerCase());
      if (token === "format")
        return String(args[0]).replace(/\{(\d+)\}/g, (_, n) =>
          String(args[Number(n) + 1]),
        );
      assert.fail(`Unsupported function in the branch gate: ${token}`);
    }
    return (
      token.split(".").reduce((object, key) => object?.[key], context) ?? ""
    );
  }
  function equality() {
    let value = primary();
    while (significant[index] === "==" || significant[index] === "!=") {
      const operator = significant[index++];
      const right = primary();
      // GitHub compares strings case-insensitively. All equality operands in this
      // gate are strings; reject mixed types rather than simulate loose coercion.
      assert.equal(
        typeof value,
        typeof right,
        "Do not use mixed-type branch gate comparisons.",
      );
      const equal =
        typeof value === "string"
          ? value.toLowerCase() === right.toLowerCase()
          : value === right;
      value = operator === "==" ? equal : !equal;
    }
    return value;
  }
  function and() {
    let value = equality();
    while (take("&&")) {
      const right = equality();
      value = value && right;
    }
    return value;
  }
  function or() {
    let value = and();
    while (take("||")) {
      const right = and();
      value = value || right;
    }
    return value;
  }
  const result = or();
  assert.equal(
    index,
    significant.length,
    "The entire branch gate must be evaluated.",
  );
  return Boolean(result);
}

test("infra changes trigger push/PR validation, with no privileged or chained trigger", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  const requiredPaths = [
    "infra/bicep/**",
    "infra/deploy-pilot.ps1",
    "infra/github-infra.ps1",
    "infra/github-infra-preview-role.example.json",
    "infra/tests/**",
    ".github/workflows/deploy-family-infra.yml",
  ];
  for (const event of ["push", "pull_request"]) {
    assert.deepEqual(
      [...workflow.on[event].paths].sort(),
      requiredPaths.sort(),
    );
    assert.equal(
      workflow.on[event].branches,
      undefined,
      `${event} must validate changes on every branch.`,
    );
    assert.equal(workflow.on[event]["paths-ignore"], undefined);
  }
});

test("PR validation has no Azure identity, protected environment or write permission", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs).sort(), [
    "deploy",
    "preview",
    "validate",
  ]);
  assert.ok(validate);
  assert.equal(
    validate.if,
    undefined,
    "Local validation must also run for pull requests.",
  );
  assert.equal(validate.environment, undefined);
  assert.ok(
    validate.permissions === undefined ||
      Object.values(validate.permissions).every(
        (value) => value === "read" || value === "none",
      ),
  );
  assert.equal(actions(validate, "azure/login").length, 0);
  assert.doesNotMatch(
    JSON.stringify(validate),
    /secrets\.|id-token|AZURE_.*CLIENT_ID|\baz\s+login\b|\baz\s+deployment\b/i,
  );
  assert.match(runs(validate), /bicep\.Tests\.ps1/);
  assert.match(runs(validate), /deploy-pilot\.Tests\.ps1/);
  assert.match(runs(validate), /github-infra\.Tests\.ps1/);
  assert.match(runs(validate), /github-workflow\.test\.cjs/);
});

test("preview role has metadata reads and what-if actions but no resource/data writes", () => {
  const role = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../github-infra-preview-role.example.json"),
      "utf8",
    ),
  );
  assert.deepEqual(role.Actions, [
    "*/read",
    "Microsoft.Resources/deployments/whatIf/action",
    "Microsoft.Resources/deployments/validate/action",
  ]);
  assert.deepEqual(role.DataActions, []);
  assert.deepEqual(role.NotDataActions, []);
  assert.deepEqual(role.AssignableScopes, [
    "/subscriptions/4768a858-f23f-4a39-bb64-eabc9c142627",
  ]);
});

test("only an enabled trusted branch push or dispatch can reach Azure preview", () => {
  assert.ok(
    preview.if,
    "Preview requires a job-level gate before requesting an OIDC token.",
  );
  assert.match(preview.if, /vars\.FAMILY_INFRA_ENABLED/);
  assert.match(preview.if, /vars\.FAMILY_INFRA_BRANCH/);
  assert.match(preview.if, /github\.event\.repository\.default_branch/);
  const cases = [
    ["default branch push", "push", "refs/heads/main", "", "true", true],
    [
      "default branch dispatch",
      "workflow_dispatch",
      "refs/heads/main",
      "",
      "true",
      true,
    ],
    [
      "custom deployment branch",
      "push",
      "refs/heads/feature/family-invitations",
      "feature/family-invitations",
      "true",
      true,
    ],
    ["different branch", "push", "refs/heads/other", "", "true", false],
    [
      "default branch with a custom branch configured",
      "push",
      "refs/heads/main",
      "feature/family-invitations",
      "true",
      false,
    ],
    [
      "tag named like the allowed branch",
      "push",
      "refs/tags/main",
      "",
      "true",
      false,
    ],
    ["PR merge ref", "pull_request", "refs/pull/123/merge", "", "true", false],
    [
      "PR even with a trusted-looking branch ref",
      "pull_request",
      "refs/heads/main",
      "",
      "true",
      false,
    ],
    ["unset enable flag", "push", "refs/heads/main", "", "", false],
    ["disabled", "push", "refs/heads/main", "", "false", false],
    [
      "Actions treats string comparisons as case-insensitive",
      "push",
      "refs/heads/main",
      "",
      "TRUE",
      true,
    ],
  ];
  for (const [label, eventName, ref, branch, enabled, expected] of cases) {
    const context = {
      github: {
        event_name: eventName,
        ref,
        event: { repository: { default_branch: "main" } },
      },
      vars: { FAMILY_INFRA_BRANCH: branch, FAMILY_INFRA_ENABLED: enabled },
    };
    for (const [name, job] of [
      ["preview", preview],
      ["deploy", deploy],
    ]) {
      assert.equal(
        evaluateGate(job.if, context),
        expected,
        `${name}: ${label}`,
      );
    }
  }
});

test("deployment follows successful preview in a separate protected environment", () => {
  assert.deepEqual([preview.needs].flat(), ["validate"]);
  assert.deepEqual([deploy.needs].flat(), ["preview"]);
  assert.equal(environmentName(preview), "family-infra-preview");
  assert.equal(environmentName(deploy), "family-infra");
  assert.doesNotMatch(deploy.if || "", /always\(|failure\(|cancelled\(/);
  assert.equal(deploy["continue-on-error"], undefined);
  assert.equal(preview["continue-on-error"], undefined);
});

test("preview and deployment use distinct OIDC clients, not stored Azure credentials", () => {
  for (const [job, clientVariable] of [
    [preview, "AZURE_INFRA_PREVIEW_CLIENT_ID"],
    [deploy, "AZURE_INFRA_DEPLOY_CLIENT_ID"],
  ]) {
    assert.deepEqual(job.permissions, {
      contents: "read",
      "id-token": "write",
    });
    const logins = actions(job, "azure/login");
    assert.equal(logins.length, 1);
    assert.equal(
      logins[0].uses,
      "azure/login@a641126d1b8aa4d1fa005f4f92df94a3a4c4c906",
    );
    assert.equal(logins[0].with["client-id"], `\${{ vars.${clientVariable} }}`);
    assert.equal(logins[0].with["tenant-id"], "${{ vars.AZURE_TENANT_ID }}");
    assert.equal(
      logins[0].with["subscription-id"],
      "${{ vars.AZURE_SUBSCRIPTION_ID }}",
    );
    assert.equal(logins[0].with.creds, undefined);
    assert.equal(logins[0].with["client-secret"], undefined);
  }
});

test("all jobs check out the triggering commit without persisting GitHub credentials", () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const checkouts = actions(job, "actions/checkout");
    assert.equal(
      checkouts.length,
      1,
      `${name} must check out exactly one immutable source revision.`,
    );
    assert.equal(checkouts[0].with.ref, "${{ github.sha }}");
    assert.equal(checkouts[0].with["persist-credentials"], false);
  }
});

test("a single non-cancelling concurrency group serializes pilot deployments", () => {
  assert.equal(
    workflow.concurrency,
    undefined,
    "Waiting for deployment approval must not block PR validation.",
  );
  assert.equal(typeof deploy.concurrency.group, "string");
  assert.doesNotMatch(deploy.concurrency.group, /\$\{\{|github\.(ref|run)/);
  assert.match(deploy.concurrency.group, /family.*infra|infra.*family/);
  assert.equal(deploy.concurrency["cancel-in-progress"], false);
});

test("cloud operations delegate to the guarded helper in their corresponding mode", () => {
  assert.match(runs(preview), /github-infra\.ps1\s+-Mode\s+WhatIf\b/);
  assert.match(runs(deploy), /github-infra\.ps1\s+-Mode\s+Deploy\b/);
  assert.doesNotMatch(
    runs(preview),
    /-Mode\s+Deploy\b|-ApproveDeployment\b|\baz\s+deployment\s+\w+\s+create\b/,
  );
  assert.doesNotMatch(runs(deploy), /\baz\s+deployment\s+\w+\s+create\b/);
  assert.equal(
    deploy.env.FAMILY_INFRA_APPLY_ENABLED,
    "${{ vars.FAMILY_INFRA_APPLY_ENABLED }}",
  );
  assert.equal(
    deploy.env.FAMILY_INFRA_CAPACITY_CONFIRMED,
    "${{ vars.FAMILY_INFRA_CAPACITY_CONFIRMED }}",
  );
  for (const [job, mode] of [
    [preview, "WhatIf"],
    [deploy, "Deploy"],
  ]) {
    const loginIndex = steps(job).findIndex((step) =>
      step.uses?.startsWith("azure/login@"),
    );
    const checkIndex = steps(job).findIndex((step) =>
      new RegExp(
        `github-infra\\.ps1\\s+-Mode\\s+${mode}\\s+-CheckOnly\\b`,
      ).test(step.run || ""),
    );
    assert.ok(
      checkIndex >= 0 && checkIndex < loginIndex,
      "Configuration checks must run before Azure login.",
    );
  }
});

test("trusted revision and preview configuration are checked again after approval", () => {
  assert.equal(
    preview.outputs.configuration_hash,
    "${{ steps.preview.outputs.configuration_hash }}",
  );
  assert.equal(
    deploy.env.EXPECTED_CONFIGURATION_HASH,
    "${{ needs.preview.outputs.configuration_hash }}",
  );
  for (const job of [preview, deploy]) {
    const guards = actions(job, "actions/github-script");
    assert.equal(guards.length, 1);
    const script = guards[0].with.script;
    assert.match(script, /github\.rest\.git\.getRef/);
    assert.match(script, /process\.env\.FAMILY_INFRA_BRANCH/);
    assert.match(script, /current\.data\.object\.sha !== context\.sha/);
    assert.doesNotMatch(
      script,
      /(?:info|log|warning)\(\s*token\s*\)/,
      "OIDC bearer tokens must not be printed.",
    );
    assert.ok(
      steps(job).indexOf(guards[0]) <
        steps(job).findIndex((step) => step.uses?.startsWith("azure/login@")),
    );
    for (const step of steps(job).filter((step) => step.uses)) {
      assert.match(
        step.uses,
        /@[a-f0-9]{40}$/,
        "Every external action must use an immutable reviewed revision.",
      );
    }
  }
});

test("workflow does not deploy application code, migrate SQL or export settings/secrets", () => {
  const executable = Object.values(workflow.jobs)
    .map((job) => JSON.stringify(steps(job)))
    .join("\n");
  assert.doesNotMatch(
    executable,
    /webapps-deploy|dotnet\s+publish|dotnet\s+ef|sqlcmd|\bappsettings\b|keyvault|AZURE_CREDENTIALS|\bcreds\s*:/i,
  );
  assert.doesNotMatch(executable, /pull_request\.head|head_ref|workflow_run/);
  assert.doesNotMatch(
    executable,
    /az\s+role\s+assignment\s+create|az\s+ad\s+/i,
  );
});
