import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import type {
  FamilySnapshot,
  SharedFeed,
  FeedReceipt,
  FeedOperation,
  AccountDeletion,
  FullFamilySnapshot,
  FamilyCapabilities,
  FamilyActivation,
  FamilySummary,
  RecordOperation,
} from "./contracts";
import type { State, Entry, CareRecord } from "../domain";
import { serializeOwnerSeed, type OwnerSeedDraft } from "./ownerSeed";
import { loadPersonalExtras } from "./personalExtras";
import { drainReminderWrites } from "../personalWrites";
import type { FamilyExtraRecord } from "./extras";
import {
  clearFamilyReminders,
  suspendFamilyReminders,
  loadFamilyReminderOptIn,
  setFamilyReminderOptIn,
  syncFamilyReminders,
} from "./familyReminders";
import {
  clearPersonalForFamilyActivation,
  setPersonalStorageBlocked,
  drainPersonalStorageWrites,
  loadState,
} from "../storage";
import {
  acceptRecordReceipt,
  applyFullSnapshot,
  canEditRecord,
  enqueueRecord,
  isFullSnapshot,
  projectedFullState,
  projectedExtraRecords,
  recordsForSend,
  requireExtraCapabilities,
  validateFullSnapshot,
} from "./fullState";
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
const authenticationRequired = (cause: unknown) =>
  ["sign_in_required", "unauthorized"].includes(errorCode(cause)) ||
  (cause instanceof PilotApiError && cause.status === 401);

export type FamilyAuthStatus =
  | "signed_out"
  | "checking"
  | "authenticated"
  | "reauth_required"
  | "unverified";

export function useFamilyPilot() {
  const configured = !!familyConfig,
    webUnsupported = Platform.OS === "web";
  const [identity, setIdentity] = useState<PilotIdentity | null>(null);
  const [sessionUnresolved, setSessionUnresolved] = useState(
    configured && !webUnsupported,
  );
  const [authStatus, setAuthStatus] = useState<FamilyAuthStatus>(
    configured && !webUnsupported ? "checking" : "signed_out",
  );
  const [deletionStatus, setDeletionStatus] = useState<AccountDeletion | null>(
    null,
  );
  const [state, setState] = useState<PilotState>(emptyPilotState);
  const [ready, setReady] = useState(false);
  const verified = useRef(false);
  const [booting, setBooting] = useState(configured && !webUnsupported);
  const [activationSerial, setActivationSerial] = useState(0);
  const [notificationsEnabled, setNotificationsEnabledValue] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(
    null,
  );
  const notificationContext = useRef<string | null>(null);
  const notificationGeneration = useRef(0);
  const markReady = (value: boolean) => {
    verified.current = value;
    if (!value) void stopNotificationDelivery().catch(() => {});
    if (mounted.current) setReady(value);
  };
  const [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [notice, setNoticeValue] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeToken = useRef(0);
  const feedbackError =
    error === "sign_in_cancelled" ||
    (authStatus === "authenticated" &&
      (error === "sign_in_required" || error === "unauthorized"))
      ? null
      : error;
  const feedbackContext = JSON.stringify([
    identity?.user.id,
    state.snapshot?.family.id,
    state.snapshot?.family.membershipId,
    state.snapshot?.historyId,
    authStatus,
    feedbackError
      ? ["error", feedbackError]
      : notice && notice !== "saved_locally"
        ? ["notice", notice, noticeToken.current]
        : null,
  ]);
  const [feedbackPresentation, setFeedbackPresentation] = useState({
    context: feedbackContext,
    dismissedKey: null as string | null,
  });
  // The controller outlives individual tabs. Reset presentation when an issue
  // changes or resolves, even while its screen is unmounted; keep all data intact.
  const currentFeedback =
    feedbackPresentation.context === feedbackContext
      ? feedbackPresentation
      : { context: feedbackContext, dismissedKey: null };
  if (currentFeedback !== feedbackPresentation)
    setFeedbackPresentation(currentFeedback);
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
  const cacheRestored = useRef(false);
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
  function stopNotificationDelivery(clearPreference = false): Promise<void> {
    // Invalidate callbacks and the native foreground handler synchronously;
    // React effects can run later than a revoked grant or an expired token.
    const generation = ++notificationGeneration.current;
    notificationContext.current = null;
    if (mounted.current) setNotificationsEnabledValue(false);
    return (
      clearPreference ? clearFamilyReminders() : suspendFamilyReminders()
    ).catch((cause) => {
      if (mounted.current && notificationGeneration.current === generation)
        setNotificationError(
          cause instanceof Error ? cause.message : "request_failed",
        );
      throw cause;
    });
  }
  function setNotice(value: string | null) {
    const token = ++noticeToken.current;
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    if (mounted.current) setNoticeValue(value);
    if (value === "sign_in_cancelled") {
      const e = epoch.current;
      noticeTimer.current = setTimeout(() => {
        if (isCurrent(e) && token === noticeToken.current) {
          noticeTimer.current = null;
          setNoticeValue(null);
        }
      }, 5000);
    }
  }
  function pauseAuthentication() {
    if (signedOut.current) return;
    const alreadyPaused = authPaused.current;
    authPaused.current = true;
    setAuthStatus("reauth_required");
    markReady(false);
    if (!alreadyPaused && who.current)
      void auth
        .markReauthenticationRequired(who.current.user.id)
        .catch(() => {});
  }
  function requireAuthentication() {
    if (authPaused.current || signedOut.current)
      throw new Error("sign_in_required");
  }
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
    if (
      !state.snapshot ||
      !matchesOrigin(
        originForSnapshot(state.snapshot),
        current.current.snapshot,
      )
    )
      throw new Error("membership_changed");
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
    discardOwnerSetup = false,
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
    const write = savePilot(accountKey(id), next, {
      discardOwnerSetup:
        discardOwnerSetup ||
        next.transition?.kind === "delete-account" ||
        !!who.current?.accountDeletion,
    }).then(() => {
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
    let result: PilotIdentity;
    try {
      result = await familyRequest<PilotIdentity>(
        "/v1/me",
        undefined,
        requests.current.signal,
      );
    } catch (cause) {
      check(e);
      if (authenticationRequired(cause)) pauseAuthentication();
      else if (!authPaused.current) {
        setAuthStatus("unverified");
        void stopNotificationDelivery().catch(() => {});
      }
      throw cause;
    }
    check(e);
    if (!result?.user?.id || !Array.isArray(result.families)) {
      if (!authPaused.current) setAuthStatus("unverified");
      void stopNotificationDelivery().catch(() => {});
      throw new Error("invalid_response");
    }
    if (expectedAccountId && result.user.id !== expectedAccountId) {
      await stopNotificationDelivery(true).catch(() => {});
      check(e);
      await auth.signOut();
      check(e);
      signedOut.current = true;
      setSessionUnresolved(false);
      authPaused.current = false;
      setAuthStatus("signed_out");
      throw new Error("account_mismatch");
    }
    if (who.current && who.current.user.id !== result.user.id) {
      pauseAuthentication();
      throw new Error("account_mismatch");
    }
    authPaused.current = false;
    setAuthStatus("authenticated");
    if (!who.current || !cacheRestored.current) {
      const stored = await loadPilot(accountKey(result.user.id));
      check(e);
      showState(stored, true);
      cacheRestored.current = true;
    }
    showIdentity(result);
    setSessionUnresolved(false);
    const cached = current.current.snapshot;
    if (
      result.accountDeletion ||
      (cached?.family.role === "owner" &&
        result.families.some(
          (grant) =>
            grant.id === cached.family.id &&
            grant.membershipId === cached.family.membershipId &&
            grant.role !== "owner",
        ))
    )
      markReady(false);
    const revoked =
      cached &&
      !current.current.transition &&
      !result.families.some(
        (f) =>
          f.id === cached.family.id &&
          f.membershipId === cached.family.membershipId,
      );
    if (revoked) showState(revokeCache(current.current));
    if (revoked || result.accountDeletion) {
      // Clear before identity/cache writes: a stalled or failed disk write must
      // not leave this family's notifications active after verified removal.
      await stopNotificationDelivery(true).catch(() => {});
      check(e);
    }
    // Save the newly verified grant independently of the SQLite cache. On a
    // subsequent launch it also prevents exposure of an obsolete row whose
    // cleanup failed because the disk was full.
    await auth.saveIdentity(result);
    check(e);
    if (revoked || result.accountDeletion) {
      await persist(revokeCache, e, false, true);
    }
    return result;
  }
  async function snapshot(
    e: number,
    familyId: string,
    expected?: PilotTransition["activation"],
  ) {
    const result = await familyRequest<FullFamilySnapshot>(
      `/v2/families/${familyId}/snapshot`,
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
    if (
      expected &&
      (result.family.membershipId !== expected.membershipId ||
        (expected.historyId && result.historyId !== expected.historyId))
    )
      throw new Error("membership_changed");
    const checked = validateFullSnapshot(result);
    const previous = current.current.snapshot;
    if (previous?.family.role === "owner" && checked.family.role !== "owner")
      markReady(false);
    if (previous && !matchesOrigin(originForSnapshot(previous), result)) {
      markReady(false);
      await stopNotificationDelivery(true);
      check(e);
    }
    // Once the server has disproved the old grant/history, a local disk error
    // must not make that old family or obsolete admin permissions return.
    if (
      who.current?.families.some(
        (grant) =>
          grant.id === checked.family.id &&
          grant.membershipId === checked.family.membershipId &&
          grant.role !== checked.family.role,
      )
    ) {
      const checkedIdentity = {
        ...who.current,
        families: who.current.families.map((grant) =>
          grant.id === checked.family.id &&
          grant.membershipId === checked.family.membershipId
            ? { ...grant, role: checked.family.role }
            : grant,
        ),
      };
      showIdentity(checkedIdentity);
      await auth.saveIdentity(checkedIdentity);
      check(e);
    }
    await auth.saveCacheOrigin(originForSnapshot(checked));
    check(e);
    await persist((s) => applyFullSnapshot(s, checked), e, false);
    markReady(true);
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
      await stopNotificationDelivery(true);
      check(e);
      await persist(revokeCache, e, false);
      markReady(true);
    } else {
      await snapshot(e, f.id);
    }
    return me;
  }
  async function resumeTransition(e: number) {
    requireAuthentication();
    const intent = current.current.transition;
    if (!intent) return;
    await stopNotificationDelivery();
    check(e);
    if (intent.userId !== who.current?.user.id)
      throw new Error("account_mismatch");
    if (intent.phase === "pending") {
      if (["create", "join"].includes(intent.kind)) {
        setPersonalStorageBlocked(true);
        await drainReminderWrites();
        await drainPersonalStorageWrites();
        if (!intent.dispatched && intent.path === "/v2/families") {
          try {
            const seed = intent.body.seed as OwnerSeedDraft;
            const latest = {
              ...seed,
              source: await loadState(),
              ...(seed.extrasSchemaVersion === 1
                ? { extraRecords: await loadPersonalExtras() }
                : {}),
            };
            if (serializeOwnerSeed(latest) !== serializeOwnerSeed(seed))
              throw new Error("owner_source_changed");
          } catch (cause) {
            // No request was sent: release the intent so the user can repair
            // unreadable source data and explicitly review it again.
            await persist((s) => ({ ...s, transition: null }), e, false, true);
            throw cause;
          }
        }
        if (!intent.dispatched)
          await persist(
            (s) => ({ ...s, transition: { ...intent, dispatched: true } }),
            e,
          );
      }
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
        let activation: PilotTransition["activation"];
        if (intent.path === "/v2/families") {
          const activated = response as unknown as FamilyActivation;
          validateFullSnapshot(activated.snapshot);
          const digest = await digestStringAsync(
            CryptoDigestAlgorithm.SHA256,
            serializeOwnerSeed(intent.body.seed as OwnerSeedDraft),
          );
          if (
            activated.operationId !== intent.operationId ||
            activated.snapshot.family.id !== activated.familyId ||
            activated.snapshot.family.membershipId !== activated.membershipId ||
            activated.snapshot.historyId !== activated.historyId ||
            activated.seedDigest?.toLowerCase() !== digest.toLowerCase()
          )
            throw new Error("invalid_response");
          activation = {
            familyId: activated.familyId,
            membershipId: activated.membershipId,
            historyId: activated.historyId,
            ...((intent.body.seed as OwnerSeedDraft).extrasSchemaVersion === 1
              ? { extrasSchemaVersion: 1 as const }
              : {}),
          };
        } else if (intent.kind === "join") {
          const joined = response as unknown as FamilySummary;
          if (
            !joined.id ||
            !joined.membershipId ||
            joined.id !== intent.familyId
          )
            throw new Error("invalid_response");
          activation = {
            familyId: joined.id,
            membershipId: joined.membershipId,
            ...(intent.body.requiredExtrasSchemaVersion === 1
              ? { extrasSchemaVersion: 1 as const }
              : {}),
          };
        }
        await persist(
          (s) => ({
            ...(["leave", "close", "delete-account"].includes(intent.kind)
              ? revokeCache(s)
              : s),
            transition: {
              ...intent,
              dispatched: true,
              phase: "committed",
              ...(activation ? { activation, body: {} } : {}),
            },
          }),
          e,
          false,
        );
      } catch (cause) {
        check(e);
        if (
          retryable(cause) ||
          authenticationRequired(cause) ||
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
    const committed = current.current.transition;
    if (
      committed?.phase === "committed" &&
      ["leave", "close", "delete-account"].includes(committed.kind)
    ) {
      await stopNotificationDelivery(true);
      check(e);
    }
    if (
      committed?.phase === "committed" &&
      ["create", "join"].includes(committed.kind)
    ) {
      const expected = committed.activation;
      if (!expected) throw new Error("membership_changed");
      const me = await identify(e);
      const grant = me.families.find(
        (f) =>
          f.id === expected.familyId &&
          f.membershipId === expected.membershipId,
      );
      if (!grant || me.accountDeletion) {
        // The server has disproved this activation's grant. Another membership
        // must never supply its replacement data or authorize personal cleanup.
        markReady(false);
        await persist(() => emptyPilotState(), e);
        markReady(true);
        setNotice("membership_revoked");
        return;
      }
      try {
        await snapshot(e, grant.id, expected);
      } catch (cause) {
        if (
          cause instanceof PilotApiError &&
          !retryable(cause) &&
          errorCode(cause) === "family_schema_unsupported"
        ) {
          // Older clients could commit a join to a legacy family. Verified
          // schema rejection ends local activation without erasing personal
          // records or leaving the family; explicit sign-out remains available.
          markReady(false);
          await persist(() => emptyPilotState(), e);
        }
        throw cause;
      }
    } else await refreshMembership(e);
    const failure = current.current.transition?.error;
    if (!failure && ["create", "join"].includes(intent.kind)) {
      // A journal survives a crash between server commit and local replacement.
      // Retrying repeats this idempotent cleanup before exposing the family.
      const expected = current.current.transition?.activation;
      const actual = current.current.snapshot;
      if (
        !expected ||
        !isFullSnapshot(actual) ||
        actual.family.id !== expected.familyId ||
        actual.family.membershipId !== expected.membershipId ||
        (expected.historyId && actual.historyId !== expected.historyId)
      )
        throw new Error("membership_changed");
      if (!expected.historyId)
        await persist(
          (s) => ({
            ...s,
            transition: {
              ...s.transition!,
              activation: { ...expected, historyId: actual.historyId },
            },
          }),
          e,
          false,
        );
      if (
        expected.extrasSchemaVersion === 1 &&
        actual.extrasSchemaVersion !== 1
      )
        throw new Error("extras_sharing_unavailable");
      await clearPersonalForFamilyActivation();
      check(e);
      setActivationSerial((value) => value + 1);
    }
    await persist((s) => ({ ...s, transition: null }), e, false, true);
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
        await stopNotificationDelivery(true);
        check(e);
        if (
          current.current.snapshot ||
          current.current.draft ||
          current.current.queue.length ||
          current.current.records?.length
        ) {
          await persist(revokeCache, e, false);
          setNotice("membership_revoked");
        }
        failures.current = 0;
        nextRefresh.current = Date.now() + 30000;
        markReady(true);
        // Identity-only refresh cannot resolve a failed local write. Successful
        // authentication still clears obsolete login and connectivity errors.
        setError((previous) =>
          previous === "local_save_failed" ? previous : null,
        );
        return;
      }
      // Refresh grants/history before sending offline work, not merely after it.
      await snapshot(e, f.id);
      for (const queued of recordsForSend(durable.current, current.current)) {
        check(e);
        if (!foreground.current) break;
        const item = recordsForSend(durable.current, current.current).find(
          (q) => q.operation.operationId === queued.operation.operationId,
        );
        if (!item) continue;
        try {
          const receipt = await familyRequest<FeedReceipt>(
            `/v2/families/${f.id}/record-operations`,
            item.operation,
            requests.current.signal,
          );
          await persist(
            (s) => acceptRecordReceipt(s, item.operation.operationId, receipt),
            e,
          );
        } catch (cause) {
          check(e);
          const code = errorCode(cause);
          if (
            retryable(cause) ||
            authenticationRequired(cause) ||
            [
              "sign_in_required",
              "unauthorized",
              "membership_revoked",
              "membership_changed",
              "history_changed",
              "forbidden",
            ].includes(code)
          )
            throw cause;
          await persist(
            (s) => ({
              ...s,
              records: (s.records ?? []).map((q) =>
                q.operation.operationId === item.operation.operationId
                  ? { ...q, status: "failed", error: code }
                  : q,
              ),
            }),
            e,
          );
          setNotice("change_not_shared");
        }
      }
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
            [
              "forbidden",
              "membership_revoked",
              "pilot_not_admitted",
              "identity_not_supported",
            ].includes(code)
          ) {
            await stopNotificationDelivery(true).catch(() => {});
            check(e);
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
      const code = authenticationRequired(cause)
        ? "sign_in_required"
        : errorCode(cause);
      if (
        [
          "sign_in_required",
          "unauthorized",
          "invalid_response",
          "full_sharing_unavailable",
          "family_schema_unsupported",
          "membership_changed",
          "history_changed",
          "identity_not_supported",
        ].includes(code)
      )
        markReady(false);
      if (authenticationRequired(cause)) pauseAuthentication();
      if (
        [
          "forbidden",
          "membership_revoked",
          "pilot_not_admitted",
          "identity_not_supported",
        ].includes(code) &&
        who.current
      ) {
        markReady(false);
        await stopNotificationDelivery(true).catch(() => {});
        if (!isCurrent(e)) return;
        const denied = { ...who.current, families: [], pendingInvitations: [] };
        showIdentity(denied);
        await auth.saveIdentity(denied).catch(() => {});
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
    preserveError = false,
  ): Promise<T> {
    if (commands.current) throw new Error("action_busy");
    commands.current = true;
    setBusy(true);
    if (!preserveError)
      setError(authPaused.current ? "sign_in_required" : null);
    setNotice(null);
    const e = epoch.current;
    try {
      if (current.current.transition && !allowTransition)
        throw new Error("transition_pending");
      return await task(e);
    } catch (cause) {
      if (isCurrent(e)) {
        const code = errorCode(cause);
        if (code === "sign_in_cancelled") setNotice(code);
        else {
          if (authenticationRequired(cause)) pauseAuthentication();
          setError(
            authPaused.current &&
              !["local_save_failed", "sign_out_failed"].includes(code)
              ? "sign_in_required"
              : code,
          );
        }
      }
      throw cause;
    } finally {
      commands.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const start = useCallback(async () => {
    if (!configured || webUnsupported) return;
    const e = epoch.current;
    let cached: PilotIdentity | null = null;
    try {
      const deletion = await loadDeletionReceipt();
      check(e);
      if (deletion && deletion.apiUrl === familyConfig?.apiUrl)
        setDeletionStatus({
          deletionId: deletion.deletionId,
          status: deletion.status,
          requestedAt: deletion.requestedAt,
        });
      const hasSession = await auth.hasSession();
      check(e);
      if (!hasSession) {
        await stopNotificationDelivery(true);
        check(e);
        signedOut.current = true;
        setSessionUnresolved(false);
        setAuthStatus("signed_out");
        return;
      }
      // A stored session with an unknown identity must keep personal writes
      // blocked while the recovery screen verifies which workspace it owns.
      setSessionUnresolved(true);
      cached = await auth.loadIdentity();
      check(e);
      if (cached) {
        const guard = await auth.loadCacheGuard(cached.user.id);
        check(e);
        const stored = await loadPilot(accountKey(cached.user.id));
        check(e);
        cacheRestored.current = true;
        showIdentity(cached);
        setSessionUnresolved(false);
        const source = stored.snapshot?.family;
        const cachedGrant = source
          ? cached.families.find(
              (f) =>
                f.id === source.id && f.membershipId === source.membershipId,
            )
          : undefined;
        const cachedMember =
          cachedGrant && Array.isArray(stored.snapshot?.members)
            ? stored.snapshot.members.find(
                (member) =>
                  member.id === cached!.user.id &&
                  member.membershipId === cachedGrant.membershipId &&
                  member.status === "active",
              )
            : undefined;
        const grantMatches = !source || (!!cachedGrant && !!cachedMember);
        const originMatches =
          !guard?.origin ||
          (grantMatches && matchesOrigin(guard.origin, stored.snapshot));
        const cachedState =
          grantMatches && cachedGrant && stored.snapshot
            ? applySnapshot(stored, {
                ...stored.snapshot,
                family: {
                  ...cachedGrant,
                  role:
                    cachedGrant.role === "owner" &&
                    source?.role === "owner" &&
                    cachedMember?.role === "owner"
                      ? "owner"
                      : "caregiver",
                },
              })
            : stored;
        showState(
          grantMatches || stored.transition ? cachedState : revokeCache(stored),
          true,
        );
        if (
          grantMatches &&
          cachedGrant &&
          originMatches &&
          !guard?.reauthRequired &&
          isFullSnapshot(cachedState.snapshot) &&
          !stored.transition &&
          !cached.accountDeletion
        ) {
          validateFullSnapshot(cachedState.snapshot);
          markReady(true);
        }
        if (guard?.reauthRequired) {
          authPaused.current = true;
          setAuthStatus("reauth_required");
          markReady(false);
          setError("sign_in_required");
        }
        if (cached.accountDeletion || (!grantMatches && !stored.transition))
          await persist(revokeCache, e, false, true);
      }
      // Only local restoration gates startup. The existing sync lock continues
      // identity checks, downloads and queued uploads after the app can render.
      setBooting(false);
      await sync();
    } catch (cause) {
      if (isCurrent(e)) {
        if (cached && !who.current) {
          showIdentity(cached);
        }
        markReady(false);
        if (authenticationRequired(cause)) pauseAuthentication();
        else if (!authPaused.current) setAuthStatus("unverified");
        setError(
          authenticationRequired(cause) ? "sign_in_required" : errorCode(cause),
        );
      }
    } finally {
      if (isCurrent(e)) setBooting(false);
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
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
      noticeToken.current++;
      void stopNotificationDelivery().catch(() => {});
    };
  }, [start]);

  async function mutate(
    path: string,
    body: Record<string, unknown>,
    e: number,
    kind: PilotTransition["kind"] = "manage",
    activationFamilyId?: string,
  ) {
    lifecycleActive.current = true;
    try {
      await syncLock.current;
      check(e);
      requireAuthentication();
      if (current.current.transition) throw new Error("transition_pending");
      if (!who.current || who.current.accountDeletion)
        throw new Error("account_deleted");
      await stopNotificationDelivery();
      check(e);
      const intent: PilotTransition = {
        operationId: randomUUID(),
        path,
        body,
        kind,
        userId: who.current.user.id,
        familyId: activationFamilyId ?? current.current.snapshot?.family.id,
        ...(["manage", "leave", "close"].includes(kind) &&
        current.current.snapshot
          ? { origin: originForSnapshot(current.current.snapshot) }
          : {}),
        phase: "pending",
      };
      if (["create", "join"].includes(kind)) setPersonalStorageBlocked(true);
      await persist((s) => ({ ...s, transition: intent }), e);
      await resumeTransition(e);
    } finally {
      lifecycleActive.current = false;
    }
  }
  const notificationOrigin =
    ready &&
    authStatus === "authenticated" &&
    !state.transition &&
    isFullSnapshot(state.snapshot) &&
    state.snapshot.extrasSchemaVersion === 1 &&
    identity
      ? JSON.stringify([
          accountKey(identity.user.id),
          state.snapshot.family.id,
          state.snapshot.family.membershipId,
          state.snapshot.historyId,
        ])
      : null;
  notificationContext.current = notificationOrigin;
  useEffect(() => {
    let active = true;
    const generation = notificationGeneration.current;
    setNotificationError(null);
    const update = async () => {
      if (notificationOrigin) {
        if (
          notificationContext.current !== notificationOrigin ||
          authPaused.current ||
          signedOut.current ||
          !verified.current
        )
          return;
        await syncFamilyReminders(
          notificationOrigin,
          projectedExtraRecords(state).map((r) => r.record),
          projectedFullState(state)?.entries ?? [],
        );
        const enabled = await loadFamilyReminderOptIn(notificationOrigin);
        if (
          active &&
          notificationContext.current === notificationOrigin &&
          notificationGeneration.current === generation
        )
          setNotificationsEnabledValue(enabled);
      } else {
        setNotificationsEnabledValue(false);
        if (
          !booting &&
          (authStatus === "signed_out" ||
            (authStatus === "authenticated" &&
              !identity?.families.length &&
              !state.transition))
        )
          await stopNotificationDelivery(true);
        else await stopNotificationDelivery();
      }
    };
    void update().catch((cause) => {
      if (
        active &&
        (!notificationOrigin ||
          (notificationContext.current === notificationOrigin &&
            notificationGeneration.current === generation))
      )
        setNotificationError(
          cause instanceof Error ? cause.message : "request_failed",
        );
    });
    return () => {
      active = false;
    };
  }, [
    notificationOrigin,
    state.snapshot,
    state.records,
    state.transition,
    booting,
    authStatus,
  ]);

  return {
    notificationsEnabled,
    notificationError,
    setNotificationsEnabled: async (enabled: boolean) => {
      const origin = notificationContext.current;
      const generation = notificationGeneration.current;
      const e = epoch.current;
      const stillCurrent = () =>
        isCurrent(e) &&
        verified.current &&
        !authPaused.current &&
        !signedOut.current &&
        !lifecycleActive.current &&
        !current.current.transition &&
        notificationContext.current === origin &&
        notificationGeneration.current === generation;
      if (!origin || !stillCurrent()) throw new Error("refresh_required");
      await setFamilyReminderOptIn(origin, enabled);
      if (!stillCurrent()) throw new Error("session_changed");
      await syncFamilyReminders(
        origin,
        projectedExtraRecords(current.current).map((r) => r.record),
        projectedFullState(current.current)?.entries ?? [],
      );
      if (!stillCurrent()) throw new Error("session_changed");
      setNotificationError(null);
      setNotificationsEnabledValue(enabled);
    },
    activationSerial,
    activationPending:
      !!state.transition && ["create", "join"].includes(state.transition.kind),
    booting,
    authStatus,
    ready,
    sharedMode:
      sessionUnresolved ||
      !!state.snapshot ||
      !!identity?.families.length ||
      !!state.transition,
    sharedState: ready && !state.transition ? projectedFullState(state) : null,
    sharedExtras:
      ready && !state.transition ? projectedExtraRecords(state) : [],
    fullSnapshot:
      ready && !state.transition && isFullSnapshot(state.snapshot)
        ? state.snapshot
        : null,
    recordPending: state.records?.filter((q) => q.status !== "failed") ?? [],
    recordConflicts: state.records?.filter((q) => q.status === "failed") ?? [],
    canEditRecord: (collection: "entry" | "care" | "extra", id: string) =>
      ready &&
      !state.transition &&
      isFullSnapshot(state.snapshot) &&
      canEditRecord(state.snapshot, collection, id) &&
      !(state.records ?? []).some(
        (q) =>
          q.operation.collection === collection &&
          q.operation.recordId === id &&
          q.status !== "failed",
      ),
    saveRecord: (
      collection: "entry" | "care" | "extra",
      value: Entry | CareRecord | FamilyExtraRecord,
      baseVersion?: string,
    ) =>
      action(async (e) => {
        if (!verified.current) throw new Error("refresh_required");
        const f = family(),
          snapshot = current.current.snapshot;
        if (!isFullSnapshot(snapshot))
          throw new Error("full_sharing_unavailable");
        const op: RecordOperation = {
          operationId: randomUUID(),
          recordId: value.id,
          membershipId: f.membershipId,
          historyId: snapshot.historyId,
          collection,
          kind: baseVersion ? "update" : "create",
          ...(baseVersion ? { baseVersion } : {}),
          ...(collection === "entry"
            ? { entry: value as Entry }
            : collection === "extra"
              ? { extraRecord: value as FamilyExtraRecord }
              : { careRecord: value as CareRecord }),
        };
        await persist((s) => enqueueRecord(s, op), e);
        setNotice("saved_locally");
        void refreshNow();
      }),
    deleteRecord: (
      collection: "entry" | "care" | "extra",
      id: string,
      baseVersion: string,
    ) =>
      action(async (e) => {
        if (!verified.current) throw new Error("refresh_required");
        const f = family(),
          snapshot = current.current.snapshot;
        if (!isFullSnapshot(snapshot))
          throw new Error("full_sharing_unavailable");
        await persist(
          (s) =>
            enqueueRecord(s, {
              operationId: randomUUID(),
              recordId: id,
              membershipId: f.membershipId,
              historyId: snapshot.historyId,
              collection,
              kind: "delete",
              baseVersion,
            }),
          e,
        );
        void refreshNow();
      }),
    discardRecordConflict: (operationId: string) =>
      action(async (e) => {
        await persist(
          (s) => ({
            ...s,
            records: (s.records ?? []).filter(
              (q) =>
                q.operation.operationId !== operationId ||
                q.status !== "failed",
            ),
          }),
          e,
        );
      }),
    saveFullProfile: (profile: State["profile"], baseVersion: string) =>
      action(async (e) => {
        if (!verified.current) throw new Error("refresh_required");
        const f = ownerFamily();
        await mutate(
          `/v2/families/${f.id}/profile`,
          { profile, baseVersion },
          e,
        );
      }),
    createFamilyFromSeed: (seed: OwnerSeedDraft) =>
      action(async (e) => {
        if (who.current?.families.length || current.current.snapshot)
          throw new Error("already_in_family");
        if (seed.extrasSchemaVersion !== 1 || !Array.isArray(seed.extraRecords))
          throw new Error("owner_source_changed");
        requireExtraCapabilities(
          await familyRequest<FamilyCapabilities>(
            "/v2/capabilities",
            undefined,
            requests.current.signal,
          ),
        );
        const checked = JSON.parse(serializeOwnerSeed(seed)) as OwnerSeedDraft;
        await mutate(
          "/v2/families",
          {
            consentRevision: "family-sharing-v1",
            declinePendingInvitations: true,
            seed: checked,
          },
          e,
          "create",
        );
      }),
    configured,
    webUnsupported,
    user: identity?.user ?? null,
    snapshot: state.transition || !ready ? null : state.snapshot,
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
    dismissedFeedback: currentFeedback.dismissedKey,
    dismissFeedback: (key: string | null) =>
      setFeedbackPresentation((previous) =>
        previous.context === feedbackContext
          ? { ...previous, dismissedKey: key }
          : previous,
      ),
    hasPrivateWork:
      !!state.draft ||
      state.queue.some((q) => q.status !== "accepted") ||
      !!state.records?.some((q) => q.status !== "accepted"),
    signIn: () =>
      action(
        async (e) => {
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
            if (!authPaused.current) setAuthStatus("checking");
            // Preserve previous work on disk, but don't show it under a new identity.
            showIdentity(null);
            cacheRestored.current = false;
            setSessionUnresolved(true);
            markReady(false);
            showState(emptyPilotState(), true);
            await identify(e, previous?.user.id);
          } finally {
            authenticating.current = false;
          }
          await refreshNow();
        },
        true,
        true,
      ),
    signOut: () =>
      action(async (beforeLogoutEpoch) => {
        if (
          current.current.transition &&
          ["create", "join"].includes(current.current.transition.kind)
        )
          throw new Error("transition_pending");
        lifecycleActive.current = true;
        try {
          // Final logout cleanup below still attempts credentials and cache if
          // the native notification service is temporarily unavailable.
          await stopNotificationDelivery().catch(() => {});
          await syncLock.current;
          check(beforeLogoutEpoch);
          // Commit the discard before deleting credentials. If the process dies
          // during final row cleanup, a later explicit login loads an EMPTY
          // workspace rather than resurrecting work the user discarded.
          if (who.current)
            await persist(
              () => emptyPilotState(),
              beforeLogoutEpoch,
              true,
              true,
            );
          cleanupPending.current = true;
          logoutAccount.current = who.current?.user.id ?? logoutAccount.current;
          epoch.current++;
          const e = epoch.current;
          signedOut.current = true;
          setSessionUnresolved(false);
          authPaused.current = false;
          setAuthStatus("signed_out");
          requests.current.abort();
          requests.current = new AbortController();
          syncLock.current = null;
          showIdentity(null);
          cacheRestored.current = false;
          markReady(false);
          showState(emptyPilotState(), true);
          setSyncing(false);
          const results = await Promise.allSettled([
            auth.signOut(),
            stopNotificationDelivery(true),
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
        requireExtraCapabilities(
          await familyRequest<FamilyCapabilities>(
            "/v2/capabilities",
            undefined,
            requests.current.signal,
          ),
        );
        const invitation = who.current?.pendingInvitations.find(
          (item) => item.id === id,
        );
        if (!invitation) throw new Error("invitation_unavailable");
        await mutate(
          `/v1/invitations/${id}/accept`,
          {
            declineOtherInvitations: true,
            requiredSchemaVersion: 2,
            requiredExtrasSchemaVersion: 1,
          },
          e,
          "join",
          invitation.familyId,
        );
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
