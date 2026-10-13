# AI one-minute backend timeouts — 14 October 2026

Status: backend deployment completed. TestFlight client delivery is tracked separately.

The owner confirmed each AI stage may take up to one minute; nested stages do
not need to total three minutes. The backend change is exactly two literals in
`server/LittleDays.FamilyApi/SleepAiService.cs`: generation/repair shared budget
30→60 seconds and provider network timeout 25→60 seconds. Existing SDK network
retry remains zero, and the bounded invalid-output repair count is unchanged.
No model, prompt, schema, authentication, access, consent, provider setting,
retention, budget, Azure setting or infrastructure change is included.

## Frozen source and deployment

- GitHub plugin commit
  [`46a50aa9d1987d8f69c5e6c7f727893a72c54884`](https://github.com/github4me/my-little-days/commit/46a50aa9d1987d8f69c5e6c7f727893a72c54884)
  changed one file/two literals over fresh parent
  `5e5cc5fba097d643fefbce511e6a152ac1e0ce8a`, with a leased ref update.
  Remote replacement and locally tested production file were byte-identical:
  SHA-256 `269ab61b1ad9c5c4c6b718e8c0dc6321eae7a226b7a4b9ecad18ec95d4742ba7`.
- Fresh GitHub UI readback confirmed `family-pilot` and `family-database`
  restrict deployment to `feature/family-invitations`; neither has required
  reviewers or a wait timer, and administrator bypass is enabled. These are
  observed protections, not a claim of human approval enforcement. No rule was
  changed. Ordinary infrastructure enable/apply gates remain false.
- Existing deployment targets were verified: App Service
  `little-days-api-522fpstfbtds2`, SQL server
  `little-days-sql-522fpstfbtds2` / database `little-days-family`, resource group
  `my-little-days-pilot-rg`, hosting tenant
  `7b7e6e31-a778-4334-aee2-e969fa27fd0e`, subscription
  `4768a858-f23f-4a39-bb64-eabc9c142627`. No new slot/resource or settings change.
- **Deploy family API and database**,
  `.github/workflows/deploy-family-pilot.yml`, was dispatched once from the
  fixed trusted-branch SHA, inputs `database_bootstrapped=true`, `adopt_ef=false`.
  [Run 38464800939](https://github.com/github4me/my-little-days/actions/runs/38464800939),
  attempt 1, completed **2026-10-13 20:48:33 UTC** with all five jobs successful.
  Workflow and SQL migration files are unchanged from the previously deployed
  backend. Same-run verification precedes migration and deployment.
- CI command `dotnet test server/LittleDays.slnx --configuration Release`:
  API **Passed: 435, Failed: 0, Skipped: 0**; disposable-SQL migrator
  **Passed: 80, Failed: 0, Skipped: 0**. TypeScript, Watch and browser job passed.
  The separate local focused AI suite reported 167 passed before publication.
- Catalog/checksum-journal checks reported **zero pending scripts** before/apply/
  after; no scripts were applied. Temporary firewall rule
  `github-db-38464800939-1` was removed and its absence checked. Existing rules
  were preserved.
- Same-run artifact digests matched on download: API
  `ccd12dc03e2883dbfcd82f092fdb0d43167c5b85665fb825d45ea5cc0287089d`;
  database `62805aad1577387d8cff328e868eddfd96512dd7ed40804449e1ce176cd50fc2`.
  OneDeploy `427b3277-93fc-4c0a-9f39-828b0db85b64` succeeded at
  **20:48:28 UTC**; sequential bounded liveness passed at **20:48:29 UTC**.
  No restart or duplicate deployment was needed.
- Independent sequential anonymous checks at **20:49:46 UTC**: live/ready 200;
  session, AI capabilities and empty prediction POST 401. Health and anonymous
  boundaries do not establish signed-in SQL or real-provider timeout acceptance.

Evidence lives under `work/ai-timeout-release-20261014/backend/`:
`preflight.json`, `deployment-evidence.json`, `api-ci-evidence.txt`,
`migration-evidence.txt`, `deploy-evidence.txt`, `public-boundaries.json`.

No private records/tokens were used and no provider retention/spending dashboard
was accessed. No new manual account setup or credentials are required. Physical
device and authenticated live-model acceptance remain separate.
