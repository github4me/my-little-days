# Family invitation pilot — revised contract

Updated 14 September 2026. Supersedes the token-link/all-caregivers-edit contract and conflicting roadmap sections.

## Scope

Controlled **synthetic-data** pilot: Entra External ID login, one family/baby per account, email invitation inbox, roles/ownership lifecycle, and a separate completed bottle-feed ledger. Original offline profiles, records, photos, timers, care, learning and backups are never uploaded, replaced or erased by pilot login/join/deletion. Production invitee-history replacement and owner-history migration are **not activated**. No family export/import exists; existing offline backup only exports the original offline dataset.

Public enrollment remains closed. `Pilot:Identities` binds operator-verified email-OTP identities to immutable customer-tenant object IDs. Invitations may precede registration/admission, but acceptance still requires a checked binding. Generic JWT `email`/`preferred_username` is not trusted. No invitation notifications, automatic joins, Entra groups or share-token links.

## Permissions and lifecycle

| Action | Admin/owner | Active caregiver |
| --- | --- | --- |
| Read/create test records | Yes | Yes |
| Edit/delete records | Any record | Own records |
| Edit baby profile | Yes | No |
| Invite/revoke/remove members | Yes | No |
| Leave | Transfer or close first | Yes |

- Invitations expire after **30 days**. Verified recipients explicitly accept/decline. Declined/expired/revoked invitations need a new invitation. Inbox previews show inviter/expiry, not baby data. Accepted membership binds to immutable user ID, not email.
- Joining warns that admins can remove access without advance notice, including access to one's own contributions, and edit/delete records. Ordinary departure retains accepted contributions. Offline devices can clear cached data only after detecting revocation.
- Only the owner edits the synthetic name/birth date. Shared photo upload remains deferred; real local photos are untouched.
- Ownership nomination targets an active member. On acceptance, both roles switch atomically; the former admin becomes a caregiver. Until then, roles stay unchanged. Removal/leave invalidates the nomination. Transfer does not delete an account.
- Leave/removal revokes access and unused invitations, retaining accepted contributions. Member status distinguishes active/left/removed. No departure-history cleanup option or personal archive.
- Owner account deletion is blocked until transfer completes or the owner removes other members and explicitly closes the family. Closure requires no other active members; access is soft-deleted immediately and content purge follows.
- **Account deletion differs from leaving:** disable access and purge associated app data and directory identity. This includes records created or last edited by the account (no prior-version reconstruction exists), associated memberships/invitations/receipts and identifying editor references. Small security/deletion-status tombstones remain; operational retention is a real-user release gate.

## API and synchronization

See `src/family/contracts.ts`, server `Contracts.cs` and `Program.cs` for exact camelCase wire types/routes. Mutations carry durable client `operationId`s; retries cannot regrant membership or repeat role transitions.

- `/v1/me`: verified user, active family, pending invitation inbox, deletion status.
- `/v1/families`: synthetic family creation; `/{id}/snapshot`: authorized consistent profile/member/feed/invitation/transfer state. Authorize before `304`.
- `/{id}/invitations`: email-only creation; `/v1/invitations/{id}/accept` and `/decline`: recipient decisions. Owner revocation/removal and caregiver leave are separate commands.
- Profile, ownership nomination/accept/cancel, family close and account deletion use explicit endpoints. Original-author/admin record permissions are enforced by the server, not only hidden buttons.
- `/v1/account-deletion-status`: unauthenticated **status-only** receipt lookup. High-entropy secret stored only as a hash server-side; native receipt lives in device-only SecureStore and survives sign-out. No secret in URLs/logs, no family content returned.

Legacy token-link clients are retired; coordinate updated API/mobile builds. This is not a backwards-compatible contract for the earlier unreleased pilot.

Drafts remain local until explicit Save durably queues before network. Independent overlapping IDs are retained. First successful server commit for a record version wins; conflicts refresh current data and can only be reviewed within the **same account/family/membership grant/history**.

Draft/outbox origin is immutable. No Review/Save rebinding across contexts. Leave/removal/context replacement purges cache, drafts and pending/failed operations. Legacy unbound private pilot work is discarded, not guessed into a family; original offline records remain intact.

Membership refresh precedes queued writes. Lifecycle intents persist before network with stable IDs; uncertain leave/join/close results freeze the workspace until retry/reconciliation, including across restart. Replacement requires a valid matching snapshot. Session guards reject late responses. Logout clears pilot cache/credentials after warning, not membership. Rejoining after departure needs a new invitation/grant.

SQL transaction-owned locks serialize authorization and writes across instances. Record rowversion, family revision and receipt commit together. Rotate `Family__HistoryId` on database restore. Revoked grants, closed families and deleting accounts cannot replay old receipts to regain access.

## Deletion processing and release gates

The durable worker purges closed-family/account content and retries directory cleanup. Graph `DELETE /users/{id}` only soft-deletes; the provider also permanently deletes `directory/deletedItems/{id}`. Missing credentials, permission errors, transient missing items and outages remain pending. Status receipts let the device check completion without a surviving login. No assumed 30-day account-data retention.

Directory credentials belong to a separate confidential app in the **customer external tenant**, stored server-side via Key Vault. Hosting-tenant managed identity remains for SQL/Key Vault; it cannot be assumed to work directly across tenants. Deletion accepts only exact admitted customer object IDs, never administrator identities.

Pilot admission configuration itself contains email/name/object ID. Operator removal of those bindings/configuration history and cleanup of diagnostics/backups remain **real-user release gates**. SQL/directory completion is not proof those copies disappeared. A restore must replay deletions/revocations before reopening traffic. Native storage/OS backup protection, live Entra/Graph/Azure, two-iPhone behavior, full-domain sharing/history migration, shared photos, public onboarding and store/privacy disclosures remain unverified or deferred. Do not call this pilot App-Store/privacy compliant based only on local tests.

Defaults: four members, 1,000 test feeds including tombstones, bounded operations, 16 KiB requests. [Azure setup](AZURE-FAMILY-PILOT-SETUP.md), [validation](VALIDATION.md).

Sources: [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Graph user deletion](https://learn.microsoft.com/en-us/graph/api/user-delete?view=graph-rest-1.0), [permanent directory deletion](https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-delete?view=graph-rest-1.0).
