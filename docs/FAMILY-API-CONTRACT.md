# Family-sharing API contract

Current full-history schema is version 2, with shared extras schema version 1. Transport is authenticated HTTPS JSON with camel-case names. See [server configuration](../server/README.md#configuration-and-admission), [Azure setup](AZURE-FAMILY-SETUP.md) and [shared extras](FAMILY-EXTRAS.md). Version-1 bottle-only families remain separate; their original scope is documented in the [pilot contract](FAMILY-PILOT-CONTRACT.md).

## Full-history endpoints

| Method and path | Result |
| --- | --- |
| `GET /v2/capabilities` | `{schemaVersion:2,recordKinds:["feed","diaper","sleep","growth","milestone","care"],maxSeedBytes:33554432,extrasSchemaVersion:1}` |
| `POST /v2/families` | Atomic owner setup and full snapshot |
| `GET /v2/families/{familyId}/snapshot` | Authorized full snapshot; supports `If-None-Match` |
| `POST /v2/families/{familyId}/record-operations` | Versioned entry/care/extra create, update or delete |
| `POST /v2/families/{familyId}/profile` | Owner-only complete profile update |

Every endpoint uses the same JWT validation and account admission. Capability discovery exposes no family data. Family access requires an active membership.

### Owner setup

```json
{
  "operationId": "<new GUID>",
  "consentRevision": "family-sharing-v1",
  "declinePendingInvitations": true,
  "seed": {
    "schemaVersion": 1,
    "source": {
      "schemaVersion": 1,
      "profile": {"name":"Luna","birthDate":"2026-01-15","sex":"female"},
      "entries": [],
      "careRecords": []
    },
    "inviteeEmails": ["caregiver@example.com"],
    "counts": {"feed":0,"diaper":0,"sleep":0,"growth":0,"milestone":0,"care":0,"total":0},
    "extrasSchemaVersion": 1,
    "extraRecords": []
  }
}
```

Source matches local domain `State`; careRecords is optional. Counts are independently derived and checked; total includes entries and care records, not extras. IDs must be unique within each collection; an ID may occur in different collections. Recipient emails are normalized, unique, valid and different from the creator. A new family permits at most five invitees (or fewer if the configured total member limit is lower). The API accepts an empty list; the current mobile review requires 1–5 emails. Previously committed requests can replay their original receipts without applying a new invitation limit retroactively.

The server independently validates all source fields/records/counts and extras. Source history JSON cannot exceed 10 MiB; the complete seed with extras cannot exceed 32 MiB. A legacy seed without extras remains limited to 10 MiB. Seeds cannot include running feed/sleep timers; these return `422 running_timers`. Imported records, including extras, are attributed to the uploading owner because the offline format has no verified multiple-user authors.

New mobile reviews include `extrasSchemaVersion: 1` and every captured `extraRecords` item: current baby avatar, reminder rules and saved settings, play selections and all stored check-ins. The empty array above is valid only when there are no extra records to upload. The app requires extras-capable service support before dispatch, rechecks the reviewed personal source under its write barrier, and stops on unreadable or changed data. Device language/theme/view preferences, notification permission and notification delivery are not uploaded.

One SQL transaction commits family/profile, owner membership, every imported record, invitations and receipt. Response:

```text
{operationId, familyId, membershipId, historyId, seedDigest, snapshot: FullFamilySnapshot}
```

`seedDigest` is lowercase hexadecimal SHA-256 over the exact UTF-8 JSON bytes of the seed value received by the server. The client computes it from `JSON.stringify(seed)` before sending and retains the same seed serialization/property order for retries. The digest is stored in the minimal receipt; no copied seed/snapshot is stored there. It acknowledges the original atomic import even if family members later edit/delete records. The response snapshot is the current authorized state, so it need not still equal the original seed.

Persist the request operation ID/content, verify its returned digest, operation ID and destination family/grant/history, and validate and durably store the complete snapshot before clearing local migration data. Activation clears and replaces original personal history, recovery copies, avatar, reminders and play data without a recoverable personal copy. Retry identical content after an uncertain response; a removed/replaced grant or changed history cannot be revived. Different content with the same operation ID fails. An account already in a family cannot create another. Invitation acceptance accepts no seed and never uploads or merges the invitee's personal history or extras.

After explicit review/consent, `declinePendingInvitations: true` also declines all live incoming invitations in the creation transaction. Omitted/false consent with pending invitations returns `409 invitation_decline_consent_required` without creation or decline. The legacy `/v1/families` endpoint similarly refuses new creation with live incoming invitations; old successful receipts remain replayable. Expired, revoked and closed-family invitations are not auto-declined. A successful replay never declines invitations received after the original operation.

### Join a family and decline other invitations

`POST /v1/invitations/{invitationId}/accept` uses the shared lifecycle endpoint:

```json
{
  "operationId": "<new GUID>",
  "declineOtherInvitations": true,
  "requiredSchemaVersion": 2,
  "requiredExtrasSchemaVersion": 1
}
```

The full app shows the local-data replacement warning plus automatic-decline consent before sending. Only a successful server transaction accepts the chosen invitation, creates the membership and declines the account's other live incoming invitations. It validates the recipient, selected invitation, capacity, existing membership and requested target-family schema before mutation. Schema mismatch returns `409 family_schema_unsupported`; missing decline consent when other invitations exist returns `409 invitation_decline_consent_required`. Rejection/rollback does not change membership or invitations.

Keep this exact request and operation ID for retries. Consent/schema options are bound to the receipt; omitted legacy options retain their original receipt fingerprints. Changing the options is not a retry. Expired/revoked invitations, closed families and other recipients are untouched. Successful replays do not decline new invitations.

Invitation history exposes terminal status `declined` and optional `declineReason: "created_family" | "joined_family" | null`. Only the source family's admin receives this history; no destination family identifier is disclosed. While an account belongs to a family, `/v1/me` does not expose actionable incoming invitations.

Mobile activation waits for validation and durable storage of the authorized full snapshot, including extras, before clearing private data. If the server verifies that a **committed** creation/join grant has been revoked or replaced, the client retires the obsolete activation journal and clears its family cache without deleting untouched personal data or activating a replacement grant through that journal. Network/unknown-result failures remain retryable with the same operation. Previously committed joins into unsupported legacy families can be signed out of safely; new full-app joins require schema 2 and extras schema 1 before membership is committed. Signing an already joined account into another phone does not add a new destructive per-device migration.

### Full snapshot

```text
{
  schemaVersion: 2,
  profile: {name, birthDate, sex},
  entries: [{entry: Entry, version, recordedBy, lastEditedBy}],
  careRecords: [{record: CareRecord, version, recordedBy, lastEditedBy}],
  extrasSchemaVersion: 1,
  extraRecords: [{record: FamilyExtraRecord, version, recordedBy, lastEditedBy}],
  family: {id, babyName, role, membershipId, babyBirthDate, profileVersion},
  historyId, revision,
  members: [{id, displayName, email, role, membershipId, status, endedAt}],
  invitations: [{id, email, expiresAt, status, declineReason}],
  ownershipTransfer: null | {id, fromUserId, toUserId, status, createdAt},
  feeds: []
}
```

Full clients consume entries, careRecords and extraRecords; empty feeds preserves the common lifecycle shape. Role is owner or caregiver. Author/editor are server-assigned account GUIDs. Record version and full profileVersion are opaque base64 SQL rowversions. Revision is an opaque decimal string. ProfileVersion can change after other family mutations; refresh and review before replacing a stale profile operation. Avatar bytes are included in full snapshots, so large avatars increase transfer and cache size.

Owners receive invitation administration and ended membership history. Caregivers receive active members, null member emails and no invitations. Invitation expiry advances revision before computing the ETag. The ETag includes schema/history/revision/membership; authorization always precedes a possible 304 response.

### Record and profile operations

```text
{
  operationId: GUID, recordId: string, membershipId: GUID, historyId: GUID,
  kind: "create" | "update" | "delete", collection: "entry" | "care" | "extra",
  baseVersion?: string, entry?: Entry, careRecord?: CareRecord,
  extraRecord?: FamilyExtraRecord
}
```

Create omits baseVersion; update/delete uses the exact last-read record version. Create/update supplies only the selected collection payload, with its ID exactly matching recordId. Delete supplies no payload. Entry/care source ID spelling/case/trailing spaces are preserved; IDs need not be GUIDs. Extra IDs cannot have surrounding whitespace or control characters. Ordinary deletion tombstones prevent ID reuse. Separate records may overlap in time, including independent active timers.

Owners can edit/delete any record; caregivers only their original contributions. The singleton extras `avatar`, `play-selection` and `reminder-settings` are owner-only for all mutations. An extra's kind cannot change. Editing never changes the original author. An accepted no-op update still advances rowversion. Success returns `{operationId,historyId,revision}`; refresh to obtain the new versions.

Extra kinds are `avatar` (validated JPEG/PNG/HEIC/WebP data URL or null, at most 12 MiB decoded), `play-selection` (included/excluded activity IDs), `play-checkin` (day/activity ID), `reminder` (rule settings and an absolute `onceAt` for one-time rules), and `reminder-settings` (saved form settings or null). Singleton IDs equal their kind. See [the typed extra contract](../src/family/extras.ts) and [server validation](../server/LittleDays.FamilyApi/FamilyExtraValidation.cs) for exact fields and bounds. The avatar is the selected baby image, not the device photo library. Reminder rules are shared, while each device separately enables and schedules notification delivery.

Profile request:

```text
{operationId: GUID, membershipId: GUID, historyId: GUID,
 baseVersion: snapshot.family.profileVersion, profile: {name, birthDate, sex}}
```

All three profile fields are required. Only the owner can update them. Success returns current FamilySummary; refresh the full snapshot. Retry returns the current authorized summary without storing profile content in its receipt.

## Domain bounds

| Value | Accepted content |
| --- | --- |
| Record ID | Nonblank string, up to 128 characters |
| Profile name | Nonblank string, up to 100 characters |
| Birth date | Empty or valid YYYY-MM-DD, year 1900 or later |
| Note | String, including empty, up to 10,000 characters |
| Timestamp | Valid date/time from year 1900, explicit Z/offset, optional 1–3 millisecond digits; original spelling preserved |
| Feed kind | formula, expressed, breast-left, breast-right, breast-both; bottle amount 0–2000, no estimated direct-feed amount |
| Feed/sleep end | Optional; cannot precede start |
| Running feed | feedRunning:true with no end; regular operations only, not seed |
| Diaper | wet, dirty, mixed |
| Growth | At least one measurement: weight 0.1–200, length 10–250, head 10–100 |
| Milestone | Nonblank title, up to 200 characters |
| Care kind | temperature, bath, wash, oral, nails |
| Temperature | 25–45; method armpit, ear, forehead, rectal or other |

Decimal values retain precision without the legacy two-decimal restriction. Unknown/duplicate domain JSON fields and caller-supplied authors fail. The domain parser retains its historical per-collection validation ceiling, but the service now enforces a tighter **10,000 total record IDs per family across collections**, including ordinary tombstones. Aggregate ceilings also limit stored record JSON to 64 MiB (SQL UTF-16 bytes) and serialized snapshots to 32 MiB, with reserved envelope/member space. A seed below its upload-size ceiling can still exceed these aggregate limits. [Server limits](../server/README.md#limits-and-concurrency) document request, membership, operation-ledger and rate limits.

Capacity failures use explicit `409 family_record_limit`, `family_storage_limit`, `family_snapshot_limit` or `family_member_history_limit`; preserve local work for review instead of clearing it or retrying indefinitely. Excessive create/close cycling returns `429 family_creation_limit`. `503 recovery_blocked` means an operator has closed access during recovery verification; do not replace local state. Snapshot ETags are compared only after current account/grant/history authorization, before materializing unchanged record payloads. These changes do not add pagination or weaken conflict checks. See the [security release checklist](SECURITY-REMEDIATION-2026-09-17.md) before deploying to an existing database.

## Shared lifecycle

Full clients use these authenticated v1 routes:

| Route | Purpose |
| --- | --- |
| `GET /v1/me` | User, active family, recipient-scoped pending invitations and deletion status |
| `POST /v1/families/{familyId}/invitations` | Owner creates/replaces email invitation |
| `POST /v1/invitations/{invitationId}/accept` or `/decline` | Verified recipient accepts/declines |
| `POST /v1/families/{familyId}/invitations/{invitationId}/revoke` | Owner revokes pending invitation |
| `POST /v1/families/{familyId}/members/{userId}/remove` | Owner ends the specified grant |
| `POST /v1/families/{familyId}/leave` | Caregiver leaves, retaining contributions |
| `POST /v1/families/{familyId}/ownership-transfer` | Owner nominates an active member |
| `POST /v1/families/{familyId}/ownership-transfer/{transferId}/accept` or `/cancel` | Nominee accepts/owner cancels |
| `POST /v1/families/{familyId}/close` | Sole owner closes and schedules purge |
| `POST /v1/account/delete` | Durable account deletion with device secret receipt |

Grant-scoped mutations carry operationId/membershipId/historyId. Removal also carries targetMembershipId. Accept/decline have no prior grant and take an operation ID. Invitation creation adds email; nomination adds userId. See [Contracts.cs](../server/LittleDays.FamilyApi/Contracts.cs) for exact DTOs. Invitations last 30 days and appear in the app; there is no email dispatch, share-token URL or baby-data preview before acceptance.

The total active-member limit defaults to six (one admin plus five others) and caps older larger configuration values at six. Active non-admin members and distinct live pending invitations reserve the five other places; an invitation for an already active member cannot reserve another place. Replacing an existing live invitation adds no place. Decline, revocation, expiry or departure releases capacity. New creation/invitation/acceptance checks run inside the serialized transaction; existing over-limit members/history are not deleted. Ownership transfer retains the same family, records and original authors, and ordinary departure/removal retains accepted contributions.

`POST /v1/account-deletion-status` is intentionally unauthenticated; `{deletionId,receiptSecret}` returns only deletion ID/status/request time for a matching secret. Account deletion uses `{operationId,receiptSecret}` and cannot delete an account that still owns an open family.

## Compatibility and errors

Migration preserves legacy families as schema 1. V2 snapshot/record/profile calls reject them with `409 family_schema_unsupported`; legacy bottle/profile writes similarly reject full families. Full clients must not silently convert/project legacy snapshots. V1 lifecycle operations support either schema.

Shared extras require DbUp migration `0003_FamilySharedExtras.sql` before the compatible API and mobile update. It expands existing record constraints without replacing history. Optional extras fields preserve existing seed/operation fingerprints; current mobile activation requires extras capability and never silently drops personal extras to join an older service.

Durable operation IDs bind the account and request fingerprint. Record/profile requests bind current history and membership. Rejoining creates a new grant; old queued work cannot apply. Restored histories invalidate old operations. Retry lost responses with the same durable operation; review conflicts before issuing replacements.

Errors return `{code}` without private payloads or raw exceptions. Relevant codes: unauthorized; forbidden/record_forbidden/membership_revoked/identity_not_supported; operation_reused/already_in_family/membership_changed/history_changed/family_schema_unsupported; account_deleted/invitation_unavailable; record_changed/profile_changed; invalid_input/running_timers; rate_limited; identity_unavailable/service_unavailable. Static admission uses pilot_not_admitted. Access revocation and leaving remain possible at the ordinary write cap.
