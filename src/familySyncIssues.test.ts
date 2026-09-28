import test from "node:test";
import assert from "node:assert/strict";
import {
  dismissSyncIssues,
  familySyncIssues,
  initialSyncPresentation,
  updateSyncPresentation,
  visibleSyncIssues,
  type FamilySyncSource,
} from "./family/syncIssues";

const origin = {
  userId: "account-a",
  familyId: "family-a",
  membershipId: "membership-a",
  historyId: "history-a",
};
const conflict = (id: string, error = "record_changed") => ({
  operation: { operationId: id },
  origin,
  error,
});
function source(overrides: Partial<FamilySyncSource> = {}): FamilySyncSource {
  return {
    user: { id: origin.userId },
    snapshot: {
      family: { id: origin.familyId, membershipId: origin.membershipId },
      historyId: origin.historyId,
    },
    sharedMode: true,
    authStatus: "authenticated",
    error: null,
    notice: null,
    recordConflicts: [],
    conflicts: [],
    recordPending: [],
    pending: [],
    ...overrides,
  };
}

test("normal sharing, pending work and saved-local notices do not create issues", () => {
  const idle = source();
  assert.deepEqual(familySyncIssues(idle), []);
  assert.deepEqual(
    familySyncIssues(
      source({ recordPending: [conflict("pending")], notice: "saved_locally" }),
    ),
    [],
  );
  for (const notice of [
    "signed_out",
    "sign_in_cancelled",
    "review_latest",
    "review_as_new",
  ])
    assert.deepEqual(familySyncIssues(source({ notice })), []);
});

test("network, service, action and authentication failures remain actionable", () => {
  for (const error of [
    "network_unavailable",
    "service_unavailable",
    "request_failed",
    "local_save_failed",
    "record_forbidden",
  ])
    assert.equal(familySyncIssues(source({ error }))[0]?.code, error);
  assert.equal(
    familySyncIssues(source({ authStatus: "reauth_required" }))[0]?.code,
    "sign_in_required",
  );
  assert.deepEqual(familySyncIssues(source({ error: "sign_in_required" })), []);
  assert.deepEqual(
    familySyncIssues(source({ error: "sign_in_cancelled" })),
    [],
  );
});

test("important notices and every distinct preserved conflict create issues", () => {
  for (const notice of [
    "membership_revoked",
    "change_not_shared",
    "sharing_context_changed",
  ])
    assert.equal(familySyncIssues(source({ notice }))[0]?.code, notice);
  const issues = familySyncIssues(
    source({ recordConflicts: [conflict("a"), conflict("b")] }),
  );
  assert.equal(issues.length, 2);
  assert.notEqual(issues[0].key, issues[1].key);
});

test("dismissal survives polling and changes only presentation", () => {
  const input = source({
    error: "network_unavailable",
    recordConflicts: [conflict("a")],
  });
  const original = JSON.stringify(input);
  const dismissed = dismissSyncIssues(initialSyncPresentation(), input);
  for (let poll = 0; poll < 4; poll++) {
    const refreshed = JSON.parse(original) as FamilySyncSource;
    assert.deepEqual(visibleSyncIssues(dismissed, refreshed), []);
  }
  assert.equal(JSON.stringify(input), original);
});

test("a new conflict or different failure appears while dismissed issues stay hidden", () => {
  const first = source({
    error: "network_unavailable",
    recordConflicts: [conflict("a")],
  });
  const dismissed = dismissSyncIssues(initialSyncPresentation(), first);
  const next = source({
    error: "local_save_failed",
    recordConflicts: [conflict("a"), conflict("b")],
  });
  assert.deepEqual(
    visibleSyncIssues(dismissed, next).map((issue) => issue.code),
    ["local_save_failed", "record_changed"],
  );
  assert.deepEqual(
    visibleSyncIssues(dismissed, source({ error: "network_unavailable" })),
    [],
  );
});

test("a resolved issue reappears if it occurs again", () => {
  const failed = source({ error: "network_unavailable" });
  const dismissed = dismissSyncIssues(initialSyncPresentation(), failed);
  const recovered = updateSyncPresentation(dismissed, source());
  assert.equal(visibleSyncIssues(recovered, failed).length, 1);
});

test("dismissals are scoped to account, family, membership and history", () => {
  const failed = source({ error: "network_unavailable" });
  const dismissed = dismissSyncIssues(initialSyncPresentation(), failed);
  for (const changed of [
    source({ error: failed.error, user: { id: "account-b" } }),
    source({
      error: failed.error,
      snapshot: {
        ...failed.snapshot!,
        family: { ...failed.snapshot!.family, id: "family-b" },
      },
    }),
    source({
      error: failed.error,
      snapshot: {
        ...failed.snapshot!,
        family: { ...failed.snapshot!.family, membershipId: "membership-b" },
      },
    }),
    source({
      error: failed.error,
      snapshot: { ...failed.snapshot!, historyId: "history-b" },
    }),
  ])
    assert.equal(visibleSyncIssues(dismissed, changed).length, 1);
});

test("temporary snapshot masking during authentication does not repeat an unresolved banner", () => {
  const failed = source({
    error: "sign_in_required",
    authStatus: "reauth_required",
  });
  const dismissed = dismissSyncIssues(initialSyncPresentation(), failed);
  assert.deepEqual(
    visibleSyncIssues(dismissed, { ...failed, snapshot: null }),
    [],
  );
  const signedOut = updateSyncPresentation(
    dismissed,
    source({
      user: null,
      snapshot: null,
      sharedMode: false,
      authStatus: "signed_out",
    }),
  );
  assert.equal(visibleSyncIssues(signedOut, failed).length, 1);
});
