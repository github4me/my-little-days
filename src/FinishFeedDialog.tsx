import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import Modal from "./AccessibleModal";
import { SafeAreaView } from "react-native-safe-area-context";
import { Entry } from "./domain";
import { isBottleFeed, milkAmounts } from "./feedFinish";
import { elapsed, formatTime, useI18n } from "./i18n";
import { Button, T, Theme } from "./ui";

export default function FinishFeedDialog({
  entry,
  stoppedAt,
  onSave,
  onCancel,
}: {
  entry: Entry;
  stoppedAt: string;
  onSave: (amount?: number) => Promise<void>;
  onCancel: () => void;
}) {
  const c = useContext(Theme);
  const { t } = useI18n();
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.max(44, Math.ceil(32 * fontScale));
  const bottle = isBottleFeed(entry);
  const [amount, setAmount] = useState(entry.amount ?? 0);
  const [saving, setSaving] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const wheel = useRef<ScrollView>(null);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const values = useMemo(() => milkAmounts(entry.amount ?? 0), [entry.amount]);
  const index = values.indexOf(amount);
  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current);
    },
    [],
  );
  function select(next: number) {
    const clamped = Math.max(0, Math.min(values.length - 1, next));
    setAmount(values[clamped]);
    wheel.current?.scrollTo({ y: clamped * rowHeight, animated: false });
  }
  async function save() {
    if (lock.current || scrolling) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(bottle ? amount : undefined);
    } catch {
      setError("保存失败，请重试；喂养记录尚未结束。");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!saving) onCancel();
      }}
    >
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={() => {
            if (!saving) onCancel();
          }}
          style={{
            backgroundColor: c.elevated,
            borderRadius: 24,
            padding: 20,
            gap: 12,
            width: "100%",
            maxWidth: 420,
            alignSelf: "center",
            maxHeight: "100%",
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12 }}
          >
            <T
              accessibilityRole="header"
              style={{ fontSize: 22, fontWeight: "700" }}
            >
              确认结束喂养
            </T>
            <T style={{ color: c.muted }}>
              {t("结束时间：{time} · 时长：{duration}", {
                time: formatTime(stoppedAt),
                duration: elapsed(
                  Date.parse(stoppedAt) - Date.parse(entry.start),
                ),
              })}
            </T>
            {bottle ? (
              <>
                <T>
                  {t("原选奶量：{amount} mL", { amount: entry.amount ?? 0 })}
                </T>
                <T style={{ color: c.muted }}>滚动选择实际喝下的奶量</T>
                <T
                  accessibilityLiveRegion="polite"
                  style={{
                    textAlign: "center",
                    fontSize: 22,
                    fontWeight: "700",
                    color: c.primary,
                  }}
                >
                  {t("实际奶量：{amount} mL", { amount })}
                </T>
                <View
                  style={{
                    height: rowHeight * 3,
                    overflow: "hidden",
                    backgroundColor: c.bg,
                    borderRadius: 16,
                  }}
                >
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: rowHeight,
                      left: 0,
                      right: 0,
                      height: rowHeight,
                      backgroundColor: c.soft,
                      borderTopWidth: 1,
                      borderBottomWidth: 1,
                      borderColor: c.line,
                    }}
                  />
                  <ScrollView
                    ref={wheel}
                    accessible
                    accessibilityLabel={t("奶量滚轮")}
                    accessibilityRole="adjustable"
                    accessibilityValue={{
                      min: values[0],
                      max: values[values.length - 1],
                      now: amount,
                      text: `${amount} mL`,
                    }}
                    accessibilityState={{ disabled: saving }}
                    accessibilityActions={[
                      { name: "increment", label: t("增加奶量") },
                      { name: "decrement", label: t("减少奶量") },
                    ]}
                    onAccessibilityAction={({ nativeEvent }) => {
                      if (saving) return;
                      if (nativeEvent.actionName === "increment")
                        select(index + 1);
                      if (nativeEvent.actionName === "decrement")
                        select(index - 1);
                    }}
                    scrollEnabled={!saving}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                    snapToInterval={rowHeight}
                    decelerationRate="fast"
                    contentOffset={{
                      x: 0,
                      y: values.indexOf(entry.amount ?? 0) * rowHeight,
                    }}
                    onLayout={() =>
                      wheel.current?.scrollTo({
                        y: index * rowHeight,
                        animated: false,
                      })
                    }
                    contentContainerStyle={{ paddingVertical: rowHeight }}
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      const next = Math.max(
                        0,
                        Math.min(
                          values.length - 1,
                          Math.round(e.nativeEvent.contentOffset.y / rowHeight),
                        ),
                      );
                      setAmount(values[next]);
                      setScrolling(true);
                      if (settling.current) clearTimeout(settling.current);
                      settling.current = setTimeout(
                        () => setScrolling(false),
                        180,
                      );
                    }}
                  >
                    {values.map((value) => (
                      <View
                        key={value}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={{
                          height: rowHeight,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <T
                          raw
                          style={{
                            fontSize: 20,
                            color: value === amount ? c.primary : c.muted,
                            fontWeight: value === amount ? "700" : "400",
                          }}
                        >
                          {value} mL
                        </T>
                      </View>
                    ))}
                  </ScrollView>
                </View>
                <View
                  style={{
                    flexDirection: fontScale > 1.3 ? "column" : "row",
                    gap: 8,
                  }}
                >
                  <Button
                    label="减少奶量"
                    secondary
                    disabled={saving || index === 0}
                    onPress={() => select(index - 1)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label="增加奶量"
                    secondary
                    disabled={saving || index === values.length - 1}
                    onPress={() => select(index + 1)}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : (
              <T>亲喂仅记录时长，不估算奶量。</T>
            )}
            {error ? <T accessibilityRole="alert">{error}</T> : null}
            <Button
              label={saving ? "正在保存" : "确认并保存"}
              disabled={saving || scrolling}
              onPress={() => void save()}
            />
            <Button
              label="取消，继续喂养"
              secondary
              disabled={saving}
              onPress={onCancel}
            />
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
