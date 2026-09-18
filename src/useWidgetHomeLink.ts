import { useEffect, useRef } from "react";
import { Linking, Platform } from "react-native";
import { isTodayWidgetLink } from "./widgetLink";

export function useWidgetHomeLink(open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let alive = true;
    let receivedEvent = false;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      receivedEvent = true;
      if (isTodayWidgetLink(url)) latest.current();
    });
    void Linking.getInitialURL()
      .then((url) => {
        if (alive && !receivedEvent && isTodayWidgetLink(url)) latest.current();
      })
      .catch(() => {});
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
}
