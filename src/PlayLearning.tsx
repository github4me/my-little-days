import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Modal from "./AccessibleModal";
import { Button, Card, T, Theme } from "./ui";
import { useI18n } from "./i18n";
import DailyCare from "./DailyCare";
import HelpDisclosure from "./HelpDisclosure";
import PlayIcon, { type PlayIconKind } from "./PlayIcon";
import type { CareRecord } from "./domain";
import {
  loadPlaySelection,
  savePlaySelection,
  loadPlayCheckins,
  savePlayCheckins,
} from "./storage";
import {
  activitiesForBand,
  selectedPlayIds,
  changePlaySelection,
  type PlaySelection,
  ageBands,
  completedMonths,
  playDayKey,
  learningSources,
  playActivities,
  scenes,
  type LearningText,
} from "./learning";

function Options({
  options,
  value,
  onChange,
}: {
  options: { value: string; icon: PlayIconKind; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const c = useContext(Theme);
  const { width, fontScale } = useWindowDimensions();
  const basis =
    fontScale >= 2 ? "100%" : fontScale >= 1.3 || width < 360 ? "46%" : 0;
  return (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityLabel={o.label}
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={{
            flexGrow: 1,
            flexBasis: basis,
            minWidth: 44,
            minHeight: 62,
            borderRadius: 16,
            padding: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: value === o.value ? c.soft : c.card,
            borderWidth: value === o.value ? 2 : 1,
            borderColor: value === o.value ? c.primary : c.line,
          }}
        >
          <PlayIcon kind={o.icon} color={c.primary} />
          <T
            raw
            style={{
              fontSize: 13,
              lineHeight: 18,
              textAlign: "center",
              fontWeight: value === o.value ? "700" : "400",
            }}
          >
            {o.label}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

export default function PlayLearning({
  birthDate,
  now,
  careRecords,
  onSaveCare,
  onDeleteCare,
  sharedMode = false,
  supplementsEnabled = !sharedMode,
  careVersions,
  canEditCare,
  sharedPlay,
}: {
  birthDate: string;
  now: number;
  careRecords: CareRecord[];
  onSaveCare: (record: CareRecord, baseVersion?: string) => Promise<void>;
  onDeleteCare: (id: string, baseVersion?: string) => Promise<void>;
  sharedMode?: boolean;
  supplementsEnabled?: boolean;
  careVersions?: Record<string, string>;
  canEditCare?: (id: string) => boolean;
  sharedPlay?: {
    selection: PlaySelection;
    checkins: string[];
    canChangeSelection: boolean;
    canToggleCheckin: (activityId: string) => boolean;
    onChangeSelection: (selection: PlaySelection) => Promise<void>;
    onToggleCheckin: (activityId: string) => Promise<void>;
  };
}) {
  const c = useContext(Theme);
  const { fontScale } = useWindowDimensions();
  const { localize: text } = useI18n();
  const copy = (value: LearningText) => text(value.zh, value.en);
  const actualMonths = completedMonths(birthDate, new Date(now));
  const actualSupported = actualMonths !== null && actualMonths < 25;
  const [manualMonths, setManualMonths] = useState<number | null>(null);
  const [mode, setMode] = useState("care");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selection, setSelection] = useState<PlaySelection>({
    included: [],
    excluded: [],
  });
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "save" | "link" | null>(null);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const day = playDayKey(new Date(now));
  const [checkins, setCheckins] = useState<{
    day: string;
    ids: string[];
  } | null>(null);
  const [checkinError, setCheckinError] = useState<"load" | "save" | null>(
    null,
  );
  const [checkinRetry, setCheckinRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const checkinLock = useRef(false);
  const currentDay = useRef(day);
  currentDay.current = day;
  const checkinsReady = sharedMode ? !!sharedPlay : checkins?.day === day;
  const doneToday = sharedMode
    ? (sharedPlay?.checkins ?? [])
    : checkins?.day === day
      ? checkins.ids
      : [];
  const currentSelection = sharedMode
    ? (sharedPlay?.selection ?? { included: [], excluded: [] })
    : selection;
  const selectionReady = sharedMode || ready;
  const canChangeSelection = !sharedMode || !!sharedPlay?.canChangeSelection;
  const canToggleCheckin = (id: string) =>
    !sharedMode || !!sharedPlay?.canToggleCheckin(id);
  useEffect(() => {
    let active = true;
    setCheckins(null);
    setCheckinError(null);
    if (sharedMode) {
      setCheckins({ day, ids: [] });
      return;
    }
    void loadPlayCheckins(day)
      .then((ids) => {
        if (active) setCheckins({ day, ids });
      })
      .catch(() => {
        if (active) setCheckinError("load");
      });
    return () => {
      active = false;
    };
  }, [day, checkinRetry, sharedMode]);
  async function toggleCheckin(id: string) {
    if (!checkinsReady || checkinLock.current || !canToggleCheckin(id)) return;
    checkinLock.current = true;
    setChecking(true);
    const next = doneToday.includes(id)
      ? doneToday.filter((v) => v !== id)
      : [...doneToday, id];
    try {
      if (sharedMode) await sharedPlay!.onToggleCheckin(id);
      else await savePlayCheckins(day, next);
      if (currentDay.current === day) {
        if (!sharedMode) setCheckins({ day, ids: next });
        setCheckinError(null);
      }
    } catch {
      if (currentDay.current === day) setCheckinError("save");
    } finally {
      checkinLock.current = false;
      setChecking(false);
    }
  }
  useEffect(() => {
    let active = true;
    setReady(false);
    if (sharedMode) {
      setSelection({ included: [], excluded: [] });
      setReady(true);
      return;
    }
    void loadPlaySelection()
      .then((value) => {
        if (active) {
          setSelection(value);
          setReady(true);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError("load");
      });
    return () => {
      active = false;
    };
  }, [retry, sharedMode]);
  useEffect(() => {
    setManualMonths(null);
    setExpanded(null);
    setPendingSelection(null);
  }, [birthDate]);
  const months =
    manualMonths ??
    (actualSupported
      ? ageBands.find((b) => actualMonths >= b.min && actualMonths < b.max)!.min
      : 0);
  const selectedIds = selectionReady
    ? selectedPlayIds(actualMonths, currentSelection)
    : [];
  const pendingActivity = playActivities.find((a) => a.id === pendingSelection);
  const shown =
    mode === "choose"
      ? activitiesForBand(months)
      : playActivities.filter((a) => selectedIds.includes(a.id));
  function requestSelection(id: string) {
    if (!canChangeSelection || !selectionReady || lock.current) return;
    const a = playActivities.find((v) => v.id === id)!;
    if (
      !selectedIds.includes(id) &&
      (actualMonths === null || actualMonths < a.min || actualMonths >= a.max)
    ) {
      setPendingSelection(id);
      return;
    }
    void updateSelection(id, !selectedIds.includes(id));
  }
  async function updateSelection(id: string, selected: boolean) {
    if (!canChangeSelection || !selectionReady || lock.current) return;
    lock.current = true;
    setSaving(true);
    try {
      const next = changePlaySelection(currentSelection, id, selected);
      if (sharedMode) await sharedPlay!.onChangeSelection(next);
      else {
        await savePlaySelection(next);
        setSelection(next);
      }
      setPendingSelection(null);
      setError(null);
    } catch {
      setError("save");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function openSource(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setError("link");
    }
  }
  return (
    <View style={{ gap: 16 }}>
      {sharedMode && !sharedPlay ? (
        <T raw style={{ color: c.muted, fontSize: 12 }}>
          {text(
            "日常照护记录与家庭共享。当前服务尚不支持共享早教设置和打卡，可先阅读活动指南。",
            "Daily care records are shared. This server does not yet support shared play settings or check-ins; activity guides remain available to read.",
          )}
        </T>
      ) : null}
      <Modal
        visible={!!pendingActivity}
        transparent
        animationType="none"
        onRequestClose={() => {
          if (!saving) setPendingSelection(null);
        }}
      >
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <ScrollView
            style={{
              flexGrow: 0,
              maxHeight: "80%",
              backgroundColor: c.elevated,
              borderRadius: 20,
            }}
            contentContainerStyle={{ padding: 20, gap: 14 }}
          >
            <T
              raw
              accessibilityRole="header"
              style={{ fontSize: 20, fontWeight: "700" }}
            >
              {text("确认添加早教活动", "Confirm play activity")}
            </T>
            <T raw>{pendingActivity ? copy(pendingActivity.title) : ""}</T>
            <T raw accessibilityRole="alert">
              {actualMonths === null
                ? text(
                    "尚未设置有效的出生日期，无法判断是否适龄。",
                    "No valid birth date is set, so age suitability cannot be checked.",
                  )
                : text(
                    "宝宝实际满 {months} 个月，这项活动不在当前参考月龄内。",
                    "Your baby is {months} completed months old. This activity is outside the current reference age.",
                    { months: actualMonths },
                  )}
            </T>
            <T raw>
              {pendingActivity
                ? text(
                    "活动参考月龄：满 {min} 月至未满 {max} 月。请根据宝宝实际能力选择；是否仍要加入？",
                    "Activity reference age: {min} to under {max} months. Consider your child's abilities. Add it anyway?",
                    { min: pendingActivity.min, max: pendingActivity.max },
                  )
                : ""}
            </T>
            <T raw style={{ fontSize: 12, lineHeight: 19, color: c.muted }}>
              {pendingActivity ? copy(pendingActivity.safety) : ""}
            </T>
            {error === "save" ? (
              <T raw accessibilityRole="alert">
                {text(
                  "早教设置未保存，请重试。",
                  "Play settings were not saved. Please try again.",
                )}
              </T>
            ) : null}
            <Button
              label={text("仍然加入", "Add anyway")}
              disabled={saving}
              busy={saving}
              onPress={() => {
                if (pendingActivity)
                  void updateSelection(pendingActivity.id, true);
              }}
            />
            <Button
              label={text("暂不加入", "Not now")}
              secondary
              disabled={saving}
              onPress={() => setPendingSelection(null)}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {mode === "choose" ? (
        <View style={{ gap: 8 }}>
          <T raw style={{ fontSize: 13, color: c.muted }}>
            {manualMonths !== null
              ? text("正在浏览手选月龄", "Browsing a selected age group")
              : actualSupported
                ? text(
                    "按宝宝满 {months} 个月推荐",
                    "Ideas for your baby's age: {months} months",
                    { months: actualMonths },
                  )
                : actualMonths !== null && actualMonths >= 25
                  ? text(
                      "首版覆盖未满 25 个月，可手选月龄浏览，不作为当前推荐。",
                      "This library covers children under 25 months. Choose a group to browse, not as a current-age recommendation.",
                    )
                  : text(
                      "还没有可用的出生日期，请先选月龄浏览。",
                      "No usable birth date yet. Choose an age group to browse.",
                    )}
          </T>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
          >
            {ageBands.map((band) => (
              <Pressable
                key={band.min}
                accessibilityRole="button"
                accessibilityLabel={text("{label} 个月", "{label} months", {
                  label: band.label,
                })}
                accessibilityState={{
                  selected:
                    months !== null && months >= band.min && months < band.max,
                }}
                onPress={() => {
                  setManualMonths(band.min);
                  setExpanded(null);
                }}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  justifyContent: "center",
                  borderRadius: 13,
                  borderWidth:
                    months !== null && months >= band.min && months < band.max
                      ? 2
                      : 1,
                  borderColor:
                    months !== null && months >= band.min && months < band.max
                      ? c.primary
                      : c.line,
                  backgroundColor:
                    months !== null && months >= band.min && months < band.max
                      ? c.soft
                      : c.card,
                }}
              >
                <T raw style={{ fontSize: 15, color: c.primary }}>
                  {text("{label} 月", "{label} mo", { label: band.label })}
                </T>
              </Pressable>
            ))}
          </ScrollView>
          <T raw style={{ fontSize: 11, color: c.muted }}>
            {text(
              "分组含起始月龄、不含结束月龄；例如 1–2 月指满 1 月、未满 2 月。",
              "Ranges include the starting age, not the ending age: 1–2 months means from 1 month until before 2 months.",
            )}
          </T>
          {manualMonths !== null && actualSupported ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setManualMonths(null);
                setExpanded(null);
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <T raw style={{ fontSize: 12, color: c.primary }}>
                {text("回到宝宝实际月龄", "Use baby's actual age")}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Options
        value={mode}
        onChange={(value) => {
          setMode(value);
          setExpanded(null);
        }}
        options={[
          {
            value: "care",
            icon: "care",
            label: text("日常", "Daily care"),
          },
          {
            value: "today",
            icon: "activities",
            label: text("早教", "Play"),
          },
          {
            value: "choose",
            icon: "choose",
            label: text("设置早教", "Play settings"),
          },
        ]}
      />
      {mode === "care" ? (
        <DailyCare
          supplementsEnabled={supplementsEnabled}
          records={careRecords}
          birthDate={birthDate}
          now={now}
          onSave={onSaveCare}
          onDelete={onDeleteCare}
          sharedMode={sharedMode}
          versions={careVersions}
          canEdit={canEditCare}
        />
      ) : (
        <>
          {error ? (
            <View style={{ gap: 4 }}>
              <T raw accessibilityRole="alert" style={{ color: c.primary }}>
                {error === "load"
                  ? text(
                      "早教设置无法读取，原数据未覆盖。",
                      "Play settings could not be loaded; existing data was not changed.",
                    )
                  : error === "save"
                    ? text(
                        "早教设置未保存，请重试。",
                        "Play settings were not saved. Please try again.",
                      )
                    : text(
                        "无法打开参考链接，请联网后重试。",
                        "Could not open the reference. Check your connection and try again.",
                      )}
              </T>
              {error === "load" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetry((v) => v + 1)}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <T raw>{text("重新读取早教设置", "Reload play settings")}</T>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <T raw style={{ color: c.muted, fontSize: 12 }}>
            {text(
              "已选 {count} 项。默认随实际月龄选择；手动增减会保留。",
              "{count} selected. Defaults follow actual age; manual choices are kept.",
              { count: selectedIds.length },
            )}
          </T>
          {mode === "today" ? (
            <T raw style={{ color: c.muted, fontSize: 12 }}>
              {day} ·{" "}
              {checkinsReady
                ? text(
                    "今天做过 {count} 项，自在选择就好",
                    "{count} checked in today. Choose freely.",
                    { count: doneToday.length },
                  )
                : sharedMode
                  ? text(
                      "当前服务暂不支持共享打卡",
                      "Shared check-ins are not available on this server",
                    )
                  : text("正在读取今日打卡…", "Loading today's check-ins…")}
            </T>
          ) : null}
          {checkinError ? (
            <View>
              <T
                raw
                accessibilityRole="alert"
                style={{ fontSize: 13, color: c.primary }}
              >
                {checkinError === "load"
                  ? text(
                      "今日打卡无法读取，原数据未覆盖。",
                      "Today's check-ins could not be loaded; existing data was not changed.",
                    )
                  : text(
                      "打卡未保存，请重试。",
                      "Check-in was not saved. Please try again.",
                    )}
              </T>
              {checkinError === "load" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setCheckinRetry((v) => v + 1)}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <T raw>{text("重新读取打卡", "Reload check-ins")}</T>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {shown.map((a) => {
            const open = expanded === a.id;
            const saved = selectedIds.includes(a.id);
            const currentScene = scenes.find((s) => s.id === a.scene)!;
            const source = learningSources[a.source];
            return (
              <Card key={a.id} style={{ padding: 16, gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={text(
                    "{action}{title}",
                    "{action} {title}",
                    {
                      action: open
                        ? text("收起", "Hide")
                        : text("查看", "View"),
                      title: copy(a.title),
                    },
                  )}
                  accessibilityState={{ expanded: open }}
                  onPress={() => setExpanded(open ? null : a.id)}
                  style={{ minHeight: 48, gap: 4 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <T
                      raw
                      style={{
                        color: c.primary,
                        fontWeight: "700",
                        fontSize: 17,
                        lineHeight: 23,
                        flex: 1,
                      }}
                    >
                      {copy(a.title)}
                    </T>
                    <T raw style={{ color: c.primary }}>
                      {open ? "▴" : "▾"}
                    </T>
                  </View>
                  <T
                    raw
                    style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}
                  >
                    {copy(currentScene.label)} ·{" "}
                    {text("约 {minutes} 分钟", "About {minutes} min", {
                      minutes: a.minutes,
                    })}{" "}
                    · {copy(a.focus)}
                  </T>
                </Pressable>
                {actualMonths === null ||
                actualMonths < a.min ||
                actualMonths >= a.max ? (
                  <T raw style={{ fontSize: 12, color: c.muted }}>
                    {text(
                      "参考月龄：满 {min} 月至未满 {max} 月，不是当前月龄推荐。",
                      "Reference ages: {min} to under {max} months; not a current-age recommendation.",
                      { min: a.min, max: a.max },
                    )}
                  </T>
                ) : null}
                {open ? (
                  <View style={{ gap: 10, paddingTop: 4 }}>
                    <T raw style={{ fontSize: 17 }}>
                      {text("准备：", "You need: ")}
                      {copy(a.materials)}
                    </T>
                    {a.steps.map((step, index) => (
                      <View
                        key={index}
                        style={{ flexDirection: "row", gap: 8 }}
                      >
                        <T raw style={{ color: c.primary, fontSize: 13 }}>
                          {index + 1}.
                        </T>
                        <T
                          raw
                          style={{ fontSize: 17, lineHeight: 24, flex: 1 }}
                        >
                          {copy(step)}
                        </T>
                      </View>
                    ))}
                    <View
                      style={{
                        backgroundColor: c.soft,
                        padding: 10,
                        borderRadius: 12,
                      }}
                    >
                      <T raw style={{ fontSize: 15, lineHeight: 22 }}>
                        {text("安全提醒：", "Keep it safe: ")}
                        {copy(a.safety)}
                      </T>
                    </View>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={text(
                        "参考来源：{source}",
                        "Reference: {source}",
                        { source: source.label },
                      )}
                      onPress={() => void openSource(source.url)}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <T raw style={{ fontSize: 12, color: c.primary }}>
                        {text("参考原则 · ", "Reference · ")}
                        {source.label} ↗
                      </T>
                    </Pressable>
                  </View>
                ) : null}
                <View
                  style={{
                    flexDirection: fontScale >= 1.3 ? "column" : "row",
                    alignItems: fontScale >= 1.3 ? "stretch" : "center",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  {mode === "today" ? (
                    <Pressable
                      accessibilityRole="checkbox"
                      aria-checked={doneToday.includes(a.id)}
                      accessibilityLabel={text(
                        "今天做过：{title}",
                        "Done today: {title}",
                        { title: copy(a.title) },
                      )}
                      accessibilityState={{
                        checked: doneToday.includes(a.id),
                        busy: checking,
                        disabled:
                          !checkinsReady || checking || !canToggleCheckin(a.id),
                      }}
                      disabled={
                        !checkinsReady || checking || !canToggleCheckin(a.id)
                      }
                      onPress={() => void toggleCheckin(a.id)}
                      style={{
                        minHeight: 44,
                        justifyContent: "center",
                        flexShrink: 1,
                        opacity:
                          checkinsReady && !checking && canToggleCheckin(a.id)
                            ? 1
                            : 0.5,
                      }}
                    >
                      <T
                        raw
                        style={{
                          color: c.primary,
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {doneToday.includes(a.id) ? "☑ " : "□ "}
                        {doneToday.includes(a.id)
                          ? text("今天已打卡", "Checked in today")
                          : text("今天做过", "Done today")}
                      </T>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="checkbox"
                    aria-checked={saved}
                    accessibilityLabel={text(
                      "选择早教活动：{title}",
                      "Select play activity: {title}",
                      { title: copy(a.title) },
                    )}
                    accessibilityState={{
                      checked: saved,
                      busy: saving,
                      disabled:
                        !selectionReady || saving || !canChangeSelection,
                    }}
                    disabled={!selectionReady || saving || !canChangeSelection}
                    onPress={() => requestSelection(a.id)}
                    style={{
                      minHeight: 44,
                      flexShrink: 1,
                      justifyContent: "center",
                      paddingHorizontal: 4,
                      opacity:
                        selectionReady && !saving && canChangeSelection
                          ? 1
                          : 0.5,
                    }}
                  >
                    <T raw style={{ color: c.primary, fontSize: 13 }}>
                      {saved ? "☑ " : "□ "}
                      {saved
                        ? text("已选早教活动", "Selected")
                        : text("加入早教活动", "Add to activities")}
                    </T>
                  </Pressable>
                </View>
              </Card>
            );
          })}
          {!shown.length ? (
            <T raw style={{ color: c.muted }}>
              {!ready
                ? text("正在读取早教设置…", "Loading play settings…")
                : text(
                    "还没有早教活动，请到「设置早教」添加。未设置出生日期时不会自动选择。",
                    "No play activities yet. Add them in Play settings. No activities are selected automatically without a birth date.",
                  )}
            </T>
          ) : null}
          <HelpDisclosure
            title={text("早教说明与参考", "Play help & references")}
          >
            <T raw style={{ fontWeight: "600", fontSize: 16 }}>
              {mode === "choose"
                ? text(
                    "设置适合你们的早教活动",
                    "Choose the play that suits you",
                  )
                : text(
                    "把日常，变成一起玩的时光",
                    "A little play in everyday moments",
                  )}
            </T>
            <T raw style={{ color: c.muted, fontSize: 13, lineHeight: 20 }}>
              {mode === "choose"
                ? text(
                    "按月龄浏览并选择，勾选后自动保存，所选项目会显示在「早教」。可跨月龄选择，参考范围不符时会提示。",
                    "Browse by age and choose activities. Selections save automatically and appear in Play. You can choose other ages; a prompt flags activities outside your baby's reference age.",
                  )
                : text(
                    "给家长参考的亲子早教活动，不是宝宝的屏幕课程。先读步骤，再放下手机陪伴。做过可自愿打卡，不必全部完成。",
                    "Parent-led play activities, not screen lessons for babies. Read first, then put the phone away. Check in if you like; there is no need to do everything.",
                  )}
            </T>
            <T raw style={{ fontSize: 12, lineHeight: 20, color: c.muted }}>
              {text(
                "月龄只是浏览参考，不是敏感期或达标清单。按宝宝兴趣和能力选择；早产或有特殊需要时，适龄活动请咨询儿科医生。若担心发展或已会的技能退步，请及时咨询专业人员。",
                "Age is a browsing guide, not a sensitive-period deadline or checklist. Follow your child's interests and abilities. Ask your clinician about suitable play for prematurity or additional needs, or if development or loss of skills concerns you.",
              )}
            </T>
            <T raw style={{ fontSize: 11, lineHeight: 18, color: c.muted }}>
              {text(
                "活动由参考资料整理改写，时长和分组为浏览建议，未作临床验证。打卡仅表示今天做过，不代表完成建议活动量。",
                "Activities are editorial adaptations; times and age groups are browsing suggestions, not clinically validated guidance. A check-in means you tried it today, not that a recommended activity amount was met.",
              )}{" "}
              {sharedMode
                ? text(
                    "家庭早教设置和打卡以服务确认的同步结果为准。",
                    "Family play settings and check-ins depend on confirmed synchronization.",
                  )
                : text(
                    "早教设置和每日打卡仅保存在本机，不包含在记录备份中。",
                    "Play settings and dated check-ins stay locally and are not included in record backups.",
                  )}
            </T>
            <Pressable
              accessibilityRole="link"
              onPress={() => void openSource(learningSources.who.url)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <T raw style={{ fontSize: 12, color: c.primary }}>
                {text(
                  "为什么先放下屏幕？WHO 参考 ↗",
                  "Why put the screen away? WHO reference ↗",
                )}
              </T>
            </Pressable>
          </HelpDisclosure>
        </>
      )}
      {sharedMode && sharedPlay ? (
        <HelpDisclosure
          title={text("家庭共享说明与参考", "Family sharing help & references")}
        >
          <T raw style={{ color: c.muted, fontSize: 12 }}>
            {text(
              "早教设置和打卡与家庭共享。管理员选择活动；成员可打卡并取消自己添加的打卡，管理员可管理全部打卡。",
              "Play settings and check-ins are shared with your family. The admin chooses activities. Members can add or undo their own check-ins; the admin can manage all check-ins.",
            )}
          </T>
        </HelpDisclosure>
      ) : null}
    </View>
  );
}
