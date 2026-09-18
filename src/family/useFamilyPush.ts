import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useI18n } from "../i18n";
import type { useFamilyPilot } from "./useFamilyPilot";
import {
  configureFamilyPush,
  loadFamilyPush,
  reconcileFamilyPush,
  setFamilyPushContext,
  type FamilyPushView,
} from "./familyPush";
import {
  isFamilyEntryPush,
  type PushCategory,
  type PushScope,
} from "./familyPushCore";
import { canOpenFamilyEntryPush } from "./familyPushPresentation";

export function useFamilyPush(
  family: ReturnType<typeof useFamilyPilot>,
  onOpen?: () => void,
) {
  const { locale } = useI18n();
  const language = locale === "en-US" ? "en" : "zh";
  const snapshot = family.fullSnapshot;
  const scope: PushScope | null =
    family.ready && family.user && snapshot
      ? {
          userId: family.user.id,
          familyId: snapshot.family.id,
          membershipId: snapshot.family.membershipId,
          historyId: snapshot.historyId,
        }
      : null;
  const scopeKey = JSON.stringify(scope);
  const [state, setState] = useState<FamilyPushView>({
    supported: Platform.OS !== "web",
    enabled: false,
    desiredEnabled: false,
    categories: ["feed", "diaper", "sleep"],
    pending: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const context = useRef(scopeKey);
  context.current = scopeKey;
  const current = useRef({ family, onOpen });
  current.current = { family, onOpen };
  const lock = useRef(false);
  const lastIntent = useRef<{
    enabled: boolean;
    categories: PushCategory[];
  } | null>(null);
  const pendingTap = useRef<unknown>(null);
  const lastTap = useRef<string | null>(null);
  const openingTap = useRef<string | null>(null);
  const retryOpen = useRef<(() => Promise<void>) | null>(null);
  // Update the foreground policy before any pending callback can observe a new
  // React identity with the old notification permission context.
  setFamilyPushContext(scope);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let alive = true;
    let refreshing = false;
    const key = scopeKey;
    setBusy(false);
    lastIntent.current = null;
    async function openPending() {
      const data = pendingTap.current;
      if (
        !isFamilyEntryPush(data) ||
        !canOpenFamilyEntryPush(data) ||
        lastTap.current === data.eventId ||
        openingTap.current === data.eventId
      )
        return;
      openingTap.current = data.eventId;
      try {
        if (!(await current.current.family.refreshForNotification()))
          throw new Error("push_open_failed");
        if (alive && context.current === key && canOpenFamilyEntryPush(data)) {
          lastTap.current = data.eventId;
          setError(null);
          if (pendingTap.current === data) pendingTap.current = null;
          current.current.onOpen?.();
          void Notifications.clearLastNotificationResponseAsync().catch(
            () => {},
          );
        }
      } catch {
        if (alive && context.current === key) setError("push_open_failed");
      } finally {
        if (openingTap.current === data.eventId) openingTap.current = null;
      }
    }
    retryOpen.current = openPending;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const local = await loadFamilyPush();
        if (!alive || context.current !== key) return;
        setState(local);
        await openPending();
        // No startup network request for users who have never opted in.
        const next = await reconcileFamilyPush(language);
        if (alive && context.current === key) setState(next);
      } catch {
        // Existing enabled settings remain recognizable; no global offline banner
        // for a failed push renewal. A user-initiated setting change shows errors.
      } finally {
        refreshing = false;
      }
    }
    setError(null);
    void refresh();
    const app = AppState.addEventListener("change", (v) => {
      if (v === "active") void refresh();
    });
    const token = Notifications.addPushTokenListener(() => {
      void refresh();
    });
    const response = Notifications.addNotificationResponseReceivedListener(
      (r) => {
        if (!isFamilyEntryPush(r.notification.request.content.data)) return;
        pendingTap.current = r.notification.request.content.data;
        void openPending();
      },
    );
    const initial = Notifications.getLastNotificationResponse();
    if (
      initial &&
      isFamilyEntryPush(initial.notification.request.content.data)
    ) {
      pendingTap.current = initial.notification.request.content.data;
      void openPending();
    }
    return () => {
      alive = false;
      if (retryOpen.current === openPending) retryOpen.current = null;
      app.remove();
      token.remove();
      response.remove();
    };
  }, [scopeKey, language]);
  useEffect(() => () => setFamilyPushContext(null), []);
  const change = async (enabled: boolean, categories: PushCategory[]) => {
    if (lock.current) return;
    lastIntent.current = { enabled, categories };
    lock.current = true;
    const key = scopeKey;
    setBusy(true);
    setError(null);
    try {
      const next = await configureFamilyPush(enabled, categories, language);
      if (context.current === key) setState(next);
    } catch (cause) {
      if (context.current === key) {
        const code = cause instanceof Error ? cause.message : "push_failed";
        setError(/^[a-z_]+$/.test(code) ? code : "push_failed");
        try {
          const next = await loadFamilyPush();
          if (context.current === key) setState(next);
        } catch {
          /* Keep the last visible state. */
        }
      }
    } finally {
      lock.current = false;
      if (context.current === key) setBusy(false);
    }
  };
  return {
    ...state,
    available: !!scope && Platform.OS !== "web",
    busy,
    error,
    change,
    retry: () => {
      if (error === "push_open_failed")
        return retryOpen.current?.() ?? Promise.resolve();
      const intent = lastIntent.current;
      return change(
        intent?.enabled ?? state.desiredEnabled,
        intent?.categories ?? state.categories,
      );
    },
  };
}
