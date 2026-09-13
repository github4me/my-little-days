import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import Svg, { Path } from "react-native-svg";
import { light, dark as night } from "./ui";
import { Entry, makeId, validateEntry } from "./domain";
import { t } from "./i18n";
import { feedAmountPresets, formulaFeedingSource } from "./feedAmountPresets";

const names = {
  feed: "喂养",
  diaper: "尿布",
  sleep: "睡眠",
  growth: "成长测量",
  milestone: "成长里程碑",
};
type FeedKind = NonNullable<Entry["feedKind"]>;
const feedOptions: { kind: FeedKind; label: string }[] = [
  { kind: "formula", label: "配方奶" },
  { kind: "expressed", label: "瓶喂" },
  { kind: "breast-left", label: "左侧" },
  { kind: "breast-right", label: "右侧" },
  { kind: "breast-both", label: "双侧" },
];

function FeedModeIcon({ kind, color }: { kind: FeedKind; color: string }) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  if (kind === "formula" || kind === "expressed")
    return (
      <Svg
        width={27}
        height={27}
        viewBox="0 0 30 30"
        accessibilityElementsHidden
      >
        <Path d="M12 8V6h1V3.5a2 2 0 0 1 4 0V6h1v2M10 8h10v3H10Z" {...stroke} />
        <Path
          d="M10 11h10l1 3v10a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V14l1-3ZM9 15h12"
          {...stroke}
        />
        {kind === "formula" ? (
          <>
            <Path d="M18 18h3M18 21h3M18 24h3" {...stroke} />
          </>
        ) : (
          <Path
            d="M15 15.2c-1.7 2-2.6 3.3-2.6 4.5a2.6 2.6 0 0 0 5.2 0c0-1.2-.9-2.5-2.6-4.5Z"
            {...stroke}
          />
        )}
      </Svg>
    );

  return (
    <Svg width={32} height={28} viewBox="0 0 36 32" accessibilityElementsHidden>
      <Path d="M6 12V3h2v9M28 12V3h2v9M4 23l2 5h24l2-5M15 22h6" {...stroke} />
      <Path
        d="M6 12c6 0 9 5 10 11-4 2-8 2-12 0-2-4-1-8 2-11Z"
        {...stroke}
        fill={kind === "breast-left" ? color : "none"}
      />
      <Path
        d="M30 12c-6 0-9 5-10 11 4 2 8 2 12 0 2-4 1-8-2-11Z"
        {...stroke}
        fill={kind === "breast-right" ? color : "none"}
      />
    </Svg>
  );
}
const pad = (n: number) => String(n).padStart(2, "0");
function localFields(iso: string) {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function localISO(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error(t("时间格式应为 YYYY-MM-DD 和 HH:mm"));
  const [y, m, day] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number);
  const d = new Date(y, m - 1, day, h, min);
  if (
    d.getFullYear() !== y ||
    d.getMonth() !== m - 1 ||
    d.getDate() !== day ||
    d.getHours() !== h ||
    d.getMinutes() !== min
  )
    throw new Error(t("日期或时间无效，请检查输入"));
  return d.toISOString();
}
export function newEntry(type: Entry["type"]): Entry {
  const base: Entry = {
    id: makeId(),
    type,
    start: new Date().toISOString(),
    note: "",
  };
  if (type === "feed") return { ...base, feedKind: "formula", amount: 120 };
  if (type === "diaper") return { ...base, diaperKind: "wet" };
  if (type === "milestone") return { ...base, title: "" };
  return base;
}
export default function EntryEditor({
  entry,
  birthDate,
  onSave,
  onClose,
  dark,
}: {
  entry: Entry;
  birthDate: string;
  onSave: (entry: Entry) => Promise<void>;
  onClose: () => void;
  dark: boolean;
}) {
  const [draft, setDraft] = useState(entry);
  const initialEnd = useRef(entry.end ?? new Date().toISOString());
  const [start, setStart] = useState(localFields(entry.start));
  const [end, setEnd] = useState(localFields(initialEnd.current));
  const [hasEnd, setHasEnd] = useState(!!entry.end);
  const feedEndInitialized = useRef(!!entry.end);
  const [amount, setAmount] = useState(String(entry.amount ?? 120));
  const [sourceError, setSourceError] = useState(false);
  const [weight, setWeight] = useState(
    entry.weight === undefined ? "" : String(entry.weight),
  );
  const [length, setLength] = useState(
    entry.length === undefined ? "" : String(entry.length),
  );
  const [head, setHead] = useState(
    entry.head === undefined ? "" : String(entry.head),
  );
  const [picker, setPicker] = useState<{
    target: "start" | "end";
    mode: "date" | "time";
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  const palette = dark ? night : light;
  const bg = palette.bg,
    card = palette.card,
    ink = palette.text,
    muted = palette.muted;
  const accent = dark ? "#447FA6" : "#34759D";
  const bottle = draft.feedKind === "formula" || draft.feedKind === "expressed";
  const quickAmounts = feedAmountPresets(birthDate, start.date, draft.feedKind);
  const inputStyle = [
    s.input,
    {
      backgroundColor: card,
      color: ink,
      borderColor: palette.line,
    },
  ];
  const label = (text: string) => (
    <Text style={[s.label, { color: ink }]}>{t(text)}</Text>
  );
  const chip = (
    text: string,
    selected: boolean,
    press: () => void,
    style?: StyleProp<ViewStyle>,
  ) => (
    <Pressable
      key={text}
      disabled={busy}
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        s.chip,
        style,
        {
          backgroundColor: selected ? accent : card,
          borderColor: selected ? accent : palette.line,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? "#FFFFFF" : ink,
          fontSize: 15,
          fontWeight: "600",
        }}
      >
        {t(text)}
      </Text>
    </Pressable>
  );
  const iconChoice = (
    text: string,
    icon: string,
    selected: boolean,
    press: () => void,
  ) => (
    <Pressable
      key={text}
      accessibilityRole="button"
      accessibilityLabel={t(text)}
      accessibilityState={{ selected }}
      disabled={busy}
      onPress={press}
      style={({ pressed }) => [
        s.iconChoice,
        {
          backgroundColor: selected ? accent : card,
          borderColor: selected ? accent : palette.line,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? "#FFFFFF" : accent,
          fontSize: 21,
          lineHeight: 24,
          fontWeight: "600",
        }}
      >
        {icon}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          color: selected ? "#FFFFFF" : muted,
          fontSize: 11,
          lineHeight: 15,
          fontWeight: selected ? "700" : "600",
        }}
      >
        {t(text)}
      </Text>
    </Pressable>
  );
  const feedMode = ({ kind, label: text }: (typeof feedOptions)[number]) => {
    const selected = draft.feedKind === kind;
    return (
      <Pressable
        key={kind}
        accessibilityRole="button"
        accessibilityLabel={t("喂养方式：{kind}", { kind: t(text) })}
        accessibilityState={{ selected }}
        disabled={busy}
        onPress={() => setDraft({ ...draft, feedKind: kind })}
        style={({ pressed }) => [s.feedMode, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View
          style={[
            s.feedModeIcon,
            {
              backgroundColor: selected ? accent : card,
              borderColor: selected ? accent : palette.line,
            },
          ]}
        >
          <FeedModeIcon kind={kind} color={selected ? "#FFFFFF" : accent} />
        </View>
        <Text
          numberOfLines={1}
          style={[
            s.feedModeLabel,
            {
              color: selected ? accent : muted,
              fontWeight: selected ? "700" : "600",
            },
          ]}
        >
          {t(text)}
        </Text>
      </Pressable>
    );
  };
  const timeFields = (target: "start" | "end", title: string) => {
    const fields = target === "start" ? start : end,
      update = target === "start" ? setStart : setEnd;
    return (
      <View style={s.section}>
        {label(title)}
        <View style={s.row}>
          {Platform.OS === "web" ? (
            <>
              <TextInput
                accessibilityLabel={t("{title}日期", { title: t(title) })}
                editable={!busy}
                value={fields.date}
                onChangeText={(date) => update({ ...fields, date })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={muted}
                style={[inputStyle, { flex: 1.4 }]}
              />
              <TextInput
                accessibilityLabel={t("{title}时刻", { title: t(title) })}
                editable={!busy}
                value={fields.time}
                onChangeText={(time) => update({ ...fields, time })}
                placeholder="HH:mm"
                placeholderTextColor={muted}
                style={[inputStyle, { flex: 1 }]}
              />
            </>
          ) : (
            <>
              <Pressable
                disabled={busy}
                onPress={() => setPicker({ target, mode: "date" })}
                style={[inputStyle, { flex: 1.4 }]}
              >
                <Text style={{ color: ink, fontSize: 17 }}>{fields.date}</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => setPicker({ target, mode: "time" })}
                style={[inputStyle, { flex: 1 }]}
              >
                <Text style={{ color: ink, fontSize: 17 }}>{fields.time}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  };
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const originalStart = localFields(entry.start);
      const originalEnd = localFields(initialEnd.current);
      const result: Entry = {
        ...draft,
        start:
          start.date === originalStart.date && start.time === originalStart.time
            ? entry.start
            : localISO(start.date, start.time),
      };
      delete result.end;
      if (hasEnd && (entry.type === "feed" || entry.type === "sleep"))
        result.end =
          originalEnd &&
          end.date === originalEnd.date &&
          end.time === originalEnd.time
            ? initialEnd.current
            : localISO(end.date, end.time);
      if (
        Date.parse(result.start) > Date.now() + 60000 ||
        (result.end && Date.parse(result.end) > Date.now() + 60000)
      )
        throw new Error(t("请填写已经发生的时间"));
      if (entry.type === "feed") {
        delete result.feedRunning;
        if (!hasEnd) result.feedRunning = true;
        if (bottle) {
          if (!amount.trim()) throw new Error(t("请填写实际喝奶量"));
          result.amount = Number(amount);
        } else delete result.amount;
      }
      if (entry.type === "growth") {
        delete result.weight;
        delete result.length;
        delete result.head;
        if (weight.trim()) result.weight = Number(weight);
        if (length.trim()) result.length = Number(length);
        if (head.trim()) result.head = Number(head);
      }
      await onSave(validateEntry(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("保存失败，请重试"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <SafeAreaProvider>
        <SafeAreaView
          edges={["top", "left", "right", "bottom"]}
          style={{ flex: 1, backgroundColor: bg }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={s.header}>
              <View>
                <Text style={[s.kicker, { color: accent }]}>
                  {t("每一刻，都值得记住")}
                </Text>
                <Text style={[s.title, { color: ink }]}>
                  {t(names[entry.type])}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={t("关闭记录编辑")}
                disabled={busy}
                onPress={() => {
                  if (!saving.current) onClose();
                }}
                style={[s.close, { backgroundColor: card }]}
              >
                <Text style={{ fontSize: 24, color: ink }}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.content}
            >
              {entry.type === "feed" && (
                <View style={s.section}>
                  {label("喂养方式")}
                  <View style={s.feedModes}>{feedOptions.map(feedMode)}</View>
                  {bottle && (
                    <View style={s.feedAmount}>
                      {label("实际喝奶量 · mL")}
                      <TextInput
                        accessibilityLabel={t("实际喝奶量")}
                        editable={!busy}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        style={[inputStyle, s.largeInput]}
                      />
                      <View style={[s.amountChips, { marginTop: 10 }]}>
                        {quickAmounts.amounts.map((n) =>
                          chip(
                            `${n} mL`,
                            amount === String(n),
                            () => setAmount(String(n)),
                            s.amountChip,
                          ),
                        )}
                      </View>
                      {quickAmounts.ageAdjusted && (
                        <>
                          <Text style={[s.hint, { color: muted }]}>
                            {t(
                              "按喂养当天日龄（{days}天）提供快捷选项，并非建议奶量。请记录实际喝下的量，顺应饥饱信号或医护建议。",
                              {
                                days: quickAmounts.ageDays!,
                              },
                            )}
                          </Text>
                          <Pressable
                            accessibilityRole="link"
                            disabled={busy}
                            onPress={() => {
                              setSourceError(false);
                              void Linking.openURL(formulaFeedingSource).catch(
                                () => setSourceError(true),
                              );
                            }}
                            style={{ minHeight: 44, justifyContent: "center" }}
                          >
                            <Text
                              style={{ color: palette.primary, fontSize: 13 }}
                            >
                              {t("配方奶喂养参考 · 美国儿科学会 ↗")}
                            </Text>
                          </Pressable>
                          {sourceError && (
                            <Text
                              accessibilityRole="alert"
                              style={[s.hint, { color: muted }]}
                            >
                              {t("无法打开参考链接，请联网后重试。")}
                            </Text>
                          )}
                        </>
                      )}
                    </View>
                  )}
                </View>
              )}
              {entry.type === "diaper" && (
                <View style={s.section}>
                  {label("尿布情况")}
                  <View style={s.optionRow}>
                    {(
                      [
                        ["wet", "有尿", "⌁"],
                        ["dirty", "有便", "✦"],
                        ["mixed", "尿 + 便", "◉"],
                      ] as const
                    ).map(([kind, text, icon]) =>
                      iconChoice(text, icon, draft.diaperKind === kind, () =>
                        setDraft({ ...draft, diaperKind: kind }),
                      ),
                    )}
                  </View>
                </View>
              )}
              {entry.type === "sleep" && (
                <View style={s.section}>
                  {label("睡眠状态")}
                  <View style={s.optionRow}>
                    {iconChoice("正在睡", "☾", !hasEnd, () => setHasEnd(false))}
                    {iconChoice("已睡醒 / 补录", "✓", hasEnd, () =>
                      setHasEnd(true),
                    )}
                  </View>
                  <Text style={[s.hint, { color: muted }]}>
                    {t("保存开始时间后，关闭应用也不会丢失计时。")}
                  </Text>
                </View>
              )}
              {timeFields(
                "start",
                entry.type === "sleep" ? "入睡时间" : "记录时间",
              )}
              {entry.type === "feed" && (
                <View style={s.section}>
                  <View style={s.wrap}>
                    {chip(
                      hasEnd ? "✓ 记录结束时间" : "+ 记录结束时间（可选）",
                      hasEnd,
                      () => {
                        if (!hasEnd && !feedEndInitialized.current) {
                          try {
                            const startTime = localISO(start.date, start.time);
                            setEnd(
                              localFields(
                                new Date(
                                  Date.parse(startTime) + 20 * 60 * 1000,
                                ).toISOString(),
                              ),
                            );
                            feedEndInitialized.current = true;
                            setError("");
                          } catch (err) {
                            setError((err as Error).message);
                            return;
                          }
                        }
                        setHasEnd(!hasEnd);
                      },
                    )}
                  </View>
                </View>
              )}
              {hasEnd &&
                (entry.type === "feed" || entry.type === "sleep") &&
                timeFields(
                  "end",
                  entry.type === "sleep" ? "醒来时间" : "结束时间",
                )}
              {entry.type === "growth" && (
                <View style={s.section}>
                  {label("测量数据")}
                  <Text style={[s.hint, { color: muted, marginBottom: 14 }]}>
                    {t("至少填写一项；保留实际测量的小数。")}
                  </Text>
                  {(
                    [
                      ["体重 · kg", weight, setWeight],
                      ["身长 · cm", length, setLength],
                      ["头围 · cm", head, setHead],
                    ] as const
                  ).map(([text, value, update]) => (
                    <View key={text} style={{ marginBottom: 15 }}>
                      {label(text)}
                      <TextInput
                        accessibilityLabel={t(text)}
                        editable={!busy}
                        value={value}
                        onChangeText={update}
                        keyboardType="decimal-pad"
                        placeholder={t("未填写")}
                        placeholderTextColor={muted}
                        style={inputStyle}
                      />
                    </View>
                  ))}
                </View>
              )}
              {entry.type === "milestone" && (
                <View style={s.section}>
                  {label("里程碑标题")}
                  <TextInput
                    accessibilityLabel={t("里程碑标题")}
                    editable={!busy}
                    value={draft.title ?? ""}
                    onChangeText={(title) => setDraft({ ...draft, title })}
                    maxLength={200}
                    placeholder={t("例如：第一次对我笑")}
                    placeholderTextColor={muted}
                    style={inputStyle}
                  />
                </View>
              )}
              <View style={s.section}>
                {label("备注 · 可选")}
                <TextInput
                  accessibilityLabel={t("备注")}
                  editable={!busy}
                  value={draft.note}
                  onChangeText={(note) => setDraft({ ...draft, note })}
                  multiline
                  maxLength={10000}
                  placeholder={t("记下一点小细节…")}
                  placeholderTextColor={muted}
                  style={[
                    inputStyle,
                    { minHeight: 106, textAlignVertical: "top" },
                  ]}
                />
              </View>
              {!!error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {t(error)}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={save}
                style={[
                  s.save,
                  { backgroundColor: accent, opacity: busy ? 0.6 : 1 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={s.saveText}>
                    {t(
                      entry.type === "feed" && !hasEnd
                        ? "开始"
                        : entry.type === "sleep" && !hasEnd
                          ? "保存 · 继续计时"
                          : "保存记录",
                    )}
                  </Text>
                )}
              </Pressable>
              <Text style={[s.footer, { color: muted }]}>
                {t("仅保存在这台设备 · 无需联网")}
              </Text>
            </ScrollView>
            {picker && Platform.OS !== "web" && (
              <View style={{ backgroundColor: card }}>
                {Platform.OS === "ios" && (
                  <Pressable
                    onPress={() => setPicker(null)}
                    style={{ padding: 14, alignSelf: "flex-end" }}
                  >
                    <Text style={{ color: accent, fontWeight: "700" }}>
                      {t("完成")}
                    </Text>
                  </Pressable>
                )}
                <DateTimePicker
                  value={
                    new Date(
                      localISO(
                        (picker.target === "start" ? start : end).date,
                        (picker.target === "start" ? start : end).time,
                      ),
                    )
                  }
                  mode={picker.mode}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  themeVariant={dark ? "dark" : "light"}
                  onChange={(_, value) => {
                    if (Platform.OS !== "ios") setPicker(null);
                    if (value) {
                      const update =
                        picker.target === "start" ? setStart : setEnd;
                      update(localFields(value.toISOString()));
                    }
                  }}
                />
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const s = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 13,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 4,
  },
  title: { fontSize: 26, lineHeight: 31, fontWeight: "800" },
  close: {
    height: 44,
    width: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 24,
    paddingTop: 12,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 700,
    alignSelf: "center",
  },
  section: { marginBottom: 24 },
  label: { fontSize: 15, fontWeight: "600", marginBottom: 10 },
  row: { flexDirection: "row", gap: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  optionRow: { flexDirection: "row", gap: 8 },
  feedModes: { flexDirection: "row", gap: 5, alignItems: "flex-start" },
  feedMode: { flex: 1, alignItems: "center", gap: 7, minWidth: 0 },
  feedModeIcon: {
    width: 49,
    height: 49,
    borderRadius: 24.5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  feedModeLabel: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  feedAmount: { marginTop: 22 },
  amountChips: { flexDirection: "row", gap: 7 },
  amountChip: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 15,
    borderWidth: 1,
  },
  iconChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 6,
  },
  input: {
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    fontSize: 17,
    minHeight: 52,
  },
  largeInput: { fontSize: 34, fontWeight: "700", paddingVertical: 18 },
  hint: { fontSize: 13, lineHeight: 21, marginTop: 10 },
  error: { color: "#C64440", marginBottom: 18, fontSize: 14, lineHeight: 21 },
  save: {
    minHeight: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  footer: { textAlign: "center", fontSize: 12, marginTop: 16 },
});
