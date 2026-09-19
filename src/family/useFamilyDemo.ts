import { useRef, useState } from "react";
import type { useFamilyPilot } from "./useFamilyPilot";
import { canEditSharedFeed } from "./pilotState";
import type { State } from "../domain";
import {
  summarizeOwnerSeed,
  type OwnerSeedDraft,
  type OwnerSeedSummary,
} from "./ownerSeed";
import {
  createFamilyDemo,
  demoOwnerSource,
  reduceFamilyDemo,
  type FamilyDemoAction,
  type FamilyDemoScenario,
} from "./demoScenarios";

// Deliberately no runtime import of the live controller, API, authentication or
// persistence. Unmounting this hook discards the entire review session.
export function useFamilyDemo(scenario: FamilyDemoScenario): ReturnType<
  typeof useFamilyPilot
> & {
  demoSource: State;
  initialDataSummary: OwnerSeedSummary | undefined;
  createFamilyFromSeed: (draft: OwnerSeedDraft) => Promise<void>;
} {
  const [state, setState] = useState(() => createFamilyDemo(scenario));
  const [demoSource] = useState(() => demoOwnerSource());
  const [error, setError] = useState<string | null>(null);
  const current = useRef(state);
  async function act(action: FamilyDemoAction) {
    try {
      const next = reduceFamilyDemo(current.current, action);
      current.current = next;
      setState(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request_failed");
      throw cause;
    }
  }
  async function run(action: FamilyDemoAction): Promise<void> {
    await act(action);
  }
  async function unavailable(): Promise<void> {
    setError("record_changed");
    throw new Error("record_changed");
  }
  return {
    activationSerial: 0,
    activationPending: false,
    booting: false,
    ready: true,
    watchWorkspaceKey: null,
    watchRecordingEnabled: false,
    watchExpiresAt: new Date(0).toISOString(),
    watchReceipts: [],
    companionRevision: state,
    getWatchState: () => ({
      admissionBlocked: false,
      readableState: null,
      workspaceKey: null,
      expiresAt: new Date(0).toISOString(),
      state: null,
      snapshot: null,
      receipts: [],
      pending: [],
    }),
    applyWatchCommand: async () => {
      throw new Error("native_required");
    },
    hasFamilyMembership: !!state.snapshot,
    sharedMode: !!state.snapshot,
    sharedState: null,
    sharedExtras: [],
    notificationsEnabled: false,
    notificationError: null,
    setNotificationsEnabled: unavailable,
    fullSnapshot: null,
    recordPending: [],
    recordConflicts: [],
    canEditRecord: () => false,
    canControlSleep: () => false,
    finishSleep: unavailable,
    canControlFeed: () => false,
    finishFeed: unavailable,
    saveRecord: unavailable,
    deleteRecord: unavailable,
    discardRecordConflict: unavailable,
    saveFullProfile: unavailable,
    demoSource,
    initialDataSummary: state.seededSource
      ? summarizeOwnerSeed(state.seededSource)
      : undefined,
    createFamilyFromSeed: (draft) =>
      run({ type: "create-family-from-seed", draft }),
    configured: true,
    webUnsupported: false,
    user: state.user,
    authStatus: state.user ? "authenticated" : "signed_out",
    tokenRecognized: !!state.user,
    sessionAvailable: !!state.user,
    snapshot: state.snapshot,
    feeds: state.snapshot?.feeds ?? [],
    draft: state.draft,
    pending: [],
    conflicts: [],
    inbox: state.inbox,
    accountDeletion: state.accountDeletion,
    deletionStatus: state.deletionStatus,
    transitionPending: false,
    canEditFeed: (feed) =>
      !!state.snapshot && canEditSharedFeed(state.snapshot, feed),
    busy: false,
    syncing: false,
    error,
    notice: state.notice,
    dismissedFeedback: null,
    dismissFeedback: () => {},
    hasPrivateWork: !!state.draft,
    signIn: () => run({ type: "sign-in" }),
    signOut: () => run({ type: "sign-out" }),
    refresh: () => run({ type: "refresh" }),
    refreshActiveTimer: async () => ({
      refreshed: true,
      activeId: null,
    }),
    refreshForNotification: async () => false,
    createFamily: (babyName) => run({ type: "create-family", babyName }),
    acceptInvitation: (id) => run({ type: "accept-invitation", id }),
    declineInvitation: (id) => run({ type: "decline-invitation", id }),
    createInvitation: (email) => run({ type: "create-invitation", email }),
    revokeInvitation: (id) => run({ type: "revoke-invitation", id }),
    removeMember: (id) => run({ type: "remove-member", id }),
    leaveFamily: () => run({ type: "leave" }),
    updateProfile: (babyName, babyBirthDate) =>
      run({ type: "update-profile", babyName, babyBirthDate }),
    nominateOwner: (id) => run({ type: "nominate-owner", id }),
    acceptOwnership: () => run({ type: "accept-transfer" }),
    cancelOwnership: () => run({ type: "cancel-transfer" }),
    closeFamily: () => run({ type: "close-family" }),
    deleteAccount: () => run({ type: "delete-account" }),
    checkDeletionStatus: async () =>
      (await act({ type: "check-deletion" })).deletionStatus!,
    dismissDeletionStatus: () => run({ type: "dismiss-deletion" }),
    beginFeed: (feed) => run({ type: "begin-feed", feed }),
    setDraft: (draft) => run({ type: "set-draft", draft }),
    discardDraft: () => run({ type: "discard-draft" }),
    saveDraft: () => run({ type: "save-draft" }),
    deleteFeed: (id) => run({ type: "delete-feed", id }),
    reviewConflict: unavailable,
    discardConflict: unavailable,
    reviewPrivateDraft: async () => {
      if (!current.current.draft) await unavailable();
    },
  };
}
