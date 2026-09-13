# Family invitation pilot — implementation contract

Approved scope for this iteration: Entra External ID login, one family/baby per account in the pilot, owner/caregiver invites/removal/leave, and a separate completed bottle-feed test ledger with offline Save and first-server-commit-wins. Synthetic data only. Existing local profiles, records, timers, learning, settings and backups are untouched and never uploaded. This is not full family synchronization or an external-TestFlight-ready release.

## API (JSON camelCase; GUID IDs; UTC ISO timestamps)

- `GET /health/live` public liveness; no sensitive details.
- `GET /v1/me` → `{ user: FamilyUser, families: FamilySummary[] }`.
- `POST /v1/families` `{ operationId, babyName }` → FamilySummary. Idempotent; one active family per account in pilot.
- `GET /v1/families/{id}/snapshot` → FamilySnapshot (see `src/family/contracts.ts`); authorization even for unchanged state; no tokens in response. Return ETag from historyId + revision + membershipId. Entire snapshot is consistent; optional `If-None-Match`.
- `POST /v1/families/{id}/invitations` `{ operationId, email }` → `{ invitation: FamilyInvitation, inviteUrl: string }`. Only owner. One active pending invitation per recipient; replace/revoke earlier one. Token returned only on initial issuance/retry if securely reproducible, otherwise retry returns `invitation_already_created` and instructs new invitation. Store token hash only; do not store URL/token in receipts or logs.
- `POST /v1/invitations/accept` `{ token, operationId }` → FamilySummary. Bind to verified recipient identity; atomic consume/membership grant; consumed-token retries cannot reactivate a removed membership.
- `POST /v1/families/{id}/invitations/{invitationId}/revoke` `{ operationId }` → `{ ok: true }`.
- `POST /v1/families/{id}/members/{userId}/remove` `{ operationId }` → `{ ok: true }`. Only owner, not self. Revokes membership AND all recipient's pending invitations atomically.
- `POST /v1/families/{id}/leave` `{ operationId }` → `{ ok: true }`. Caregiver only. Same revocation rule; owner must not orphan family.
- `POST /v1/families/{id}/feed-operations` FeedOperation → FeedReceipt. Grant/history mismatch terminal; version mismatch 412; same operation/payload returns receipt. All caregivers may edit/delete pilot feeds. Own drafts never sent until Save. Independent IDs retain overlaps. Limit note length and amount (0–2000 mL), completed start/end, end>=start and no future dates (small clock tolerance). Maximum pilot feed count bounded by configuration. Each accepted write increments revision in same transaction as its durable receipt.
- `GET /join` public static landing page. Link is `https://<api>/join#token=<base64url token>` so token is not sent in request URLs. No remote assets/tracking; explicit button opens `mylittledays://family-invite#token=...`; paste link fallback. GET never consumes invitation. Restrictive CSP/no-referrer/no-store.

Error JSON `{code}`: 401 `unauthorized`, 403 `pilot_not_admitted` / `forbidden` / `membership_revoked`, 409 `already_in_family` / `operation_reused` / `membership_changed` / `history_changed` / `invitation_already_created`, 410 `invitation_unavailable`, 412 `record_changed`, 422 `invalid_input`, 429 `rate_limited`. Unknown/wrong-recipient tokens share a generic unavailable response. No raw exception, email/name/token in logs.

## Identity and setup gate

Pilot defaults: invitations expire after 48 hours; baby names up to 60 characters, notes up to 500 characters, amounts 0–2000 mL with at most two decimal places. Four active members and 1,000 feed records (including tombstones) per family. Revocation remains available even when operation limits are reached.

API validates Entra v2 access JWT issuer/audience/expiry/signature, tenant `tid`, delegated `scp=Family.ReadWrite`, and mobile authorized party `azp`. Identify using validated tenant + `oid` (not email). For this controlled two-account pilot, configure verified `Pilot:Identities` bindings `{objectId,email,displayName}` after the operator checks each external-tenant email-OTP sign-in identity. Do not infer verified email from a generic mutable `email`/`preferred_username` claim. Unlisted identities get `pilot_not_admitted`; there is no test-auth bypass in deployed app. Open customer enrollment awaits the verified-claim spike. Owners can invite only admitted pilot recipients.

Public mobile settings: `EXPO_PUBLIC_FAMILY_API_URL`, `EXPO_PUBLIC_ENTRA_TENANT_ID`, `EXPO_PUBLIC_ENTRA_CLIENT_ID`, `EXPO_PUBLIC_ENTRA_API_SCOPE` (`api://<api-app-id>/Family.ReadWrite`). Tenant authority uses `https://<tenantId>.ciamlogin.com/<tenantId>/v2.0`. Native redirect `mylittledays://auth`. No secret in mobile. Browser production sign-in disabled; use native build.

API config: `ConnectionStrings:FamilyDatabase`; `Entra:TenantId`, `Entra:Audience` (API app client ID for v2 JWT), `Entra:MobileClientId`; `Pilot:Identities`; `Family:PublicBaseUrl`; `Family:HistoryId` (GUID unique to environment/history, change when restoring database); conservative `Pilot` limits. Fail closed if configuration is missing. Scoped family writes serialize with removal/regrant and use SQL transactions, not in-memory locks. EF SQL rowversion for record versions. New membership GUID for every new grant. Restore history and membership ID bind every queued mutation. Account switching/signout cannot replay another session's queue.

## Mobile behavior

Separate SQLite pilot database/keyspace, keyed by server-verified account ID and family. Cache, private feed draft, immutable outbox saved atomically. Only one unresolved operation per feed. Pending own changes projected once; rejected payload retained privately with clear message, latest snapshot refreshed. Re-authentication/network failure preserves queue. Refresh in foreground while pilot screen is active, not a background guarantee. Logout warns if private work remains, then explicitly discards pilot cache/drafts/queue and credentials; local-only app data stays. Removal clears accepted cache, stops sending and quarantines pending drafts. Rejoin never automatically resends old grant work. History change requires fresh cache and quarantines old operations. No export/import of pilot data yet.

## Gates

No Azure provisioning by agent this iteration. User sets infrastructure; supply exact setup guide and deployment configuration. No production deployment, real-history migration, public signup, or public beta until live login/verified binding, two-iPhone tests, deletion/privacy/reviewer-access/retention decisions and SQL restore/concurrency validation pass. The old full plan remains roadmap, amended by this narrower contract and review corrections.
