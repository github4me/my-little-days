import React, { useCallback, useContext, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import Modal from "./AccessibleModal";
import { Field, T, Theme } from "./ui";
import { useI18n } from "./i18n";

const pad = (value: number) => String(value).padStart(2, "0");
function displayValue(date: Date, mode: "date" | "time") {
  return mode === "date"
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Native date/time input; selection changes only the caller's unsaved form. */
export default function NativeDateTimeField({
  label,
  value,
  onChange,
  mode,
  editable = true,
  placeholder,
  minimumDate,
  maximumDate,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode: "date" | "time";
  editable?: boolean;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  optional?: boolean;
}) {
  const c = useContext(Theme);
  const { t, locale } = useI18n();
  const [picker, setPicker] = useState<{ value: Date } | null>(null);
  const context = useRef({
    picker,
    editable,
    onChange,
    mode,
    minimumDate,
    maximumDate,
  });
  context.current = {
    picker,
    editable,
    onChange,
    mode,
    minimumDate,
    maximumDate,
  };
  function bound(date: Date) {
    const { minimumDate: min, maximumDate: max } = context.current;
    return new Date(
      Math.max(
        min?.getTime() ?? -Infinity,
        Math.min(max?.getTime() ?? Infinity, date.getTime()),
      ),
    );
  }
  function open() {
    if (!editable) return;
    Keyboard.dismiss();
    // A recurring clock time isn't today's timestamp: use an ordinary reference
    // day so today's DST jump cannot silently turn a saved 02:30 into 03:30.
    let initial = mode === "time" ? new Date(2000, 0, 15, 9) : new Date();
    if (mode === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      const candidate = new Date(year, month - 1, day, 12);
      if (displayValue(candidate, mode) === value) initial = candidate;
    } else if (mode === "time" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      const [hour, minute] = value.split(":").map(Number);
      initial.setHours(hour, minute, 0, 0);
    }
    setPicker({ value: bound(initial) });
  }
  const onPickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      const latest = context.current;
      if (!picker || picker !== latest.picker) return;
      if (!latest.editable || event.type !== "set" || !selected) {
        if (!latest.editable || Platform.OS !== "ios") setPicker(null);
        return;
      }
      const next = bound(selected);
      if (Platform.OS === "ios") setPicker({ value: next });
      else {
        latest.onChange(displayValue(next, latest.mode));
        setPicker(null);
      }
    },
    [picker],
  );
  function accept() {
    const latest = context.current;
    if (latest.editable && latest.picker)
      latest.onChange(displayValue(bound(latest.picker.value), latest.mode));
    setPicker(null);
  }
  if (Platform.OS === "web")
    return (
      <Field
        label={label}
        value={value}
        onChange={onChange}
        editable={editable}
        placeholder={placeholder}
        maxLength={mode === "date" ? 10 : 5}
      />
    );
  const wheel = picker ? (
    <DateTimePicker
      value={bound(picker.value)}
      mode={mode}
      display={Platform.OS === "ios" ? "spinner" : "default"}
      themeVariant={c.isDark ? "dark" : "light"}
      locale={locale}
      is24Hour
      minimumDate={minimumDate}
      maximumDate={maximumDate}
      onChange={onPickerChange}
    />
  ) : null;
  return (
    <View style={{ gap: 6 }}>
      <T
        raw
        dynamicTypeRamp="subheadline"
        style={{ color: c.muted, fontSize: 15 }}
      >
        {t(label)}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(label)}
        accessibilityValue={{ text: value || t("未填写") }}
        accessibilityState={{ disabled: !editable, expanded: !!picker }}
        disabled={!editable}
        onPress={open}
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: c.controlLine,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 48,
          justifyContent: "center",
          backgroundColor: c.input,
          opacity: !editable ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <T raw style={{ fontSize: 17, color: value ? c.text : c.muted }}>
          {value || t("未填写")}
        </T>
      </Pressable>
      {optional && value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t(label)} · ${t("暂不填写")}`}
          accessibilityState={{ disabled: !editable }}
          disabled={!editable}
          onPress={() => {
            if (editable) onChange("");
          }}
          style={{
            minHeight: 44,
            minWidth: 44,
            justifyContent: "center",
            alignSelf: "flex-start",
          }}
        >
          <T style={{ color: c.primary, fontSize: 15 }}>暂不填写</T>
        </Pressable>
      ) : null}
      {Platform.OS === "ios" && picker ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPicker(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.45)",
              justifyContent: "flex-end",
            }}
          >
            <Pressable
              accessible={false}
              onPress={() => setPicker(null)}
              style={{ flex: 1 }}
            />
            <SafeAreaView
              edges={["bottom", "left", "right"]}
              accessibilityViewIsModal
              onAccessibilityEscape={() => setPicker(null)}
              style={{
                backgroundColor: c.elevated,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingHorizontal: 14,
                paddingTop: 10,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicker(null)}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    justifyContent: "center",
                    padding: 8,
                  }}
                >
                  <T style={{ color: c.primary }}>取消</T>
                </Pressable>
                <T
                  raw
                  accessibilityRole="header"
                  style={{
                    flexShrink: 1,
                    textAlign: "center",
                    fontWeight: "700",
                  }}
                >
                  {t(label)}
                </T>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !editable }}
                  disabled={!editable}
                  onPress={accept}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    justifyContent: "center",
                    padding: 8,
                  }}
                >
                  <T style={{ color: c.primary, fontWeight: "700" }}>完成</T>
                </Pressable>
              </View>
              {wheel}
            </SafeAreaView>
          </View>
        </Modal>
      ) : Platform.OS === "android" ? (
        wheel
      ) : null}
    </View>
  );
}
