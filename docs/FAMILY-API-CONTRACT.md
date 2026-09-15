# Family-sharing API contract

Current full-history schema is version 2. Transport is authenticated HTTPS JSON with camel-case names. See [server configuration](../server/README.md#configuration-and-admission) and [Azure setup](AZURE-FAMILY-PILOT-SETUP.md). Version-1 bottle-only families remain separate; their original scope is documented in the [pilot contract](FAMILY-PILOT-CONTRACT.md).

## Full-history endpoints

| Method and path | Result |
| --- | --- |
| `GET /v2/capabilities` | `{schemaVersion:2,recordKinds:["feed","diaper","sleep","growth","milestone","care"],maxSeedBytes:10485760}` |
| `POST /v2/families` | Atomic owner setup and full snapshot |
| `GET /v2/families/{familyId}/snapshot` | Authorized full snapshot; supports `If-None-Match` |
| `POST /v2/families/{familyId}/record-operations` | Versioned entry/care create, update or delete |
| `POST /v2/families/{familyId}/profile` | Owner-only complete profile update |

Every endpoint uses the same JWT validation and account admission. Capability discovery exposes no family data. Family access requires an active membership.

### Owner setup

```json
{
  "operationId": "<new GUID>",
  "consentRevision": "family-sharing-v1",
  "seed": {
    "schemaVersion": 1,
    "source": {
      "schemaVersion": 1,
      "profile": {"name":"Luna","birthDate":"2026-01-15","sex":"female"},
      "entries": [],
      "careRecords": []
    },
    "inviteeEmails": ["caregiver@example.com"],
    "counts": {"feed":0,"diaper":0,"sleep":0,"growth":0,"milestone":0,"care":0,"total":0}
  }
}
```

Source matches local domain `State`; careRecords is optional. Counts are independently derived and checked; total includes both collections. Entry IDs must be unique within entries, and care IDs within care records; an ID may occur in both collections. Recipient emails are normalized, unique, valid and different from the creator. Up to 100 invitations are allowed; an empty list is accepted.

The server independently validates all source fields/records/counts. Seed JSON cannot exceed 10 MiB or include any running feed/sleep timer. Active timers return `422 running_timers`. Imported records are attributed to the uploading owner because the offline format has no verified multiple-user authors.

One SQL transaction commits family/profile, owner membership, every imported record, invitations and receipt. Response:

```text
{operationId, familyId, membershipId, historyId, seedDigest, snapshot: FullFamilySnapshot}
```

`seedDigest` is lowercase hexadecimal SHA-256 over the exact UTF-8 JSON bytes of the seed value received by the server. The client computes it from `JSON.stringify(seed)` before sending and retains the same seed serialization/property order for retries. The digest is stored in the minimal receipt; no copied seed/snapshot is stored there. It acknowledges the original atomic import even if family members later edit/delete records. The response snapshot is the current authorized state, so it need not still equal the original seed.

Persist the request operation ID/content and verify its returned digest, operation ID and destination family/grant/history before clearing local migration data. Retry identical content after an uncertain response; a removed/replaced grant or changed history cannot be revived. Different content with the same operation ID fails. An account already in a family cannot create another. Invitation acceptance accepts no seed and never uploads the invitee's local history.

### Full snapshot

```text
{
  schemaVersion: 2,
  profile: {name, birthDate, sex},
  entries: [{entry: Entry, version, recordedBy, lastEditedBy}],
  careRecords: [{record: CareRecord, version, recordedBy, lastEditedBy}],
  family: {id, babyName, role, membershipId, babyBirthDate, profileVersion},
  historyId, revision,
  members: [{id, displayName, email, role, membershipId, status, endedAt}],
  invitations: [{id, email, expiresAt, status}],
  ownershipTransfer: null | {id, fromUserId, toUserId, status, createdAt},
  feeds: []
}
```

Full clients consume entries/careRecords; empty feeds preserves the common lifecycle shape. Role is owner or caregiver. Author/editor are server-assigned account GUIDs. Record version and full profileVersion are opaque base64 SQL rowversions. Revision is an opaque decimal string. ProfileVersion can change after other family mutations; refresh and review before replacing a stale profile operation.

Owners receive invitation administration and ended membership history. Caregivers receive active members, null member emails and no invitations. Invitation expiry advances revision before computing the ETag. The ETag includes schema/history/revision/membership; authorization always precedes a possible 304 response.

### Record and profile operations

```text
{
  operationId: GUID, recordId: string, membershipId: GUID, historyId: GUID,
  kind: "create" | "update" | "delete", collection: "entry" | "care",
  baseVersion?: string, entry?: Entry, careRecord?: CareRecord
}
```

Create omits baseVersion; update/delete uses the exact last-read record version. Create/update supplies only the selected collection payload, with its ID exactly matching recordId. Delete supplies neither payload. Source ID spelling/case/trailing spaces are preserved; IDs need not be GUIDs. Ordinary deletion tombstones prevent ID reuse. Separate records may overlap in time, including independent active timers.

Owners can edit/delete any record; caregivers only their original contributions. Editing never changes the original author. An accepted no-op update still advances rowversion. Success returns `{operationId,historyId,revision}`; refresh to obtain the new versions.

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

Decimal values retain precision without the legacy two-decimal restriction. Unknown/duplicate domain JSON fields and caller-supplied authors fail. Each collection permits 100,000 records; ordinary tombstones count toward the cap. [Server limits](../server/README.md#limits-and-concurrency) document request, membership, operation-ledger and rate limits.

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

`POST /v1/account-deletion-status` is intentionally unauthenticated; `{deletionId,receiptSecret}` returns only deletion ID/status/request time for a matching secret. Account deletion uses `{operationId,receiptSecret}` and cannot delete an account that still owns an open family.

## Compatibility and errors

Migration preserves legacy families as schema 1. V2 snapshot/record/profile calls reject them with `409 family_schema_unsupported`; legacy bottle/profile writes similarly reject full families. Full clients must not silently convert/project legacy snapshots. V1 lifecycle operations support either schema.

Durable operation IDs bind the account and request fingerprint. Record/profile requests bind current history and membership. Rejoining creates a new grant; old queued work cannot apply. Restored histories invalidate old operations. Retry lost responses with the same durable operation; review conflicts before issuing replacements.

Errors return `{code}` without private payloads or raw exceptions. Relevant codes: unauthorized; forbidden/record_forbidden/membership_revoked/identity_not_supported; operation_reused/already_in_family/membership_changed/history_changed/family_schema_unsupported; account_deleted/invitation_unavailable; record_changed/profile_changed; invalid_input/running_timers; rate_limited; identity_unavailable/service_unavailable. Static admission uses pilot_not_admitted. Access revocation and leaving remain possible at the ordinary write cap.
