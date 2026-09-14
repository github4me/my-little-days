import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import type {
  FamilySnapshot,
  SharedFeed,
  FeedReceipt,
  FeedOperation,
  AccountDeletion,
} from "./contracts";
import type { PilotIdentity } from "./identity";
import { familyConfig } from "./config";
import * as auth from "./auth";
import { familyRequest, PilotApiError } from "./api";
import { clearPilot, loadPilot, savePilot } from "./pilotStorage";
import {
  loadDeletionReceipt,
  saveDeletionReceipt,
  clearDeletionReceipt,
  type DeletionReceipt,
} from "./deletionReceipt";
import {
  acceptReceipt,
  applySnapshot,
  emptyPilotState,
  enqueue,
  feedFromDraft,
  projectedFeeds,
  pendingForSend,
  rejectOperation,
  revokeCache,
  originForSnapshot,
  matchesOrigin,
  canEditSharedFeed,
  type FeedDraft,
  type PilotState,
  type PilotTransition,
} from "./pilotState";

const errorCode = (error: unknown) =>
  error instanceof Error && /^[a-z_]+$/.test(error.message)
    ? error.message
    : "request_failed";
const retryable = (error: unknown) =>
  !(error instanceof PilotApiError) ||
  error.status === 0 ||
  error.status === 408 ||
  error.status === 429 ||
  error.status >= 500;

export function useFamilyPilot() {
  const configured = !!familyConfig,
    webUnsupported = Platform.OS === "web";
  const [identity, setIdentity] = useState<PilotIdentity | null>(null);
  const [deletionStatus, setDeletionStatus] = useState<AccountDeletion | null>(
    null,
  );
  const [state, setState] = useState<PilotState>(emptyPilotState);
  const [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const current = useRef(state),
    durable = useRef(state),
    who = useRef(identity),
    epoch = useRef(0),
    mounted = useRef(true);
  const commands = useRef(false),
    syncLock = useRef<Promise<void> | null>(null);
  const authenticating = useRef(false);
  const lifecycleActive = useRef(false);
  const signedOut = useRef(false);
  const logoutAccount = useRef<string | null>(null);
  const cleanupPending = useRef(false);
  const authPaused = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const requests = useRef(new AbortController());
  const foreground = useRef(AppState.currentState === "active");
  const failures = useRef(0),
    nextRefresh = useRef(0);
  const isCurrent = (e: number) => mounted.current && e === epoch.current;
  const check = (e: number) => {
    if (!isCurrent(e)) throw new Error("session_changed");
  };
  const accountKey = (id: string) =>
    `${familyConfig?.apiUrl}|${familyConfig?.tenantId}|${id}`;
  function showIdentity(value: PilotIdentity | null) {
    who.current = value;
    if (mounted.current) setIdentity(value);
  }
  function showState(value: PilotState, committed = false) {
    if (committed) durable.current = value;
    current.current = value;
    if (mounted.current) setState(value);
  }
  function family() {
    if (current.current.transition) throw new Error("transition_pending");
    if (who.current?.accountDeletion) throw new Error("account_deleted");
    const f = current.current.snapshot?.family;
    if (!f) throw new Error("family_unavailable");
    return f;
  }
  function ownerFamily() {
    const f = family();
    if (f.role !== "owner") throw new Error("owner_required");
    return f;
  }
  async function persist(
    change: (s: PilotState) => PilotState,
    e = epoch.current,
    rollbackOnFailure = true,
  ) {
    check(e);
    const id = who.current?.user.id;
    if (!id) throw new Error("sign_in_required");
    const previous = current.current,
      next = change(previous);
    showState(next);
    // Register the write immediately in the platform-wide ordered store. An
    // already accepted local Save may finish after navigation, for this account
    // only; a reopened screen waits behind it before loading its cache.
    const write = savePilot(accountKey(id), next).then(() => {
      if (isCurrent(e)) durable.current = next;
    });
    writes.current = write.catch(() => {});
    try {
      await write;
      check(e);
    } catch (cause) {
      if (rollbackOnFailure && isCurrent(e) && current.current === next)
        showState(previous);
      if (isCurrent(e)) setError("local_save_failed");
      throw new Error(isCurrent(e) ? "local_save_failed" : "session_changed");
    }
  }
  async function identify(e: number, expectedAccountId?: string) {
    const result = await familyRequest<PilotIdentity>(
      "/v1/me",
      undefined,
      requests.current.signal,
    );
    check(e);
    if (!result?.user?.id || !Array.isArray(result.families))
      throw new Error("invalid_response");
    if (expectedAccountId && result.user.id !== expectedAccountId) {
      await auth.signOut();
      throw new Error("account_mismatch");
    }
    if (who.current && who.current.user.id !== result.user.id)
      throw new Error("session_changed");
    if (!who.current) {
      const stored = await loadPilot(accountKey(result.user.id));
      check(e);
      showState(stored, true);
    }
    showIdentity(result);
    const cached = current.current.snapshot;
    const revoked =
      cached &&
      !current.current.transition &&
      !result.families.some(
        (f) =>
          f.id === cached.family.id &&
          f.membershipId === cached.family.membershipId,
      );
    if (revoked) showState(revokeCache(current.current));
    // Save the newly verified grant independently of the SQLite cache. On a
    // subsequent launch it also prevents exposure of an obsolete row whose
    // cleanup failed because the disk was full.
    await auth.saveIdentity(result);
    check(e);
    if (revoked) await persist(revokeCache, e, false);
    return result;
  }
  async function snapshot(e: number, familyId: string) {
    const result = await familyRequest<FamilySnapshot>(
      `/v1/families/${familyId}/snapshot`,
      undefined,
      requests.current.signal,
    );
    check(e);
    if (
      result.family?.id !== familyId ||
      !result.members?.some(
        (m) =>
          m.id === who.current?.user.id &&
          m.membershipId === result.family.membershipId &&
          m.status === "active",
      )
    )
      throw new Error("invalid_response");
    const previous = current.current.snapshot;
    // Once the server has disproved the old grant/history, a local disk error
    // must not make that old family or obsolete admin permissions return.
    await persist((s) => applySnapshot(s, result), e, false);
    if (
      previous &&
      (previous.historyId !== result.historyId ||
        previous.family.membershipId !== result.family.membershipId)
    )
      setNotice("sharing_context_changed");
  }
  async function refreshMembership(e: number) {
    const me = await identify(e);
    const f = me.families[0];
    if (me.accountDeletion || !f) {
      await persist(revokeCache, e, false);
    } else {
      await snapshot(e, f.id);
    }
    return me;
  }
  async function resumeTransition(e: number) {
    const intent = current.current.transition;
    if (!intent) return;
    if (intent.userId !== who.current?.user.id)
      throw new Error("account_mismatch");
    if (intent.phase === "pending") {
      if (intent.origin) {
        const me = await identify(e);
        const grant = me.families.find(
          (f) =>
            f.id === intent.origin!.familyId &&
            f.membershipId === intent.origin!.membershipId,
        );
        // A lost departure response can be retried while no family is active.
        // Never apply an old command to a replacement membership (even when it
        // happens to be a new grant in the same family).
        const departedWithoutReplacement =
          !me.families.length && ["leave", "close"].includes(intent.kind);
        if (grant) await snapshot(e, grant.id);
        if (
          (!grant || !matchesOrigin(intent.origin, current.current.snapshot)) &&
          !departedWithoutReplacement
        ) {
          await persist(
            (s) => ({
              ...revokeCache(s),
              transition: {
                ...intent,
                phase: "rejected",
                error: "membership_changed",
              },
            }),
            e,
            false,
          );
          await refreshMembership(e);
          await persist((s) => ({ ...s, transition: null }), e, false);
          throw new Error("membership_changed");
        }
      }
      let receipt: DeletionReceipt | null = null;
      if (intent.kind === "delete-account") {
        receipt = await loadDeletionReceipt();
        if (
          !receipt ||
          receipt.deletionId !== intent.operationId ||
          receipt.apiUrl !== familyConfig?.apiUrl
        ) {
          receipt = {
            apiUrl: familyConfig!.apiUrl,
            deletionId: intent.operationId,
            receiptSecret: (randomUUID() + randomUUID()).replaceAll("-", ""),
            status: "pending",
            requestedAt: new Date().toISOString(),
          };
          await saveDeletionReceipt(receipt);
        }
        check(e);
        setDeletionStatus({
          deletionId: receipt.deletionId,
          status: receipt.status,
          requestedAt: receipt.requestedAt,
        });
      }
      try {
        const response = await familyRequest<AccountDeletion>(
          intent.path,
          {
            ...intent.body,
            operationId: intent.operationId,
            ...(intent.origin
              ? {
                  membershipId: intent.origin.membershipId,
                  historyId: intent.origin.historyId,
                }
              : {}),
            ...(receipt ? { receiptSecret: receipt.receiptSecret } : {}),
          },
          requests.current.signal,
        );
        check(e);
        if (receipt) {
          if (
            response.deletionId !== receipt.deletionId ||
            !response.requestedAt ||
            !["pending", "awaiting_identity_deletion", "completed"].includes(
              response.status,
            )
          )
            throw new Error("invalid_response");
          await saveDeletionReceipt({
            ...receipt,
            status: response.status,
            requestedAt: response.requestedAt,
          });
          check(e);
          setDeletionStatus(response);
        }
        await persist(
          (s) => ({
            ...(["leave", "close", "delete-account"].includes(intent.kind)
              ? revokeCache(s)
              : s),
            transition: { ...intent, phase: "committed" },
          }),
          e,
          false,
        );
      } catch (cause) {
        check(e);
        if (
          retryable(cause) ||
          ["sign_in_required", "unauthorized", "local_save_failed"].includes(
            errorCode(cause),
          )
        )
          throw cause;
        if (receipt) {
          await clearDeletionReceipt();
          setDeletionStatus(null);
        }
        await persist(
          (s) => ({
            ...s,
            transition: {
              ...intent,
              phase: "rejected",
              error: errorCode(cause),
            },
          }),
          e,
          false,
        );
      }
    }
    // A response is not a replacement dataset. Keep the workspace frozen until
    // verified membership and its full snapshot are durably refreshed.
    await refreshMembership(e);
    const failure = current.current.transition?.error;
    await persist((s) => ({ ...s, transition: null }), e, false);
    if (failure) throw new Error(failure);
  }
  async function runSync() {
    if (
      !configured ||
      webUnsupported ||
      !foreground.current ||
      authenticating.current ||
      lifecycleActive.current ||
      signedOut.current ||
      authPaused.current
    )
      return;
    const e = epoch.current;
    setSyncing(true);
    try {
      const me = await identify(e);
      if (current.current.transition) {
        await resumeTransition(e);
        failures.current = 0;
        nextRefresh.current = Date.now() + 30000;
        setError(null);
        return;
      }
      const f = me.families[0];
      if (!f || me.accountDeletion) {
        if (
          current.current.snapshot ||
          current.current.draft ||
          current.current.queue.length
        ) {
          await persist(revokeCache, e, false);
          setNotice("membership_revoked");
        }
        failures.current = 0;
        nextRefresh.current = Date.now() + 30000;
        return;
      }
      // Refresh grants/history before sending offline work, not merely after it.
      await snapshot(e, f.id);
      const work = pendingForSend(durable.current, current.current);
      for (const q of work) {
        check(e);
        if (!foreground.current) break;
        const op = pendingForSend(durable.current, current.current).find(
          (x) =>
            x.operation.operationId === q.operation.operationId &&
            x.status === "pending",
        )?.operation;
        if (!op) continue;
        try {
          const receipt = await familyRequest<FeedReceipt>(
            `/v1/families/${f.id}/feed-operations`,
            op,
            requests.current.signal,
          );
          check(e);
          await persist((s) => acceptReceipt(s, op.operationId, receipt), e);
        } catch (cause) {
          check(e);
          const code = errorCode(cause);
          if (
            code === "sign_in_required" ||
            code === "unauthorized" ||
            (cause instanceof PilotApiError && cause.status === 401)
          )
            throw new Error("sign_in_required");
          if (retryable(cause)) throw cause;
          await persist((s) => rejectOperation(s, op.operationId, code), e);
          setNotice("change_not_shared");
          if (
            ["forbidden", "membership_revoked", "pilot_not_admitted"].includes(
              code,
            )
          ) {
            await persist(revokeCache, e, false);
            throw cause;
          }
          if (code === "history_changed" || code === "membership_changed")
            break;
          // Independent records continue even if one edit was rejected.
        }
      }
      await snapshot(e, f.id);
      failures.current = 0;
      nextRefresh.current = Date.now() + 30000;
      setError(null);
    } catch (cause) {
      if (!isCurrent(e)) return;
      const code = errorCode(cause);
      if (code === "sign_in_required" || code === "unauthorized")
        authPaused.current = true;
      if (
        ["forbidden", "membership_revoked", "pilot_not_admitted"].includes(
          code,
        ) &&
        who.current
      ) {
        await persist(revokeCache, e, false).catch(() => {});
      }
      failures.current = Math.min(5, failures.current + 1);
      nextRefresh.current =
        Date.now() + Math.min(300000, 15000 * 2 ** failures.current);
      setError(code);
    } finally {
      if (isCurrent(e)) setSyncing(false);
    }
  }
  function sync() {
    if (syncLock.current) return syncLock.current;
    const promise = runSync();
    syncLock.current = promise;
    void promise.finally(() => {
      if (syncLock.current === promise) syncLock.current = null;
    });
    return promise;
  }
  async function refreshNow() {
    if (syncLock.current) await syncLock.current;
    return sync();
  }
  async function action<T>(
    task: (e: number) => Promise<T>,
    allowTransition = false,
  ): Promise<T> {
    if (commands.current) throw new Error("action_busy");
    commands.current = true;
    setBusy(true);
    setError(authPaused.current ? "sign_in_required" : null);
    setNotice(null);
    const e = epoch.current;
    try {
      if (current.current.transition && !allowTransition)
        throw new Error("transition_pending");
      return await task(e);
    } catch (cause) {
      if (isCurrent(e)) setError(errorCode(cause));
      throw cause;
    } finally {
      commands.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const start = useCallback(async () => {
    if (!configured || webUnsupported) return;
    const e = epoch.current;
    try {
      const deletion = await loadDeletionReceipt();
      check(e);
      if (deletion && deletion.apiUrl === familyConfig?.apiUrl)
        setDeletionStatus({
          deletionId: deletion.deletionId,
          status: deletion.status,
          requestedAt: deletion.requestedAt,
        });
      if (!(await auth.hasSession())) return;
      const cached = await auth.loadIdentity();
      check(e);
      if (cached) {
        const stored = await loadPilot(accountKey(cached.user.id));
        check(e);
        showIdentity(cached);
        const source = stored.snapshot?.family;
        const cachedGrant = source
          ? cached.families.find(
              (f) =>
                f.id === source.id && f.membershipId === source.membershipId,
            )
          : undefined;
        const grantMatches = !source || !!cachedGrant;
        const cachedState =
          cachedGrant && stored.snapshot
            ? applySnapshot(stored, { ...stored.snapshot, family: cachedGrant })
            : stored;
        showState(
          grantMatches || stored.transition ? cachedState : revokeCache(stored),
          true,
        );
        if (!grantMatches && !stored.transition)
          await persist(revokeCache, e, false);
      }
      await sync();
    } catch (cause) {
      if (isCurrent(e)) setError(errorCode(cause));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void start();
    const subscription = AppState.addEventListener("change", (value) => {
      foreground.current = value === "active";
      if (foreground.current && who.current) void sync();
    });
    const timer = setInterval(() => {
      if (
        who.current &&
        foreground.current &&
        Date.now() >= nextRefresh.current
      )
        void sync();
    }, 5000);
    return () => {
      mounted.current = false;
      epoch.current++;
      requests.current.abort();
      subscription.remove();
      clearInterval(timer);
    };
  }, [start]);

  async function mutate(
    path: string,
    body: Record<string, unknown>,
    e: number,
    kind: PilotTransition["kind"] = "manage",
  ) {
    lifecycleActive.current = true;
    try {
      await syncLock.current;
      check(e);
      if (current.current.transition) throw new Error("transition_pending");
      if (!who.current || who.current.accountDeletion)
        throw new Error("account_deleted");
      const intent: PilotTransition = {
        operationId: randomUUID(),
        path,
        body,
        kind,
        userId: who.current.user.id,
        familyId: current.current.snapshot?.family.id,
        ...(["manage", "leave", "close"].includes(kind) &&
        current.current.snapshot
          ? { origin: originForSnapshot(current.current.snapshot) }
          : {}),
        phase: "pending",
      };
      await persist((s) => ({ ...s, transition: intent }), e);
      await resumeTransition(e);
    } finally {
      lifecycleActive.current = false;
    }
  }
  return {
    configured,
    webUnsupported,
    user: identity?.user ?? null,
    snapshot: state.transition ? null : state.snapshot,
    feeds: projectedFeeds(state, identity?.user.id ?? ""),
    draft: state.transition ? null : state.draft,
    pending: state.transition
      ? []
      : state.queue.filter((q) => q.status === "pending"),
    conflicts: state.transition
      ? []
      : state.queue.filter((q) => q.status === "failed"),
    inbox: identity?.pendingInvitations ?? [],
    accountDeletion: identity?.accountDeletion ?? null,
    deletionStatus,
    dismissDeletionStatus: () =>
      action(async () => {
        const receipt = await loadDeletionReceipt();
        if (receipt?.status !== "completed")
          throw new Error("deletion_pending");
        await clearDeletionReceipt();
        setDeletionStatus(null);
      }),
    checkDeletionStatus: () =>
      action(async (e) => {
        const receipt = await loadDeletionReceipt();
        if (!receipt || receipt.apiUrl !== familyConfig?.apiUrl)
          throw new Error("deletion_receipt_unavailable");
        const statusRequest = new AbortController();
        const abortStatus = () => statusRequest.abort();
        const sessionSignal = requests.current.signal;
        sessionSignal.addEventListener("abort", abortStatus);
        const timeout = setTimeout(abortStatus, 15000);
        let response: Response;
        try {
          response = await fetch(
            `${receipt.apiUrl}/v1/account-deletion-status`,
            {
              method: "POST",
              credentials: "omit",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                deletionId: receipt.deletionId,
                receiptSecret: receipt.receiptSecret,
              }),
              signal: statusRequest.signal,
            },
          );
        } finally {
          clearTimeout(timeout);
          sessionSignal.removeEventListener("abort", abortStatus);
        }
        check(e);
        if (!response.ok) throw new Error("deletion_status_unavailable");
        const result = (await response.json()) as AccountDeletion;
        check(e);
        if (
          result.deletionId !== receipt.deletionId ||
          !result.requestedAt ||
          !["pending", "awaiting_identity_deletion", "completed"].includes(
            result.status,
          )
        )
          throw new Error("invalid_response");
        await saveDeletionReceipt({
          ...receipt,
          status: result.status,
          requestedAt: result.requestedAt,
        });
        check(e);
        setDeletionStatus(result);
        if (
          current.current.transition?.kind === "delete-account" &&
          current.current.transition.operationId === receipt.deletionId &&
          who.current
        ) {
          await persist(
            (s) => ({ ...revokeCache(s), transition: null }),
            e,
            false,
          );
          const deletedIdentity = {
            ...who.current,
            families: [],
            pendingInvitations: [],
            accountDeletion: result,
          };
          showIdentity(deletedIdentity);
          await auth.saveIdentity(deletedIdentity);
        }
        setError(null);
        return result;
      }, true),
    transitionPending: !!state.transition,
    canEditFeed: (feed: SharedFeed) =>
      !!state.snapshot &&
      !state.transition &&
      canEditSharedFeed(state.snapshot, feed),
    busy,
    syncing,
    error,
    notice,
    hasPrivateWork:
      !!state.draft || state.queue.some((q) => q.status !== "accepted"),
    signIn: () =>
      action(async (e) => {
        if (cleanupPending.current) throw new Error("sign_out_failed");
        if (!configured) throw new Error("not_configured");
        if (webUnsupported) throw new Error("native_required");
        authenticating.current = true;
        const previous = who.current;
        try {
          await syncLock.current;
          await writes.current;
          check(e);
          await auth.signIn(previous?.user.email);
          check(e);
          signedOut.current = false;
          authPaused.current = false;
          // Preserve previous work on disk, but don't show it under a new identity.
          showIdentity(null);
          showState(emptyPilotState(), true);
          await identify(e, previous?.user.id);
        } finally {
          authenticating.current = false;
        }
        await refreshNow();
      }, true),
    signOut: () =>
      action(async (beforeLogoutEpoch) => {
        lifecycleActive.current = true;
        try {
          await syncLock.current;
          check(beforeLogoutEpoch);
          // Commit the discard before deleting credentials. If the process dies
          // during final row cleanup, a later explicit login loads an EMPTY
          // workspace rather than resurrecting work the user discarded.
          if (who.current)
            await persist(() => emptyPilotState(), beforeLogoutEpoch);
          cleanupPending.current = true;
          logoutAccount.current = who.current?.user.id ?? logoutAccount.current;
          epoch.current++;
          const e = epoch.current;
          signedOut.current = true;
          authPaused.current = true;
          requests.current.abort();
          requests.current = new AbortController();
          syncLock.current = null;
          showIdentity(null);
          showState(emptyPilotState(), true);
          setSyncing(false);
          const results = await Promise.allSettled([
            auth.signOut(),
            (async () => {
              await writes.current;
              if (logoutAccount.current)
                await clearPilot(accountKey(logoutAccount.current));
            })(),
          ]);
          if (results.some((result) => result.status === "rejected")) {
            if (isCurrent(e)) setError("sign_out_failed");
            throw new Error("sign_out_failed");
          }
          logoutAccount.current = null;
          cleanupPending.current = false;
          setError(null);
          setNotice("signed_out");
        } finally {
          lifecycleActive.current = false;
        }
      }, true),
    refresh: () => refreshNow(),
    createFamily: (babyName: string) =>
      action(async (e) => {
        if (!babyName.trim() || babyName.trim().length > 60)
          throw new Error("invalid_input");
        await mutate(
          "/v1/families",
          { babyName: babyName.trim() },
          e,
          "create",
        );
      }),
    acceptInvitation: (id: string) =>
      action(async (e) => {
        await mutate(`/v1/invitations/${id}/accept`, {}, e, "join");
      }),
    declineInvitation: (id: string) =>
      action(async (e) => {
        await mutate(`/v1/invitations/${id}/decline`, {}, e);
      }),
    createInvitation: (email: string) =>
      action(async (e) => {
        const f = ownerFamily();
        await mutate(
          `/v1/families/${f.id}/invitations`,
          { email: email.trim() },
          e,
        );
      }),
    revokeInvitation: (id: string) =>
      action(async (e) => {
        await mutate(
          `/v1/families/${ownerFamily().id}/invitations/${id}/revoke`,
          {},
          e,
        );
      }),
    removeMember: (id: string) =>
      action(async (e) => {
        const target = current.current.snapshot?.members.find(
          (m) => m.id === id && m.status === "active",
        );
        if (!target) throw new Error("member_unavailable");
        await mutate(
          `/v1/families/${ownerFamily().id}/members/${id}/remove`,
          { targetMembershipId: target.membershipId },
          e,
        );
      }),
    leaveFamily: () =>
      action(async (e) => {
        if (family().role === "owner") throw new Error("owner_cannot_leave");
        await mutate(`/v1/families/${family().id}/leave`, {}, e, "leave");
      }),
    updateProfile: (babyName: string, babyBirthDate: string | null) =>
      action(async (e) => {
        const f = ownerFamily();
        await mutate(
          `/v1/families/${f.id}/profile`,
          { babyName, babyBirthDate, baseVersion: f.profileVersion },
          e,
        );
      }),
    nominateOwner: (userId: string) =>
      action(async (e) => {
        await mutate(
          `/v1/families/${ownerFamily().id}/ownership-transfer`,
          { userId },
          e,
        );
      }),
    cancelOwnership: () =>
      action(async (e) => {
        const f = ownerFamily(),
          transfer = current.current.snapshot?.ownershipTransfer;
        if (!transfer) throw new Error("transfer_unavailable");
        await mutate(
          `/v1/families/${f.id}/ownership-transfer/${transfer.id}/cancel`,
          {},
          e,
        );
      }),
    acceptOwnership: () =>
      action(async (e) => {
        const f = family(),
          transfer = current.current.snapshot?.ownershipTransfer;
        if (!transfer || transfer.toUserId !== who.current?.user.id)
          throw new Error("transfer_unavailable");
        await mutate(
          `/v1/families/${f.id}/ownership-transfer/${transfer.id}/accept`,
          {},
          e,
        );
      }),
    closeFamily: () =>
      action(async (e) => {
        const f = ownerFamily();
        if (
          current.current.snapshot?.members.some(
            (m) => m.status === "active" && m.id !== who.current?.user.id,
          )
        )
          throw new Error("family_has_members");
        await mutate(`/v1/families/${f.id}/close`, {}, e, "close");
      }),
    deleteAccount: () =>
      action(async (e) => {
        if (current.current.snapshot?.family.role === "owner")
          throw new Error("family_owner_cannot_delete");
        await mutate("/v1/account/delete", {}, e, "delete-account");
      }),
    beginFeed: (feed?: SharedFeed) =>
      action(async (e) => {
        const context = current.current.snapshot;
        if (!context) throw new Error("family_unavailable");
        if (feed) {
          feed = context.feeds.find((f) => f.id === feed!.id);
          if (!feed) throw new Error("record_changed");
          if (!canEditSharedFeed(context, feed))
            throw new Error("record_forbidden");
        }
        if (
          feed &&
          current.current.queue.some(
            (q) => q.operation.recordId === feed!.id && q.status !== "failed",
          )
        )
          throw new Error("record_pending");
        const end = new Date().toISOString(),
          start = new Date(Date.now() - 20 * 60000).toISOString();
        await persist(
          (s) => ({
            ...s,
            draft: {
              recordId: feed?.id ?? randomUUID(),
              baseVersion: feed?.version,
              start: feed?.start ?? start,
              end: feed?.end ?? end,
              amount: String(feed?.amount ?? 120),
              note: feed?.note ?? "",
              historyId: context.historyId,
              membershipId: context.family.membershipId,
              origin: originForSnapshot(context),
            },
          }),
          e,
        );
      }),
    setDraft: async (draft: FeedDraft) => {
      try {
        if (commands.current) throw new Error("action_busy");
        if (current.current.transition) throw new Error("transition_pending");
        if (
          !current.current.draft ||
          current.current.draft.recordId !== draft.recordId
        )
          throw new Error("draft_changed");
        await persist((s) => ({
          ...s,
          draft: {
            ...s.draft!,
            start: draft.start,
            end: draft.end,
            amount: draft.amount,
            note: draft.note,
          },
        }));
      } catch (cause) {
        if (mounted.current) setError(errorCode(cause));
        throw cause;
      }
    },
    discardDraft: () =>
      action(async (e) => {
        await persist((s) => ({ ...s, draft: null }), e);
      }),
    saveDraft: () =>
      action(async (e) => {
        const s = current.current,
          draft = s.draft;
        if (!draft || !s.snapshot) throw new Error("family_unavailable");
        if (!matchesOrigin(draft.origin, s.snapshot))
          throw new Error("membership_changed");
        if (draft.historyId !== s.snapshot.historyId)
          throw new Error("history_changed");
        if (draft.membershipId !== s.snapshot.family.membershipId)
          throw new Error("membership_changed");
        const op: FeedOperation = {
          operationId: randomUUID(),
          recordId: draft.recordId,
          kind: draft.baseVersion ? "update" : "create",
          baseVersion: draft.baseVersion,
          historyId: s.snapshot.historyId,
          membershipId: s.snapshot.family.membershipId,
          feed: feedFromDraft(draft),
        };
        await persist((value) => enqueue(value, op), e);
        setNotice("saved_locally");
        void refreshNow();
      }),
    deleteFeed: (id: string) =>
      action(async (e) => {
        const s = current.current,
          feed = s.snapshot?.feeds.find((f) => f.id === id);
        if (!feed || !s.snapshot) throw new Error("record_changed");
        if (!canEditSharedFeed(s.snapshot, feed))
          throw new Error("record_forbidden");
        const op: FeedOperation = {
          operationId: randomUUID(),
          recordId: id,
          kind: "delete",
          baseVersion: feed.version,
          historyId: s.snapshot.historyId,
          membershipId: s.snapshot.family.membershipId,
        };
        await persist((value) => enqueue(value, op), e);
        setNotice("saved_locally");
        void refreshNow();
      }),
    reviewConflict: (operationId: string) =>
      action(async (e) => {
        const s = current.current,
          item = s.queue.find(
            (q) =>
              q.operation.operationId === operationId && q.status === "failed",
          );
        if (!item || !s.snapshot) throw new Error("family_unavailable");
        if (!matchesOrigin(item.origin, s.snapshot))
          throw new Error("membership_changed");
        const latest = s.snapshot.feeds.find(
            (f) => f.id === item.operation.recordId,
          ),
          value = item.operation.feed ?? latest;
        if (!value) throw new Error("record_changed");
        if (latest && !canEditSharedFeed(s.snapshot, latest))
          throw new Error("record_forbidden");
        if (!latest && item.operation.kind !== "create")
          throw new Error("record_changed");
        await persist(
          (valueState) => ({
            ...valueState,
            draft: {
              recordId: latest?.id ?? randomUUID(),
              baseVersion: latest?.version,
              start: value.start,
              end: value.end,
              amount: String(value.amount),
              note: value.note,
              historyId: s.snapshot!.historyId,
              membershipId: s.snapshot!.family.membershipId,
              origin: item.origin,
            },
          }),
          e,
        );
        setNotice(latest ? "review_latest" : "review_as_new");
      }),
    discardConflict: (operationId: string) =>
      action(async (e) => {
        await persist(
          (s) => ({
            ...s,
            queue: s.queue.filter(
              (q) =>
                q.operation.operationId !== operationId ||
                q.status !== "failed",
            ),
          }),
          e,
        );
      }),
    reviewPrivateDraft: () =>
      action(async (e) => {
        const s = current.current;
        if (!s.draft || !s.snapshot) throw new Error("family_unavailable");
        if (!matchesOrigin(s.draft.origin, s.snapshot))
          throw new Error("membership_changed");
        const latest = s.snapshot.feeds.find((f) => f.id === s.draft!.recordId);
        if (latest && !canEditSharedFeed(s.snapshot, latest))
          throw new Error("record_forbidden");
        if (!latest && s.draft.baseVersion) throw new Error("record_changed");
        await persist(
          (value) => ({
            ...value,
            draft: {
              ...s.draft!,
              recordId: latest?.id ?? randomUUID(),
              baseVersion: latest?.version,
            },
          }),
          e,
        );
        setNotice(latest ? "review_latest" : "review_as_new");
      }),
  };
}
