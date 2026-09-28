import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, AppState, Platform } from "react-native";

export type AccessibilityPreferences = {
  highContrast: boolean;
  reduceMotion: boolean;
  boldText: boolean;
  reduceTransparency: boolean;
};

// A static first frame avoids animation before the asynchronous OS preference
// has been read. These queries never wait for API, authentication or local data.
const defaults: AccessibilityPreferences = {
  highContrast: false,
  reduceMotion: true,
  boldText: false,
  reduceTransparency: false,
};
const Preferences = createContext(defaults);
type PreferenceEvent =
  | "reduceMotionChanged"
  | "darkerSystemColorsChanged"
  | "boldTextChanged"
  | "reduceTransparencyChanged"
  | "highTextContrastChanged";

export function AccessibilityPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = useState(defaults);
  useEffect(() => {
    let active = true;
    const generations: Record<keyof AccessibilityPreferences, number> = {
      highContrast: 0,
      reduceMotion: 0,
      boldText: 0,
      reduceTransparency: 0,
    };
    const set = (key: keyof AccessibilityPreferences, value: boolean) => {
      if (!active) return;
      setPreferences((previous) =>
        previous[key] === value ? previous : { ...previous, [key]: value },
      );
    };
    if (Platform.OS === "web") {
      const queries = [
        ["highContrast", "(prefers-contrast: more)"],
        ["reduceMotion", "(prefers-reduced-motion: reduce)"],
        ["reduceTransparency", "(prefers-reduced-transparency: reduce)"],
      ] as const;
      const cleanup = queries.map(([key, query]) => {
        if (typeof window === "undefined" || !window.matchMedia)
          return () => {};
        const media = window.matchMedia(query);
        const change = () => set(key, media.matches);
        change();
        media.addEventListener?.("change", change);
        return () => media.removeEventListener?.("change", change);
      });
      return () => {
        active = false;
        cleanup.forEach((remove) => remove());
      };
    }
    const subscriptions: { remove: () => void }[] = [];
    const readers: (() => void)[] = [];
    function observe(
      key: keyof AccessibilityPreferences,
      event: PreferenceEvent,
      read: () => Promise<boolean>,
    ) {
      const refresh = () => {
        const generation = ++generations[key];
        void read()
          .then((value) => {
            if (generations[key] === generation) set(key, value);
          })
          .catch(() => {}); // Retain the safe/current preference if OS query fails.
      };
      subscriptions.push(
        AccessibilityInfo.addEventListener(event, (value) => {
          ++generations[key];
          // Turning off Reduce Motion must not defeat iOS Prefer Cross-Fade.
          if (key === "reduceMotion" && !value && Platform.OS === "ios") {
            refresh();
            return;
          }
          set(key, value);
        }),
      );
      readers.push(refresh);
      refresh();
    }
    observe("reduceMotion", "reduceMotionChanged", async () => {
      const values = await Promise.all([
        AccessibilityInfo.isReduceMotionEnabled(),
        Platform.OS === "ios"
          ? AccessibilityInfo.prefersCrossFadeTransitions().catch(() => false)
          : Promise.resolve(false),
      ]);
      return values.some(Boolean);
    });
    if (Platform.OS === "ios") {
      observe("highContrast", "darkerSystemColorsChanged", () =>
        AccessibilityInfo.isDarkerSystemColorsEnabled(),
      );
      observe("boldText", "boldTextChanged", () =>
        AccessibilityInfo.isBoldTextEnabled(),
      );
      observe("reduceTransparency", "reduceTransparencyChanged", () =>
        AccessibilityInfo.isReduceTransparencyEnabled(),
      );
    } else {
      observe("highContrast", "highTextContrastChanged", () =>
        AccessibilityInfo.isHighTextContrastEnabled(),
      );
    }
    subscriptions.push(
      AppState.addEventListener("change", (state) => {
        if (state === "active") readers.forEach((read) => read());
      }),
    );
    return () => {
      active = false;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);
  return (
    <Preferences.Provider value={preferences}>{children}</Preferences.Provider>
  );
}

export function useAccessibilityPreferences() {
  return useContext(Preferences);
}
