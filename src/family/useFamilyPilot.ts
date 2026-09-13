import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import type {
  FamilySummary,
  FamilySnapshot,
  SharedFeed,
  FeedReceipt,
  FeedOperation,
} from "./contracts";
import type { PilotIdentity } from "./identity";
import { familyConfig, parseInviteToken } from "./config";
import * as auth from "./auth";
import { familyRequest, PilotApiError } from "./api";
import { clearPilot, loadPilot, savePilot } from "./pilotStorage";
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
  type FeedDraft,
  type PilotState,
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
    const f = current.current.snapshot?.family;
    if (!f) throw new Error("family_unavailable");
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
    await auth.saveIdentity(result);
    check(e);
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
      !result.members?.some((m) => m.id === who.current?.user.id)
    )
      throw new Error("invalid_response");
    const previous = current.current.snapshot;
    await persist((s) => applySnapshot(s, result), e);
    if (
      previous &&
      (previous.historyId !== result.historyId ||
        previous.family.membershipId !== result.family.membershipId)
    )
      setNotice("sharing_context_changed");
  }
  async function runSync() {
    if (
      !configured ||
      webUnsupported ||
      !foreground.current ||
      authenticating.current ||
      signedOut.current ||
      authPaused.current
    )
      return;
    const e = epoch.current;
    setSyncing(true);
    try {
      const me = await identify(e);
      const f = me.families[0];
      if (!f) {
        if (
          current.current.snapshot ||
          current.current.queue.some((q) => q.status !== "failed")
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
  async function action<T>(task: (e: number) => Promise<T>): Promise<T> {
    if (commands.current) throw new Error("action_busy");
    commands.current = true;
    setBusy(true);
    setError(authPaused.current ? "sign_in_required" : null);
    setNotice(null);
    const e = epoch.current;
    try {
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
      if (!(await auth.hasSession())) return;
      const cached = await auth.loadIdentity();
      check(e);
      if (cached) {
        const stored = await loadPilot(accountKey(cached.user.id));
        check(e);
        showIdentity(cached);
        showState(stored, true);
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

  async function mutate(path: string, body: object, e: number) {
    const result = await familyRequest<unknown>(
      path,
      { operationId: randomUUID(), ...body },
      requests.current.signal,
    );
    check(e);
    await refreshNow();
    return result;
  }
  return {
    configured,
    webUnsupported,
    user: identity?.user ?? null,
    snapshot: state.snapshot,
    feeds: projectedFeeds(state, identity?.user.id ?? ""),
    draft: state.draft,
    pending: state.queue.filter((q) => q.status === "pending"),
    conflicts: state.queue.filter((q) => q.status === "failed"),
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
      }),
    signOut: () =>
      action(async () => {
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
      }),
    refresh: () => refreshNow(),
    createFamily: (babyName: string) =>
      action(async (e) => {
        if (!babyName.trim() || babyName.trim().length > 60)
          throw new Error("invalid_input");
        await mutate("/v1/families", { babyName: babyName.trim() }, e);
      }),
    acceptInvitation: (value: string) =>
      action(async (e) => {
        if (!familyConfig) throw new Error("not_configured");
        let token: string;
        try {
          token = parseInviteToken(value, familyConfig.apiUrl);
        } catch {
          throw new Error("invalid_invitation");
        }
        await mutate("/v1/invitations/accept", { token }, e);
      }),
    createInvitation: (email: string) =>
      action(async (e) => {
        const f = family();
        const result = await familyRequest<{ inviteUrl: string }>(
          `/v1/families/${f.id}/invitations`,
          { operationId: randomUUID(), email: email.trim() },
          requests.current.signal,
        );
        check(e);
        if (!familyConfig || !result.inviteUrl)
          throw new Error("invalid_response");
        parseInviteToken(result.inviteUrl, familyConfig.apiUrl);
        await refreshNow();
        return result.inviteUrl;
      }),
    revokeInvitation: (id: string) =>
      action(async (e) => {
        await mutate(
          `/v1/families/${family().id}/invitations/${id}/revoke`,
          {},
          e,
        );
      }),
    removeMember: (id: string) =>
      action(async (e) => {
        await mutate(`/v1/families/${family().id}/members/${id}/remove`, {}, e);
      }),
    leaveFamily: () =>
      action(async (e) => {
        await mutate(`/v1/families/${family().id}/leave`, {}, e);
        await persist(revokeCache, e, false);
      }),
    beginFeed: (feed?: SharedFeed) =>
      action(async (e) => {
        const context = current.current.snapshot;
        if (!context) throw new Error("family_unavailable");
        if (
          feed &&
          current.current.queue.some(
            (q) => q.operation.recordId === feed.id && q.status !== "failed",
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
            },
          }),
          e,
        );
      }),
    setDraft: async (draft: FeedDraft) => {
      try {
        if (commands.current) throw new Error("action_busy");
        if (
          !current.current.draft ||
          current.current.draft.recordId !== draft.recordId
        )
          throw new Error("draft_changed");
        await persist((s) => ({
          ...s,
          draft: {
            ...draft,
            membershipId: s.draft!.membershipId,
            historyId: s.draft!.historyId,
            baseVersion: s.draft!.baseVersion,
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
        const latest = s.snapshot.feeds.find(
            (f) => f.id === item.operation.recordId,
          ),
          value = item.operation.feed ?? latest;
        if (!value) throw new Error("record_changed");
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
        const latest = s.snapshot.feeds.find((f) => f.id === s.draft!.recordId);
        await persist(
          (value) => ({
            ...value,
            draft: {
              ...s.draft!,
              recordId: latest?.id ?? randomUUID(),
              baseVersion: latest?.version,
              historyId: s.snapshot!.historyId,
              membershipId: s.snapshot!.family.membershipId,
            },
          }),
          e,
        );
        setNotice(latest ? "review_latest" : "review_as_new");
      }),
  };
}
