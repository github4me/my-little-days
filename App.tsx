import React, { useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Platform,
  useWindowDimensions,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Entry, State, summarize, validateState } from "./src/domain";
import {
  loadState,
  saveState,
  loadTheme,
  saveTheme,
  loadRecovery,
  loadAvatarUri,
  saveAvatarUri,
  loadLanguage,
  saveLanguage,
  loadRecordView,
  saveRecordView,
} from "./src/storage";
import { importBackup } from "./src/backup";
import EntryEditor, { newEntry } from "./src/EntryEditor";
import GrowthChart, { Metric } from "./src/GrowthChart";
import Records from "./src/Records";
import AppVersion from "./src/AppVersion";
import type { RecordView } from "./src/recordCalendar";
import Settings from "./src/Settings";
import PrivacySupport from "./src/PrivacySupport";
import FeedStopButton from "./src/FeedStopButton";
import FinishFeedDialog from "./src/FinishFeedDialog";
import { finishFeed } from "./src/feedFinish";
import CareIcon from "./src/CareIcon";
import PlayLearning from "./src/PlayLearning";
import { rescheduleAutoFeedReminders } from "./src/reminders";
import {
  Theme,
  light,
  dark,
  T,
  Card,
  Button,
  Chips,
  Field,
  row,
  heading,
} from "./src/ui";
import {
  formatDate,
  formatTime,
  age,
  elapsed,
  I18nProvider,
  type LanguagePreference,
  resolveLocale,
  setActiveLocale,
  t,
} from "./src/i18n";
const kinds: Record<
  Entry["type"],
  { label: string; icon: string; color: string }
> = {
  feed: { label: "喂奶", icon: "◒", color: "#FBE0D3" },
  diaper: { label: "尿布", icon: "♧", color: "#FFF0C9" },
  sleep: { label: "睡眠", icon: "☾", color: "#E5DDF7" },
  growth: { label: "测量", icon: "↗", color: "#D8EEE8" },
  milestone: { label: "里程碑", icon: "✧", color: "#F0D7B5" },
};
const feedLabels = {
  formula: "配方奶",
  expressed: "瓶喂母乳",
  "breast-left": "亲喂 · 左侧",
  "breast-right": "亲喂 · 右侧",
  "breast-both": "亲喂 · 双侧",
};
const diaperLabels = { wet: "尿", dirty: "便", mixed: "尿＋便" };
const time = (iso: string) => formatTime(iso);
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function detail(e: Entry, now: number) {
  if (e.type === "feed")
    return [
      t(feedLabels[e.feedKind!]),
      e.amount !== undefined ? `${e.amount} mL` : null,
      e.end ? elapsed(Date.parse(e.end) - Date.parse(e.start)) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  if (e.type === "diaper") return t(diaperLabels[e.diaperKind!]);
  if (e.type === "sleep")
    return e.end
      ? `${time(e.start)}–${time(e.end)} · ${elapsed(Date.parse(e.end) - Date.parse(e.start))}`
      : t("正在睡 · {duration}", {
          duration: elapsed(now - Date.parse(e.start)),
        });
  if (e.type === "growth")
    return [
      e.weight !== undefined ? `${e.weight} kg` : null,
      e.length !== undefined ? t("身长 {value} cm", { value: e.length }) : null,
      e.head !== undefined ? t("头围 {value} cm", { value: e.head }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return e.title!;
}
export default function App() {
  const [language, setLanguage] = useState<LanguagePreference>("system");
  useEffect(() => {
    void loadLanguage().then((saved) => {
      if (saved) setLanguage(saved);
    });
  }, []);
  const locale = resolveLocale(language);
  return (
    <SafeAreaProvider>
      <I18nProvider locale={locale}>
        <BabyApp
          language={language}
          onLanguageChange={async (next) => {
            setActiveLocale(resolveLocale(next));
            await saveLanguage(next);
            setLanguage(next);
          }}
        />
      </I18nProvider>
    </SafeAreaProvider>
  );
}
function BabyApp({
  language,
  onLanguageChange,
}: {
  language: LanguagePreference;
  onLanguageChange: (language: LanguagePreference) => Promise<void>;
}) {
  const compactTitle = useWindowDimensions().width < 360;
  const systemTheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<boolean | null>(null);
  const [recordView, setRecordView] = useState<RecordView>("bars");
  const darkMode = themePreference ?? systemTheme === "dark";
  const c = darkMode ? dark : light;
  const [state, setState] = useState<State | null>(null),
    [avatarUri, setAvatarUri] = useState<string | null>(null),
    [avatarFailed, setAvatarFailed] = useState(false),
    [fatal, setFatal] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("today"),
    [settingsPage, setSettingsPage] = useState<"main" | "privacy">("main"),
    [now, setNow] = useState(Date.now()),
    [editor, setEditor] = useState<Entry | null>(null),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<Entry | null>(null);
  const stateRef = useRef<State | null>(null),
    lock = useRef(false);
  const [rescue, setRescue] = useState<State | null>(null);
  const [metric, setMetric] = useState<Metric>("weight");
  const [growthHistoryExpanded, setGrowthHistoryExpanded] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const mainScroll = useRef<ScrollView>(null);
  const [finishingFeed, setFinishingFeed] = useState<{
    entry: Entry;
    stoppedAt: string;
  } | null>(null);
  function showProfile() {
    setOpenProfile(true);
    setSettingsPage("main");
    setMessage("");
    setTab("settings");
    mainScroll.current?.scrollTo({ y: 0, animated: false });
  }
  async function changeLanguage(next: LanguagePreference) {
    await onLanguageChange(next);
    if (stateRef.current) {
      try {
        await rescheduleAutoFeedReminders(stateRef.current.entries);
      } catch {
        // The language preference should still save if notification refresh fails.
      }
    }
  }
  async function init() {
    try {
      const [s, preference, savedAvatarUri, savedRecordView] =
        await Promise.all([
          loadState(),
          loadTheme(),
          loadAvatarUri(),
          loadRecordView(),
        ]);
      stateRef.current = s;
      setState(s);
      setAvatarUri(savedAvatarUri);
      setFatal("");
      setThemePreference(preference);
      setRecordView(savedRecordView);
    } catch (e) {
      setFatal(
        `${t("无法读取本地数据，原数据没有被覆盖。")} ${(e as Error).message}`,
      );
    }
  }
  useEffect(() => {
    void init();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  useEffect(() => setAvatarFailed(false), [avatarUri]);
  async function commit(next: State, recovery = false) {
    if (lock.current) throw new Error("正在保存，请稍后再试");
    lock.current = true;
    setBusy(true);
    try {
      const checked = validateState(next);
      await saveState(checked, recovery);
      stateRef.current = checked;
      setState(checked);
      try {
        await rescheduleAutoFeedReminders(checked.entries);
      } catch {
        // Saving a record must not fail just because a previously configured notification cannot refresh.
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function upsert(e: Entry) {
    const current = stateRef.current!;
    if (
      current.profile.birthDate &&
      localDay(new Date(e.start)) < current.profile.birthDate
    )
      throw new Error("记录日期不能早于出生日期");
    await commit({
      ...current,
      entries: [...current.entries.filter((x) => x.id !== e.id), e],
    });
    setEditor(null);
    setMessage("已保存到本机");
  }
  async function updateAvatar(uri: string | null) {
    await saveAvatarUri(uri);
    setAvatarUri(uri);
  }
  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  if (!state)
    return (
      <Theme.Provider value={c}>
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: c.bg,
            padding: 24,
            justifyContent: "center",
            gap: 20,
          }}
        >
          {fatal ? (
            <>
              <T>{fatal}</T>
              <Button label="重新读取" onPress={() => void init()} />
              <Button
                label="从备份文件恢复"
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    setRescue(await importBackup());
                  })
                }
              />
              <Button
                label="读取恢复副本"
                disabled={busy}
                secondary
                onPress={() =>
                  void act(async () => {
                    const old = await loadRecovery();
                    if (!old) throw new Error("没有恢复副本");
                    setRescue(old);
                  })
                }
              />
              {message ? <T>{t(message)}</T> : null}
              {rescue ? (
                <Card>
                  <T>
                    {t("用「{name}」的 {count} 条记录替换当前数据？", {
                      name: rescue.profile.name,
                      count:
                        rescue.entries.length +
                        (rescue.careRecords?.length ?? 0),
                    })}
                  </T>
                  <Button
                    label="确认恢复"
                    disabled={busy}
                    onPress={() =>
                      void act(async () => {
                        await commit(rescue, true);
                        setRescue(null);
                        setFatal("");
                      })
                    }
                  />
                  <Button
                    label="取消"
                    secondary
                    onPress={() => setRescue(null)}
                  />
                </Card>
              ) : null}
            </>
          ) : (
            <>
              <ActivityIndicator color={c.primary} />
              <T style={{ textAlign: "center" }}>打开成长记录…</T>
            </>
          )}
        </SafeAreaView>
      </Theme.Provider>
    );
  const entries = [...state.entries].sort(
    (a, b) => Date.parse(b.start) - Date.parse(a.start),
  );
  const growthEntries = entries.filter((entry) => entry.type === "growth");
  const recentGrowthEntries = growthEntries.slice(0, 5);
  const olderGrowthEntries = growthEntries.slice(5);
  const growthHistoryLabel = growthHistoryExpanded
    ? t("收起历史记录")
    : t("显示 {count} 条历史记录", { count: olderGrowthEntries.length });
  const active = entries.find((e) => e.type === "sleep" && !e.end);
  const activeFeed = entries.find((e) => e.type === "feed" && e.feedRunning);
  const feedSeconds = activeFeed
    ? Math.floor(Math.max(0, now - Date.parse(activeFeed.start)) / 1000)
    : 0;
  const feedTimer = `${String(Math.floor(feedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(feedSeconds / 60) % 60).padStart(2, "0")}:${String(feedSeconds % 60).padStart(2, "0")}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const forStats = entries.map((e) =>
    e.type === "sleep" && !e.end
      ? { ...e, end: new Date(now).toISOString() }
      : e,
  );
  const summary = summarize(forStats, today, tomorrow);
  const latestFeed = entries.find((e) => e.type === "feed"),
    latestDiaper = entries.find((e) => e.type === "diaper"),
    latestSleep = entries
      .filter((e) => e.type === "sleep" && e.end)
      .sort((a, b) => Date.parse(b.end!) - Date.parse(a.end!))[0];
  const pageTitles: Record<string, string> = {
    today: "今天的小日子",
    records: "每一天，都记得",
    growth: "慢慢长大的你",
    play: "照护",
    settings: "我的",
  };
  function entryRow(e: Entry) {
    return (
      <View
        key={e.id}
        style={{
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderColor: c.line,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <View
            style={{
              backgroundColor: kinds[e.type].color,
              borderRadius: 12,
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {e.type === "feed" || e.type === "sleep" || e.type === "diaper" ? (
              <CareIcon kind={e.type} size={22} color="#3A5267" />
            ) : (
              <T style={{ color: "#3A5267", fontSize: 20, lineHeight: 26 }}>
                {kinds[e.type].icon}
              </T>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <T
              numberOfLines={1}
              style={{ fontSize: 13, lineHeight: 19, fontWeight: "600" }}
            >
              {detail(e, now)}
            </T>
            <T style={{ fontSize: 11, lineHeight: 16, color: c.muted }}>
              {localDay(new Date(e.start))} · {time(e.start)}
            </T>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("编辑{kind}", {
                kind: t(kinds[e.type].label),
              })}
              onPress={() => setEditor(e)}
              style={{
                minHeight: 36,
                justifyContent: "center",
                paddingHorizontal: 3,
              }}
            >
              <T style={{ color: c.primary, fontSize: 12 }}>编辑</T>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("删除{kind}", {
                kind: t(kinds[e.type].label),
              })}
              onPress={() => setDeleting(e)}
              style={{
                minHeight: 36,
                justifyContent: "center",
                paddingHorizontal: 3,
              }}
            >
              <T style={{ fontSize: 11, color: c.muted }}>删除</T>
            </Pressable>
          </View>
        </View>
        {e.note ? (
          <T
            numberOfLines={1}
            style={{
              color: c.muted,
              fontSize: 11,
              lineHeight: 16,
              paddingLeft: 45,
            }}
          >
            {e.note}
          </T>
        ) : null}
      </View>
    );
  }
  return (
    <Theme.Provider value={c}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.bg }}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={darkMode ? "light" : "dark"} />
        <View
          style={{ flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" }}
        >
          <ScrollView
            ref={mainScroll}
            contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 28 }}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <View>
                <T
                  style={{
                    fontSize: 11,
                    letterSpacing: 3,
                    color: c.muted,
                    fontWeight: "700",
                  }}
                >
                  MY LITTLE DAYS · 小日子
                </T>
                {tab !== "settings" ? (
                  <T
                    accessibilityRole="header"
                    style={[
                      heading,
                      {
                        marginTop: 6,
                        fontSize: compactTitle ? 24 : 28,
                        lineHeight: compactTitle ? 31 : 36,
                        flexShrink: 1,
                      },
                    ]}
                  >
                    {tab === "today"
                      ? t("{name}的小日子", { name: state.profile.name })
                      : pageTitles[tab]}
                  </T>
                ) : null}
              </View>
            </View>
            {message ? (
              <Pressable
                onPress={() => setMessage("")}
                accessibilityLabel={t("关闭提示")}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: c.soft,
                }}
              >
                <T style={{ fontSize: 13 }}>{t(message)}　×</T>
              </Pressable>
            ) : null}
            {deleting ? (
              <Modal
                transparent
                animationType="fade"
                visible
                onRequestClose={() => {
                  if (!busy) setDeleting(null);
                }}
              >
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    padding: 24,
                    backgroundColor: "rgba(0,0,0,0.45)",
                  }}
                >
                  <View
                    accessibilityViewIsModal
                    style={{
                      width: "100%",
                      maxWidth: 420,
                      alignSelf: "center",
                    }}
                  >
                    <Card>
                      <T>
                        {t("删除这条{kind}记录？", {
                          kind: t(kinds[deleting.type].label),
                        })}
                      </T>
                      <View style={row}>
                        <Button
                          label="取消"
                          secondary
                          disabled={busy}
                          onPress={() => setDeleting(null)}
                        />
                        <Button
                          label="确认删除"
                          disabled={busy}
                          onPress={() =>
                            void act(async () => {
                              const e = deleting;
                              await commit({
                                ...stateRef.current!,
                                entries: stateRef.current!.entries.filter(
                                  (x) => x.id !== e.id,
                                ),
                              });
                              setDeleting(null);
                            })
                          }
                        />
                      </View>
                    </Card>
                  </View>
                </View>
              </Modal>
            ) : null}
            {tab === "today" ? (
              <>
                <View
                  style={{
                    backgroundColor: c.hero,
                    borderRadius: 28,
                    paddingHorizontal: 24,
                    paddingVertical: 20,
                    gap: 14,
                    overflow: "hidden",
                  }}
                >
                  <View style={row}>
                    <View style={{ flex: 1 }}>
                      <T
                        style={{
                          color: c.heroMuted,
                          fontSize: 12,
                          lineHeight: 18,
                        }}
                      >
                        一点一滴，都是成长
                      </T>
                      <Pressable onPress={showProfile}>
                        <T
                          style={{
                            color: c.heroMuted,
                            fontSize: 13,
                            lineHeight: 20,
                            marginTop: 5,
                          }}
                        >
                          {age(state.profile.birthDate, new Date(now))}　›
                        </T>
                      </Pressable>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("打开宝宝档案")}
                      onPress={showProfile}
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        backgroundColor: c.avatar,
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {avatarUri && !avatarFailed ? (
                        <Image
                          accessibilityLabel={t("宝宝头像")}
                          onError={() => setAvatarFailed(true)}
                          resizeMode="cover"
                          source={{ uri: avatarUri }}
                          style={{ width: 64, height: 64, borderRadius: 32 }}
                        />
                      ) : (
                        <T
                          style={{
                            fontSize: 34,
                            lineHeight: 42,
                            color: c.heroText,
                          }}
                        >
                          ☘
                        </T>
                      )}
                    </Pressable>
                  </View>
                  <View style={{ height: 1, backgroundColor: c.heroLine }} />
                  <View style={row}>
                    {[
                      [
                        summary.feedCount ? String(summary.feedMl) : "—",
                        "mL 已记录奶量",
                      ],
                      [
                        summary.sleepMinutes
                          ? (summary.sleepMinutes / 60).toFixed(1)
                          : "—",
                        "小时 已记录睡眠",
                      ],
                      [
                        summary.diaperCount ? String(summary.diaperCount) : "—",
                        "次 换尿布",
                      ],
                    ].map(([v, l]) => (
                      <View key={l}>
                        <T
                          style={{
                            color: c.heroText,
                            fontSize: 25,
                            fontWeight: "600",
                            lineHeight: 32,
                          }}
                        >
                          {v}
                        </T>
                        <T style={{ color: c.heroMuted, fontSize: 10 }}>{l}</T>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={row}>
                  <T style={heading}>照顾此刻</T>
                  <T style={{ fontSize: 12, color: c.muted }}>
                    {formatDate(now, {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    })}
                  </T>
                </View>
                {(["feed", "sleep", "diaper"] as const).map((type) => {
                  const last =
                    type === "feed"
                      ? latestFeed
                      : type === "diaper"
                        ? latestDiaper
                        : latestSleep;
                  return (
                    <Card key={type} style={{ padding: 18 }}>
                      <View style={row}>
                        <View
                          style={{
                            backgroundColor: kinds[type].color,
                            width: 45,
                            height: 45,
                            borderRadius: 15,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <CareIcon kind={type} color="#3A5267" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <T style={{ fontWeight: "700", fontSize: 17 }}>
                            {type === "feed" && activeFeed
                              ? "正在喂养"
                              : type === "sleep" && active
                                ? "正在睡觉"
                                : kinds[type].label}
                          </T>
                          <T style={{ fontSize: 12, color: c.muted }}>
                            {type === "feed" && activeFeed
                              ? feedTimer
                              : type === "sleep" && active
                                ? t("已睡 {duration}", {
                                    duration: elapsed(
                                      now - Date.parse(active.start),
                                    ),
                                  })
                                : last
                                  ? t("上次 {time} · {duration}前", {
                                      time: time(
                                        type === "sleep"
                                          ? last.end!
                                          : last.start,
                                      ),
                                      duration: elapsed(
                                        now -
                                          Date.parse(
                                            type === "sleep"
                                              ? last.end!
                                              : last.start,
                                          ),
                                      ),
                                    })
                                  : "还没有记录，轻点开始"}
                          </T>
                        </View>
                        {type === "feed" && activeFeed ? (
                          <FeedStopButton
                            disabled={busy}
                            onPress={() =>
                              setFinishingFeed({
                                entry: activeFeed,
                                stoppedAt: new Date(
                                  Math.max(
                                    Date.now(),
                                    Date.parse(activeFeed.start),
                                  ),
                                ).toISOString(),
                              })
                            }
                          />
                        ) : (
                          <Button
                            label={
                              type === "sleep"
                                ? active
                                  ? "醒了"
                                  : "睡了"
                                : "＋记录"
                            }
                            disabled={busy}
                            secondary
                            onPress={() => {
                              if (type === "sleep")
                                void act(async () => {
                                  await upsert(
                                    active
                                      ? {
                                          ...active,
                                          end: new Date().toISOString(),
                                        }
                                      : newEntry("sleep"),
                                  );
                                });
                              else setEditor(newEntry(type));
                            }}
                          />
                        )}
                      </View>
                      {type === "feed" && latestFeed ? (
                        <T style={{ color: c.muted, fontSize: 13 }}>
                          {detail(activeFeed ?? latestFeed, now)}
                        </T>
                      ) : null}
                      {type === "sleep" ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setEditor(newEntry("sleep"))}
                          style={{
                            alignSelf: "flex-start",
                            minHeight: 36,
                            justifyContent: "center",
                          }}
                        >
                          <T style={{ fontSize: 12, color: c.primary }}>
                            补录睡眠 ›
                          </T>
                        </Pressable>
                      ) : null}
                    </Card>
                  );
                })}
              </>
            ) : null}
            {tab === "records" ? (
              <Records
                defaultView={recordView}
                entries={entries}
                now={now}
                onEdit={setEditor}
                onDelete={setDeleting}
              />
            ) : null}
            {tab === "growth" ? (
              <>
                <Card>
                  <View style={row}>
                    <T style={heading}>成长曲线</T>
                    <Button
                      label="＋测量"
                      secondary
                      onPress={() => setEditor(newEntry("growth"))}
                    />
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {[
                      { value: "all" as const, icon: "≋", label: "全部" },
                      { value: "weight" as const, icon: "⚖", label: "体重" },
                      { value: "length" as const, icon: "↕", label: "身长" },
                      { value: "head" as const, icon: "◯", label: "头围" },
                    ].map(({ value, icon, label }) => {
                      const selected = metric === value;
                      const accent =
                        value === "length"
                          ? darkMode
                            ? "#F2AF94"
                            : "#C97962"
                          : value === "head"
                            ? darkMode
                              ? "#C7B7FF"
                              : "#7565A5"
                            : c.primary;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(label)}
                          accessibilityState={{ selected }}
                          key={value}
                          onPress={() => setMetric(value)}
                          style={({ pressed }) => [
                            {
                              flex: 1,
                              minWidth: 0,
                              minHeight: 64,
                              borderRadius: 15,
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 2,
                              backgroundColor: selected ? c.soft : c.card,
                              borderWidth: 1,
                              borderColor: selected ? accent : c.line,
                              opacity: pressed ? 0.72 : 1,
                            },
                          ]}
                        >
                          <T
                            raw
                            style={{
                              color: selected ? accent : c.muted,
                              fontSize: 19,
                              lineHeight: 23,
                              fontWeight: icon === "⚖" ? "500" : "700",
                            }}
                          >
                            {icon}
                          </T>
                          <T
                            style={{
                              color: selected ? accent : c.muted,
                              fontSize: 10,
                              lineHeight: 14,
                              fontWeight: selected ? "700" : "500",
                            }}
                            numberOfLines={1}
                          >
                            {label}
                          </T>
                        </Pressable>
                      );
                    })}
                  </View>
                  <GrowthChart
                    entries={entries}
                    profile={state.profile}
                    metric={metric}
                  />
                  {recentGrowthEntries.map(entryRow)}
                  {olderGrowthEntries.length ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={growthHistoryLabel}
                        accessibilityState={{ expanded: growthHistoryExpanded }}
                        onPress={() =>
                          setGrowthHistoryExpanded((expanded) => !expanded)
                        }
                        style={({ pressed }) => ({
                          minHeight: 48,
                          marginTop: 2,
                          paddingHorizontal: 14,
                          borderRadius: 14,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          backgroundColor: c.soft,
                          opacity: pressed ? 0.72 : 1,
                        })}
                      >
                        <T style={{ color: c.primary, fontWeight: "700" }}>
                          {growthHistoryLabel}
                        </T>
                        <T raw style={{ color: c.primary, fontSize: 18 }}>
                          {growthHistoryExpanded ? "⌃" : "⌄"}
                        </T>
                      </Pressable>
                      {growthHistoryExpanded
                        ? olderGrowthEntries.map(entryRow)
                        : null}
                    </>
                  ) : null}
                </Card>
              </>
            ) : null}
            {tab === "play" ? (
              <PlayLearning
                birthDate={state.profile.birthDate}
                now={now}
                careRecords={state.careRecords ?? []}
                onSaveCare={async (record) => {
                  const current = stateRef.current!;
                  await commit({
                    ...current,
                    careRecords: [
                      ...(current.careRecords ?? []).filter(
                        (r) => r.id !== record.id,
                      ),
                      record,
                    ],
                  });
                }}
                onDeleteCare={async (id) => {
                  const current = stateRef.current!;
                  await commit({
                    ...current,
                    careRecords: (current.careRecords ?? []).filter(
                      (r) => r.id !== id,
                    ),
                  });
                }}
              />
            ) : null}
            {tab === "settings" ? (
              settingsPage === "privacy" ? (
                <PrivacySupport onBack={() => setSettingsPage("main")} />
              ) : (
                <Settings
                  initialProfileExpanded={openProfile}
                  state={state}
                  avatarUri={avatarUri}
                  onAvatarChange={updateAvatar}
                  onCommit={async (next, recovery) => {
                    await commit(next, recovery);
                  }}
                  themePreference={themePreference}
                  recordView={recordView}
                  onRecordViewChange={async (value) => {
                    await saveRecordView(value);
                    setRecordView(value);
                  }}
                  language={language}
                  onLanguageChange={changeLanguage}
                  onOpenPrivacy={() => setSettingsPage("privacy")}
                  onDarkMode={async (v) => {
                    const previous = themePreference;
                    setThemePreference(v);
                    try {
                      await saveTheme(v);
                    } catch (error) {
                      setThemePreference(previous);
                      throw error;
                    }
                  }}
                />
              )
            ) : null}
            {!(tab === "settings" && settingsPage === "privacy") ? (
              <T
                style={{
                  fontSize: 10,
                  color: c.muted,
                  textAlign: "center",
                  letterSpacing: 1,
                }}
              >
                陪伴成长 · 不必完美记录
              </T>
            ) : null}
            <AppVersion />
          </ScrollView>
          <SafeAreaView
            edges={["bottom"]}
            style={{
              backgroundColor: c.card,
              borderTopWidth: 1,
              borderColor: c.line,
            }}
          >
            <View style={{ flexDirection: "row", paddingVertical: 7 }}>
              {[
                ["today", "⌂", "今天"],
                ["records", "≡", "记录"],
                ["growth", "↗", "成长"],
                ["play", "♡", "照护"],
                ["settings", "☷", "我的"],
              ].map(([key, icon, label]) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === key }}
                  accessibilityLabel={t(label)}
                  key={key}
                  onPress={() => {
                    setOpenProfile(false);
                    setTab(key);
                    setSettingsPage("main");
                    setMessage("");
                    setDeleting(null);
                  }}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    gap: 1,
                    minHeight: 49,
                    justifyContent: "center",
                  }}
                >
                  <T
                    style={{
                      fontSize: 23,
                      color: tab === key ? c.primary : c.muted,
                      fontWeight: "600",
                    }}
                  >
                    {icon}
                  </T>
                  <T
                    style={{
                      fontSize: 11,
                      color: tab === key ? c.primary : c.muted,
                      fontWeight: tab === key ? "700" : "400",
                    }}
                  >
                    {label}
                  </T>
                </Pressable>
              ))}
            </View>
          </SafeAreaView>
        </View>
        {finishingFeed ? (
          <FinishFeedDialog
            entry={finishingFeed.entry}
            stoppedAt={finishingFeed.stoppedAt}
            onCancel={() => setFinishingFeed(null)}
            onSave={async (amount) => {
              const current = stateRef.current?.entries.find(
                (e) => e.id === finishingFeed.entry.id,
              );
              if (!current) throw new Error("喂养计时状态无效");
              await upsert(
                finishFeed(current, finishingFeed.stoppedAt, amount),
              );
              setFinishingFeed(null);
            }}
          />
        ) : null}
        {editor ? (
          <EntryEditor
            entry={editor}
            birthDate={state.profile.birthDate}
            onSave={upsert}
            onClose={() => setEditor(null)}
            dark={darkMode}
          />
        ) : null}
      </SafeAreaView>
    </Theme.Provider>
  );
}
