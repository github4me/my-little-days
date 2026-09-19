import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { Button } from "./ui";

export default function FeedStopButton({
  onPress,
  disabled,
  label = "停止",
  secondary = false,
}: {
  onPress: () => void;
  disabled: boolean;
  label?: string;
  secondary?: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let disposed = false;
    let animation: Animated.CompositeAnimation | undefined;
    const update = (reduced: boolean) => {
      if (disposed) return;
      animation?.stop();
      opacity.setValue(1);
      if (!reduced) {
        animation = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.65,
              duration: 900,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 900,
              useNativeDriver: true,
            }),
          ]),
        );
        animation.start();
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(update)
      .catch(() => {});
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      update,
    );
    return () => {
      disposed = true;
      animation?.stop();
      listener.remove();
    };
  }, [opacity]);
  return (
    <Animated.View style={{ opacity }}>
      <Button
        label={label}
        secondary={secondary}
        disabled={disabled}
        onPress={onPress}
      />
    </Animated.View>
  );
}
