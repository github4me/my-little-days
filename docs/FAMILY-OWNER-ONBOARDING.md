# First invitation — mobile and Azure handoff

> Archived pre-release design. The v2 implementation now supports real-history creation and shared main-app activation. Use [full Azure setup](AZURE-FAMILY-SETUP.md), [the current README](../README.en.md#family-sharing--full-record-integration-live-deployment-checks-remain) and the v2 API contract. Statements below about local-only preparation describe the earlier pilot, not current release behavior.

Status (14 September 2026): **mobile review/local preparation implemented; real-history upload and shared main-app activation are not implemented.** Deploying the current API or setting environment variables does not enable them. No Azure resources were changed for this iteration.

## Available on mobile now

- The first-invitation screen reviews the current baby's name, birth date and counts for feeding, nappies, sleep, growth, milestones and daily care, including temperature history.
- Enter up to three different family emails (four people including the admin in this pilot). Addresses are normalized and deduplicated; invalid addresses and self-invitations are rejected.
- Running feed/sleep timers must be stopped first. Review captures a validated copy, preserving record IDs, decimals and overlapping records. If the source changes before Save, review must be repeated.
- In a configured, signed-in native pilot with no family, confirmation **saves setup on this device only**. It creates no family, sends no invitation and uploads no records. The UI labels the draft “not sent”; it can be reviewed again or discarded. Original offline records remain unchanged.
- Local setup belongs to the API origin, tenant and signed-in account. It is stored in the pilot SQLite database, separately from the original offline records. Logout clears that account's pilot data and setup together. A storage/read failure does not silently replace a draft. This is ordinary app-private storage, not a secure-erasure or encrypted-database claim.
- The isolated `ui-preview` demo starts at **First invitation**, using fictional profile/history only. Confirming there simulates family creation and invitations and retains the complete sample source. Other scenarios cover accept/decline, permissions, removal, transfer, closure and deletion.
- Transfer wording explicitly says that acceptance gives the new admin control of **all data in the same family**. The old admin becomes a member; record authors remain unchanged; nothing is copied or re-imported.

Photos, device preferences, notification schedules and learning selections/check-ins are outside the source `State` and are explicitly excluded. They are not silently included in “all records”. No copy of a member's old family or personal history may enter another family through this owner preparation path.

Relevant mobile modules: `src/family/ownerSeed.ts`, `ownerSetupDraft.ts`, `OwnerSetup.tsx`, `OwnerSetupCard.tsx` and `demoScenarios.ts`. The canonical reviewed payload is:

```ts
type OwnerSeedDraft = {
  schemaVersion: 1;
  source: State; // src/domain.ts: profile + entries + careRecords, strictly validated
  inviteeEmails: string[];
  counts: { feed: number; diaper: number; sleep: number; growth: number;
            milestone: number; care: number; total: number };
};
```

The payload ceiling is **10 MiB UTF-8**, not a number of characters. Server validation must independently derive counts; client counts are for review, not trusted authority.

## What to prepare in Azure

Use [the Azure setup guide](AZURE-FAMILY-PILOT-SETUP.md) for the existing controlled pilot: customer Entra External ID tenant, mobile/API registrations, email-OTP flow, HTTPS .NET API, Azure SQL, managed identity and protected server-side deletion credentials. Family membership/invitations remain application database records, not Entra groups or B2B invitations. No email-sending service is needed for this version.

Return these **non-secret** values when ready:

1. Customer tenant ID and mobile client ID.
2. API client ID / delegated scope `api://<api-client-id>/Family.ReadWrite`.
3. Deployed HTTPS API origin.
4. Confirmation that `mylittledays://auth` is configured and two test accounts have checked identity bindings.

Do not send client secrets, access tokens, SQL passwords or API signing keys in chat. Hosting tenant/subscription IDs are deployment settings; they are not the mobile customer tenant ID.

## Required API extension before real data

This is the handoff specification, **not an already implemented endpoint contract**. Do not send this payload to the old `/v1/families` endpoint, which only creates a synthetic, empty feed pilot family.

1. **Capability gate:** an authenticated capability response must explicitly advertise the full-history schema and supported record kinds. Missing/old/partial support must block the client. The existing mobile preparation has no upload call; add that check when connecting the new service, not a permissive fallback to the old endpoint.
2. **One atomic create-with-invitations operation:** accept a durable client operation ID, explicit consent revision and the reviewed seed. Check the authenticated user has no family and is not deleting their account. Validate the complete source, membership limit and recipients. Commit the family, profile, all entry/care types, owner grant, pending invitations and operation receipt together. Activate nothing on partial failure. Reuse the same operation ID/body after a lost response; reject reusing it with a different body. If upload staging is needed, staging must not grant access or activate invitations.
3. **Acknowledgement and snapshot:** return the same family/history/grant, operation ID and consistent full snapshot with record versions and immutable authorship. Preserve imported record IDs within their family scope. Verify the seed was fully committed before mobile activation. Never substitute an empty/partial snapshot after an error.
4. **First import only:** later invitations operate on the existing family and do not run import again. Invitees explicitly accept or decline; acceptance downloads the owner's family and never uploads the invitee's local history. Keep their original local state until the accepted snapshot can be installed durably; warn before replacement.
5. **Ownership transfer:** an active nominated member explicitly accepts. Revalidate both memberships and the pending nomination in the same transaction. Change the admin and data-control relationship atomically, keeping family/history IDs, record IDs and authorship. Old-admin commands using stale permissions must fail and refresh.
6. **All-domain operations:** extend the existing versioned, first-server-commit-wins contract from bottle feeds to every shared record type and profile. Preserve independent overlaps. Recheck account, family, membership grant and history before every operation; never rebind a draft to a different family. Keep the agreed removal, account-deletion and retention rules distinct.

## Remaining mobile integration (not just Azure configuration)

Before real-family activation, wire the full-domain service into Today, Records/calendar, Growth and Care; add a durable create/join activation journal and consistent family cache; freeze/reconcile an uncertain migration; disable local backup/import for shared data; purge all family cache/drafts/queued work on detected revocation or logout. Original authorship and family scope must survive admin transfer. The current isolated bottle-feed pilot is not this shared main-app data layer.

Run two-iPhone acceptance with synthetic data first: create/retry after a lost response, join without personal-data merge, concurrent edits, role-transfer races, restart during replacement, offline removal detection, blocked exports and deletion completion. Enable real data only after these gates pass. The UI preview and JavaScript export do not validate Azure, real SQLite, native authentication or these migration gates.
