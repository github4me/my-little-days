import type { FamilyAuthStatus } from "./useFamilyPilot";
import type { SharingOrigin } from "./pilotState";

type IssueOperation = {
  operation: { operationId: string };
  origin: SharingOrigin;
  error?: string;
};

export type FamilySyncSource = {
  user: { id: string } | null;
  snapshot: {
    family: { id: string; membershipId: string };
    historyId: string;
  } | null;
  sharedMode: boolean;
  authStatus: FamilyAuthStatus;
  error: string | null;
  notice: string | null;
  recordConflicts: readonly IssueOperation[];
  conflicts: readonly IssueOperation[];
  recordPending: readonly IssueOperation[];
  pending: readonly IssueOperation[];
};

export type FamilySyncIssue = {
  key: string;
  kind: "error" | "notice" | "record-conflict" | "feed-conflict";
  code: string;
};

const meaningfulNotices = new Set([
  "membership_revoked",
  "change_not_shared",
  "sharing_context_changed",
]);

export function familySyncIssues(source: FamilySyncSource): FamilySyncIssue[] {
  const issues: FamilySyncIssue[] = [];
  const staleAuthError =
    source.error === "sign_in_cancelled" ||
    (source.authStatus === "authenticated" &&
      ["sign_in_required", "unauthorized"].includes(source.error ?? ""));
  const error = source.error && !staleAuthError ? source.error : null;
  if (error) issues.push({ key: `error:${error}`, kind: "error", code: error });
  if (
    source.authStatus === "reauth_required" &&
    !["sign_in_required", "unauthorized"].includes(error ?? "")
  )
    issues.push({
      key: "error:sign_in_required",
      kind: "error",
      code: "sign_in_required",
    });
  if (
    source.notice &&
    meaningfulNotices.has(source.notice) &&
    source.notice !== error
  )
    issues.push({
      key: `notice:${source.notice}`,
      kind: "notice",
      code: source.notice,
    });
  for (const [kind, conflicts] of [
    ["record-conflict", source.recordConflicts],
    ["feed-conflict", source.conflicts],
  ] as const) {
    for (const conflict of conflicts) {
      const code = conflict.error ?? "record_changed";
      issues.push({
        key: JSON.stringify([kind, conflict.operation.operationId, code]),
        kind,
        code,
      });
    }
  }
  return issues;
}

type SyncContext = {
  accountId: string | null;
  familyId: string | null;
  membershipId: string | null;
  historyId: string | null;
};

export type SyncPresentation = {
  context: SyncContext;
  dismissed: readonly string[];
};

export function initialSyncPresentation(): SyncPresentation {
  return {
    context: {
      accountId: null,
      familyId: null,
      membershipId: null,
      historyId: null,
    },
    dismissed: [],
  };
}

function syncContext(
  source: FamilySyncSource,
  previous: SyncContext,
): SyncContext {
  const accountId = source.user?.id ?? null;
  if (source.snapshot)
    return {
      accountId,
      familyId: source.snapshot.family.id,
      membershipId: source.snapshot.family.membershipId,
      historyId: source.snapshot.historyId,
    };
  // The controller masks its snapshot during reauthentication/transitions. Queue
  // origins or the last verified context keep an unresolved issue dismissed.
  const origin = [
    ...source.recordConflicts,
    ...source.conflicts,
    ...source.recordPending,
    ...source.pending,
  ].find((item) => item.origin.userId === accountId)?.origin;
  if (source.sharedMode && origin)
    return {
      accountId,
      familyId: origin.familyId,
      membershipId: origin.membershipId,
      historyId: origin.historyId,
    };
  if (
    source.sharedMode &&
    accountId !== null &&
    previous.accountId === accountId
  )
    return previous;
  return { accountId, familyId: null, membershipId: null, historyId: null };
}

export function updateSyncPresentation(
  previous: SyncPresentation,
  source: FamilySyncSource,
): SyncPresentation {
  const context = syncContext(source, previous.context);
  const sameContext =
    context.accountId === previous.context.accountId &&
    context.familyId === previous.context.familyId &&
    context.membershipId === previous.context.membershipId &&
    context.historyId === previous.context.historyId;
  const currentKeys = new Set(
    familySyncIssues(source).map((issue) => issue.key),
  );
  const dismissed = sameContext
    ? previous.dismissed.filter((key) => currentKeys.has(key))
    : [];
  if (sameContext && dismissed.length === previous.dismissed.length)
    return previous;
  return { context, dismissed };
}

export function dismissSyncIssues(
  previous: SyncPresentation,
  source: FamilySyncSource,
): SyncPresentation {
  const current = updateSyncPresentation(previous, source);
  return {
    ...current,
    dismissed: familySyncIssues(source).map((issue) => issue.key),
  };
}

export function visibleSyncIssues(
  previous: SyncPresentation,
  source: FamilySyncSource,
): FamilySyncIssue[] {
  const current = updateSyncPresentation(previous, source);
  return familySyncIssues(source).filter(
    (issue) => !current.dismissed.includes(issue.key),
  );
}
