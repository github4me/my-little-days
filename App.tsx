import React, { useEffect, useRef, useState } from "react";
import { watchSleepRanges } from "./src/watchSummary";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Appearance,
  AppState,
  Image,
  Keyboard,
  Platform,
  useWindowDimensions,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Modal from "./src/AccessibleModal";
import RecordActionButton from "./src/RecordActionButton";
import {
  AccessibilityPreferencesProvider,
  useAccessibilityPreferences,
} from "./src/accessibilityPreferences";
import { selectPalette } from "./src/palette";
import {
  AppTabBar,
  appTabs,
  type AppTab,
  useNavigationAnnouncement,
} from "./src/AppNavigation";
import {
  Entry,
  State,
  initialState,
  summarize,
  validateState,
} from "./src/domain";
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
  setPersonalStorageBlocked,
  loadWatchWorkspace,
  savePersonalWatchCommand,
} from "./src/storage";
import { importBackup } from "./src/backup";
import EntryEditor, { newEntry } from "./src/EntryEditor";
import GrowthChart, { Metric } from "./src/GrowthChart";
import Records, { RecordsViewToggle } from "./src/Records";
import AppVersion from "./src/AppVersion";
import type { RecordView } from "./src/recordCalendar";
import Settings from "./src/Settings";
import PrivacySupport from "./src/PrivacySupport";
import FamilyScreen from "./src/family/FamilyScreen";
import FamilyScreenView from "./src/family/FamilyScreenView";
import { FamilySyncBanner } from "./src/family/FamilySyncStatus";
import { useFamilyPilot } from "./src/family/useFamilyPilot";
import { useFamilyPush } from "./src/family/useFamilyPush";
import FamilyPushSettings from "./src/family/FamilyPushSettings";
import { useWatchCompanion } from "./src/useWatchCompanion";
import { useWidgetHomeLink } from "./src/useWidgetHomeLink";
import { summarizeToday } from "./src/todaySummary";
import { watchBridgeAvailable } from "./src/watchBridge";
import type { WatchContext } from "./src/watchProtocol";
import { familyErrorMessage } from "./src/family/messages";
import SharedReminders from "./src/family/SharedReminders";
import type { FamilyExtraRecord } from "./src/family/extras";
import { readSelectedAvatarDataUrl } from "./src/avatar";
import { randomUUID } from "expo-crypto";
import FamilyDemoScreen from "./src/family/FamilyDemoScreen";
import { familyDemoEnabled } from "./src/family/demoConfig";
import FeedStopButton from "./src/FeedStopButton";
import FinishFeedDialog from "./src/FinishFeedDialog";
import { finishFeed } from "./src/feedFinish";
import { finishLiveSleep } from "./src/sleepTimer";
import CareIcon from "./src/CareIcon";
import PlayLearning from "./src/PlayLearning";
import { rescheduleAutoFeedReminders } from "./src/reminders";
import { Theme, T, Card, Button, Chips, Field, row, heading } from "./src/ui";
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
function sleepTime(iso: string, now: number) {
  const date = new Date(iso);
  const today = new Date(now);
  if (localDay(date) === localDay(today)) return time(iso);
  return `${formatDate(date, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear()
      ? { year: "numeric" as const }
      : {}),
  })} ${time(iso)}`;
}
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
    <AccessibilityPreferencesProvider>
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
    </AccessibilityPreferencesProvider>
  );
}
function BabyApp({
  language,
  onLanguageChange,
}: {
  language: LanguagePreference;
  onLanguageChange: (language: LanguagePreference) => Promise<void>;
}) {
  const { width, fontScale } = useWindowDimensions();
  const compactTitle = width < 360;
  const largeType = fontScale >= 1.35;
  const { highContrast } = useAccessibilityPreferences();
  const systemTheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<boolean | null>(null);
  const [recordView, setRecordView] = useState<RecordView>("bars");
  const [activeRecordView, setActiveRecordView] = useState<RecordView>("bars");
  const darkMode = themePreference ?? systemTheme === "dark";
  const c = selectPalette(darkMode, highContrast);
  useEffect(() => {
    if (Platform.OS === "web") return;
    Appearance.setColorScheme(
      themePreference === null
        ? "unspecified"
        : themePreference
          ? "dark"
          : "light",
    );
    return () => Appearance.setColorScheme("unspecified");
  }, [themePreference]);
  const [offlineState, setState] = useState<State | null>(null),
    [privateAvatarUri, setAvatarUri] = useState<string | null>(null),
    [avatarFailed, setAvatarFailed] = useState(false),
    [fatal, setFatal] = useState(""),
    [message, setMessage] = useState(""),
    [sleepNotice, setSleepNotice] = useState(""),
    [tab, setTab] = useState<AppTab>("today"),
    [settingsPage, setSettingsPage] = useState<
      "main" | "privacy" | "family" | "family-demo"
    >("main"),
    [now, setNow] = useState(Date.now()),
    [editor, setEditor] = useState<Entry | null>(null),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<Entry | null>(null);
  const stateRef = useRef<State | null>(null),
    lock = useRef(false);
  const privateDataGeneration = useRef(0);
  useEffect(() => {
    if (!sleepNotice) return;
    const timer = setTimeout(() => setSleepNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [sleepNotice]);
  const family = useFamilyPilot();
  const familyPush = useFamilyPush(family, () => setTab("records"));
  useWidgetHomeLink(() => {
    Keyboard.dismiss();
    setTab("today");
    setSettingsPage("main");
    setOpenProfile(false);
    mainScroll.current?.scrollTo({ y: 0, animated: false });
    // Keep record-editor/finish-feed sheets and their unsaved drafts intact.
  });
  const sharingRef = useRef(family.sharedMode || family.booting);
  sharingRef.current = family.sharedMode || family.booting;
  setPersonalStorageBlocked(family.booting || family.sharedMode);
  const state = family.sharedMode ? family.sharedState : offlineState;
  const sharedAvatar = family.sharedExtras.find(
    (r) => r.record.kind === "avatar",
  )?.record;
  const avatarUri = family.sharedMode
    ? sharedAvatar?.kind === "avatar"
      ? sharedAvatar.dataUrl
      : null
    : privateAvatarUri;
  stateRef.current = state;
  const familyContext = family.fullSnapshot
    ? `${family.user?.id}|${family.fullSnapshot.family.id}|${family.fullSnapshot.family.membershipId}|${family.fullSnapshot.historyId}`
    : family.sharedMode
      ? "family-unavailable"
      : "private";
  const activeFamilyContext = useRef(familyContext);
  activeFamilyContext.current = familyContext;
  const extrasAvailable = family.fullSnapshot?.extrasSchemaVersion === 1;
  const extraVersionFor = (id: string) =>
    family.fullSnapshot?.extraRecords?.find((r) => r.record.id === id)?.version;
  const sharedSelection = family.sharedExtras.find(
    (r) => r.record.kind === "play-selection",
  )?.record;
  const checkinsFor = (id: string) =>
    family.sharedExtras.filter(
      (r) =>
        r.record.kind === "play-checkin" &&
        r.record.day === localDay(new Date(now)) &&
        r.record.activityId === id,
    );
  const canToggleCheckin = (id: string) =>
    !!extrasAvailable &&
    checkinsFor(id).every((r) => family.canEditRecord("extra", r.record.id));
  async function saveExtra(record: FamilyExtraRecord, baseVersion?: string) {
    if (activeFamilyContext.current !== familyContext)
      throw new Error("membership_changed");
    if (!extrasAvailable) throw new Error("extras_sharing_unavailable");
    if (!family.canEditRecord("extra", record.id))
      throw new Error("record_forbidden");
    await family.saveRecord("extra", record, baseVersion);
  }
  async function deleteExtra(id: string, version: string) {
    if (activeFamilyContext.current !== familyContext)
      throw new Error("membership_changed");
    await family.deleteRecord("extra", id, version);
  }
  const editVersion = useRef<{
    id: string;
    version?: string;
    context: string;
  } | null>(null);
  const deleteVersion = useRef<string | undefined>(undefined);
  const versionFor = (id: string) =>
    family.fullSnapshot?.entries.find((r) => r.entry.id === id)?.version;
  const familyMemberName = (id?: string | null) =>
    family.fullSnapshot?.members.find((member) => member.id === id)
      ?.displayName ??
    (resolveLocale(language) === "zh-CN"
      ? "曾加入的家庭成员"
      : "Former family member");
  const authorLabel = (id: string) => {
    const record = family.fullSnapshot?.entries.find((r) => r.entry.id === id);
    const locale = resolveLocale(language);
    if (!record) {
      const pendingStart = family.recordPending.find(
        (item) =>
          item.operation.recordId === id &&
          item.operation.kind === "create" &&
          !!item.operation.entry,
      );
      const pendingEntry = pendingStart?.operation.entry;
      if (pendingEntry && family.user) {
        const starter =
          family.user.displayName || familyMemberName(family.user.id);
        const stoppedAt =
          pendingStart.sleepFollowUp?.stoppedAt ??
          pendingStart.feedFollowUp?.stoppedAt;
        if (stoppedAt)
          return locale === "zh-CN"
            ? `记录人：${starter} · ${time(stoppedAt)} 结束（等待同步）`
            : `Recorded by ${starter} · Ended at ${time(stoppedAt)} (waiting to sync)`;
        return locale === "zh-CN"
          ? `${starter} 于 ${time(pendingEntry.start)} 开始 · 仍在进行（等待同步）`
          : `Started by ${starter} at ${time(pendingEntry.start)} · Ongoing (waiting to sync)`;
      }
      return locale === "zh-CN"
        ? "记录人：家庭成员"
        : "Recorded by a family member";
    }
    const starter = familyMemberName(record.recordedBy);
    const pendingCompletion = family.recordPending.find(
      (item) =>
        item.operation.recordId === id &&
        !!item.timerCompletion &&
        !!item.operation.entry?.end,
    );
    const pendingEnderId = family.user?.id;
    if (pendingCompletion?.operation.entry?.end && pendingEnderId) {
      const endedAt = time(pendingCompletion.operation.entry.end);
      if (pendingEnderId !== record.recordedBy) {
        const ender =
          family.user?.displayName ?? familyMemberName(pendingEnderId);
        return locale === "zh-CN"
          ? `开始：${starter} · ${time(record.entry.start)}　结束：${ender} · ${endedAt}（等待同步）`
          : `Started by ${starter} · ${time(record.entry.start)} · Ended by ${ender} · ${endedAt} (waiting to sync)`;
      }
      return locale === "zh-CN"
        ? `记录人：${starter} · ${endedAt} 结束（等待同步）`
        : `Recorded by ${starter} · Ended at ${endedAt} (waiting to sync)`;
    }
    const isRunning =
      (record.entry.type === "sleep" && !record.entry.end) ||
      (record.entry.type === "feed" &&
        !!record.entry.feedRunning &&
        !record.entry.end);
    if (isRunning)
      return locale === "zh-CN"
        ? `${starter} 于 ${time(record.entry.start)} 开始 · 仍在进行`
        : `Started by ${starter} at ${time(record.entry.start)} · Ongoing`;
    if (
      record.endedBy &&
      record.endedBy !== record.recordedBy &&
      record.entry.end
    ) {
      const ender = familyMemberName(record.endedBy);
      return locale === "zh-CN"
        ? `开始：${starter} · ${time(record.entry.start)}　结束：${ender} · ${time(record.entry.end)}`
        : `Started by ${starter} · ${time(record.entry.start)} · Ended by ${ender} · ${time(record.entry.end)}`;
    }
    return locale === "zh-CN" ? `记录人：${starter}` : `Recorded by ${starter}`;
  };
  function beginEditor(entry: Entry) {
    if (family.sharedMode && !family.canEditRecord("entry", entry.id)) return;
    editVersion.current = {
      id: entry.id,
      version: versionFor(entry.id),
      context: familyContext,
    };
    setEditor(entry);
  }
  function beginDelete(entry: Entry) {
    if (family.sharedMode && !family.canEditRecord("entry", entry.id)) return;
    deleteVersion.current = versionFor(entry.id);
    setDeleting(entry);
  }
  useEffect(() => {
    setEditor(null);
    setDeleting(null);
    setFinishingFeed(null);
    setRescue(null);
    setOpenProfile(false);
    setMessage("");
    setSleepNotice("");
    editVersion.current = null;
  }, [familyContext]);
  useEffect(() => {
    if (family.activationSerial) {
      privateDataGeneration.current++;
      setState(initialState);
      setAvatarUri(null);
      setRescue(null);
    }
  }, [family.activationSerial]);
  const [rescue, setRescue] = useState<State | null>(null);
  const [metric, setMetric] = useState<Metric>("weight");
  const [growthHistoryExpanded, setGrowthHistoryExpanded] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const mainScroll = useRef<ScrollView>(null);
  function openFamilyPage() {
    setTab("settings");
    setSettingsPage(familyDemoEnabled ? "family-demo" : "family");
    mainScroll.current?.scrollTo({ y: 0, animated: false });
  }
  const [finishingFeed, setFinishingFeed] = useState<{
    entry: Entry;
    stoppedAt: string;
    baseVersion?: string;
  } | null>(null);
  const routeKey = tab === "settings" ? `settings/${settingsPage}` : tab;
  const routeTitle = t(
    tab === "settings" && settingsPage !== "main"
      ? settingsPage === "privacy"
        ? "隐私与支持"
        : "家庭共享"
      : appTabs.find((item) => item.key === tab)!.label,
  );
  useNavigationAnnouncement(
    routeKey,
    routeTitle,
    !!editor || !!deleting || !!finishingFeed,
  );
  function showProfile() {
    setOpenProfile(true);
    setSettingsPage("main");
    setMessage("");
    setTab("settings");
    mainScroll.current?.scrollTo({ y: 0, animated: false });
  }
  async function changeLanguage(next: LanguagePreference) {
    await onLanguageChange(next);
    if (stateRef.current && !family.sharedMode) {
      try {
        await rescheduleAutoFeedReminders(stateRef.current.entries);
      } catch {
        // The language preference should still save if notification refresh fails.
      }
    }
  }
  async function init() {
    const generation = privateDataGeneration.current;
    try {
      const [s, preference, savedAvatarUri, savedRecordView] =
        await Promise.all([
          loadState(),
          loadTheme(),
          loadAvatarUri(),
          loadRecordView(),
        ]);
      if (generation !== privateDataGeneration.current) return;
      if (!sharingRef.current) stateRef.current = s;
      setState(s);
      setAvatarUri(savedAvatarUri);
      setFatal("");
      setThemePreference(preference);
      setRecordView(savedRecordView);
    } catch (e) {
      if (generation !== privateDataGeneration.current) return;
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
  async function commit(
    next: State,
    recovery = false,
    profileVersion?: string,
    optimistic = false,
  ) {
    if (family.sharedMode) {
      if (recovery || !family.sharedState || !family.fullSnapshot)
        throw new Error("refresh_required");
      if (
        JSON.stringify(next.entries) !==
          JSON.stringify(family.sharedState.entries) ||
        JSON.stringify(next.careRecords ?? []) !==
          JSON.stringify(family.sharedState.careRecords ?? [])
      )
        throw new Error("shared_backup_disabled");
      await family.saveFullProfile(
        next.profile,
        profileVersion ?? family.fullSnapshot.family.profileVersion,
      );
      return;
    }
    if (lock.current) throw new Error("正在保存，请稍后再试");
    lock.current = true;
    setBusy(true);
    const previous = stateRef.current;
    const generation = privateDataGeneration.current;
    let optimisticState: State | null = null;
    try {
      const checked = validateState(next);
      if (optimistic) {
        optimisticState = checked;
        stateRef.current = checked;
        setState(checked);
      }
      await saveState(checked, recovery);
      if (generation !== privateDataGeneration.current || sharingRef.current)
        return;
      stateRef.current = checked;
      setState(checked);
      try {
        if (sharingRef.current) return;
        await rescheduleAutoFeedReminders(checked.entries);
      } catch {
        // Saving a record must not fail just because a previously configured notification cannot refresh.
      }
    } catch (error) {
      if (
        optimisticState &&
        stateRef.current === optimisticState &&
        generation === privateDataGeneration.current &&
        !sharingRef.current
      ) {
        stateRef.current = previous;
        setState(previous);
      }
      throw error;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function upsert(
    e: Entry,
    explicitVersion?: string,
    optimistic = false,
  ) {
    const current = stateRef.current!;
    if (
      current.profile.birthDate &&
      localDay(new Date(e.start)) < current.profile.birthDate
    )
      throw new Error("记录日期不能早于出生日期");
    if (family.sharedMode) {
      const draft =
        editVersion.current?.id === e.id ? editVersion.current : null;
      if (draft && draft.context !== familyContext)
        throw new Error("membership_changed");
      const previous = family.fullSnapshot?.entries.find(
        (record) => record.entry.id === e.id,
      )?.entry;
      const startingTimer: "sleep" | "feed" | null =
        e.type === "sleep" &&
        !e.end &&
        (!previous || previous.type !== "sleep" || !!previous.end)
          ? "sleep"
          : e.type === "feed" &&
              !!e.feedRunning &&
              !e.end &&
              (!previous || previous.type !== "feed" || !previous.feedRunning)
            ? "feed"
            : null;
      if (startingTimer) {
        const currentTimer = await family.refreshActiveTimer(startingTimer);
        if (currentTimer.activeId) {
          setEditor(null);
          setMessage(
            startingTimer === "sleep"
              ? "已同步到家庭中正在进行的睡眠，未创建重复计时。"
              : "已同步到家庭中正在进行的喂养，未创建重复计时。",
          );
          return;
        }
      }
      await family.saveRecord(
        "entry",
        e,
        explicitVersion ?? draft?.version ?? versionFor(e.id),
      );
    } else
      await commit(
        {
          ...current,
          entries: [...current.entries.filter((x) => x.id !== e.id), e],
        },
        false,
        undefined,
        optimistic,
      );
    setEditor(null);
    setMessage(family.sharedMode ? "" : "已保存到本机");
  }
  async function toggleSleep(active?: Entry) {
    const context = familyContext;
    const tappedAt = Date.now();
    const stoppedAt = new Date(tappedAt).toISOString();
    setNow(tappedAt);
    setSleepNotice("");
    if (!active) {
      await upsert({ ...newEntry("sleep"), start: stoppedAt }, undefined, true);
      return;
    }
    const finished = finishLiveSleep(active, stoppedAt);
    const sharedRecord = family.fullSnapshot?.entries.find(
      (record) => record.entry.id === active.id,
    );
    const completedByDifferentMember =
      family.sharedMode &&
      !!sharedRecord &&
      sharedRecord.recordedBy !== family.user?.id;
    if (family.sharedMode) await family.finishSleep(active.id, stoppedAt);
    else {
      const current = stateRef.current!;
      await commit(
        {
          ...current,
          entries: [
            ...current.entries.filter((entry) => entry.id !== active.id),
            ...(finished ? [finished] : []),
          ],
        },
        false,
        undefined,
        true,
      );
    }
    if (activeFamilyContext.current !== context) return;
    setMessage("");
    if (!finished && !completedByDifferentMember)
      setSleepNotice(
        "本次睡眠不足 1 分钟，已按误触取消，不计入记录。如需保留，请补录睡眠。",
      );
  }
  useWatchCompanion({
    recordsRevision: family.sharedMode
      ? family.companionRevision
      : state?.entries,
    changeToken: JSON.stringify([
      family.booting,
      family.busy,
      family.sharedMode,
      family.ready,
      family.watchWorkspaceKey,
      family.watchRecordingEnabled,
      family.watchExpiresAt,
      language,
      localDay(new Date(now)),
      state?.profile,
      state?.entries.filter(
        (entry) => entry.feedRunning || (entry.type === "sleep" && !entry.end),
      ),
      state?.entries.length,
      family.watchReceipts,
    ]),
    context: async () => {
      if (!watchBridgeAvailable || family.booting) return null;
      const shared = sharingRef.current;
      const familyState = family.getWatchState();
      const current = familyState.admissionBlocked
        ? null
        : shared
          ? familyState.state
          : stateRef.current;
      const workspaceKey = shared
        ? familyState.workspaceKey
        : await loadWatchWorkspace();
      // Unknown identity is a recovery state, never permission to publish the
      // private workspace or another account's cached records.
      if (!workspaceKey) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const totals = summarize(current?.entries ?? [], today, tomorrow);
      const widgetState = familyState.admissionBlocked
        ? null
        : shared
          ? familyState.readableState
          : stateRef.current;
      const widgetTotals = widgetState
        ? summarizeToday(widgetState.entries, new Date())
        : undefined;
      const context: WatchContext = {
        schemaVersion: 1,
        workspaceKey,
        mode: shared ? "family" : "personal",
        status: current ? "ready" : "unavailable",
        expiresAt: shared
          ? familyState.expiresAt
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        language: resolveLocale(language).startsWith("zh") ? "zh" : "en",
        profile: current
          ? { name: current.profile.name, birthDate: current.profile.birthDate }
          : { name: "", birthDate: "" },
        entries: (current?.entries ?? [])
          .filter(
            (entry) =>
              entry.feedRunning || (entry.type === "sleep" && !entry.end),
          )
          .map((entry) => {
            const server = familyState.snapshot?.entries.find(
              (record) => record.entry.id === entry.id,
            );
            const pending = familyState.pending.find(
              (record) =>
                record.operation.recordId === entry.id &&
                record.status !== "failed",
            );
            return {
              ...entry,
              note: "",
              canControl:
                !shared ||
                (!pending &&
                  !!server &&
                  (familyState.snapshot?.family.role === "owner" ||
                    server.recordedBy === family.user?.id ||
                    familyState.snapshot?.crossMemberTimerCompletionEnabled ===
                      true)) ||
                (!!pending &&
                  familyState.receipts.some(
                    (receipt) =>
                      receipt.commandId === pending.operation.operationId,
                  )),
              ...(shared && server && !pending
                ? { version: server.version }
                : {}),
              ...(shared && pending
                ? { pendingOperationId: pending.operation.operationId }
                : {}),
            };
          }),
        totals: {
          feedMl: totals.feedMl,
          feedCount: totals.feedCount,
          diaperCount: totals.diaperCount,
          sleepMinutes: totals.sleepMinutes,
        },
        totalsDate: localDay(today),
        sleepRanges: watchSleepRanges(current?.entries ?? [], today, tomorrow),
        widgetTotals: widgetTotals && {
          feedMl: widgetTotals.feedMl,
          diaperCount: widgetTotals.diaperCount,
          sleepMinutes: widgetTotals.sleepMinutes,
        },
      };
      return context;
    },
    apply: async (command) => {
      if (sharingRef.current) return family.applyWatchCommand(command);
      if (lock.current) throw new Error("action_busy");
      lock.current = true;
      const generation = privateDataGeneration.current;
      try {
        const result = await savePersonalWatchCommand(command);
        if (
          !sharingRef.current &&
          generation === privateDataGeneration.current
        ) {
          stateRef.current = result.state;
          setState(result.state);
          void rescheduleAutoFeedReminders(result.state.entries).catch(
            () => {},
          );
        }
        return result.receipt;
      } finally {
        lock.current = false;
      }
    },
    receipts: () => family.getWatchState().receipts,
  });
  async function updateAvatar(uri: string | null) {
    if (family.sharedMode) {
      const dataUrl = uri ? await readSelectedAvatarDataUrl(uri) : null;
      await saveExtra(
        { id: "avatar", kind: "avatar", dataUrl },
        extraVersionFor("avatar"),
      );
      return;
    }
    await saveAvatarUri(uri);
    setAvatarUri(uri);
  }
  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setMessage(
        family.sharedMode
          ? familyErrorMessage(resolveLocale(language), (e as Error).message)
          : (e as Error).message,
      );
    }
  }
  if (family.booting || (family.sharedMode && !state))
    return (
      <Theme.Provider value={c}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 16 }}
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
          >
            {family.booting ? (
              <ActivityIndicator />
            ) : (
              <FamilyScreen
                pilot={family}
                source={initialState}
                onBack={() => {}}
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </Theme.Provider>
    );
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
  const owned = (id: string) =>
    family.fullSnapshot?.entries.find((r) => r.entry.id === id)?.recordedBy ===
    family.user?.id;
  const activeCandidates = entries.filter((e) => e.type === "sleep" && !e.end);
  const feedCandidates = entries.filter(
    (e) => e.type === "feed" && e.feedRunning,
  );
  const active =
    activeCandidates.find((e) => owned(e.id)) ?? activeCandidates[0];
  const activeFeed =
    feedCandidates.find((e) => owned(e.id)) ?? feedCandidates[0];
  const feedSeconds = activeFeed
    ? Math.floor(Math.max(0, now - Date.parse(activeFeed.start)) / 1000)
    : 0;
  const feedTimer = `${String(Math.floor(feedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(feedSeconds / 60) % 60).padStart(2, "0")}:${String(feedSeconds % 60).padStart(2, "0")}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const summary = summarizeToday(entries, new Date(now));
  const latestFeed = entries.find((e) => e.type === "feed"),
    latestDiaper = entries.find((e) => e.type === "diaper"),
    latestSleep = entries
      .filter((e) => e.type === "sleep" && e.end)
      .sort((a, b) => Date.parse(b.end!) - Date.parse(a.end!))[0];
  const pageTitles: Record<string, string> = {
    today: "今天的小日子",
    records: "记录",
    growth: "成长",
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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
            flexWrap: largeType ? "wrap" : "nowrap",
          }}
        >
          <View
            style={{
              backgroundColor: c[e.type],
              borderRadius: 12,
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {e.type === "feed" || e.type === "sleep" || e.type === "diaper" ? (
              <CareIcon kind={e.type} size={22} color={c.icon} />
            ) : (
              <T style={{ color: c.icon, fontSize: 20, lineHeight: 26 }}>
                {kinds[e.type].icon}
              </T>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <T style={{ fontSize: 13, lineHeight: 19, fontWeight: "600" }}>
              {detail(e, now)}
            </T>
            <T style={{ fontSize: 11, lineHeight: 16, color: c.muted }}>
              {localDay(new Date(e.start))} · {time(e.start)}
            </T>
            {family.sharedMode ? (
              <T raw style={{ fontSize: 11, color: c.muted }}>
                {authorLabel(e.id)}
              </T>
            ) : null}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              width: largeType ? "100%" : undefined,
              justifyContent: "flex-end",
            }}
          >
            <RecordActionButton
              action="edit"
              accessibilityLabel={t("编辑{kind}", {
                kind: t(kinds[e.type].label),
              })}
              accessibilityHint={t("打开记录编辑界面")}
              disabled={
                family.sharedMode && !family.canEditRecord("entry", e.id)
              }
              onPress={() => beginEditor(e)}
            />
            <RecordActionButton
              action="delete"
              accessibilityLabel={t("删除{kind}", {
                kind: t(kinds[e.type].label),
              })}
              accessibilityHint={t("打开删除确认")}
              disabled={
                family.sharedMode && !family.canEditRecord("entry", e.id)
              }
              onPress={() => beginDelete(e)}
            />
          </View>
        </View>
        {e.note ? (
          <T
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
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={mainScroll}
            nativeID={`screen-${tab}`}
            {...(Platform.OS === "web"
              ? { role: "tabpanel" as const, "aria-labelledby": `tab-${tab}` }
              : {})}
            contentContainerStyle={{
              padding: 20,
              gap: 20,
              paddingBottom: 28,
              width: "100%",
              maxWidth: 720,
              alignSelf: "center",
            }}
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
          >
            {tab !== "settings" || settingsPage === "main" ? (
              <View
                style={{
                  flexDirection: largeType ? "column" : "row",
                  alignItems: largeType ? "stretch" : "center",
                  gap: 8,
                }}
              >
                <T
                  accessibilityRole="header"
                  style={[
                    heading,
                    {
                      fontSize: compactTitle ? 24 : 28,
                      lineHeight: compactTitle ? 31 : 36,
                      flexShrink: 1,
                      flex: largeType ? undefined : 1,
                      minWidth: 0,
                    },
                  ]}
                >
                  {tab === "today"
                    ? t("{name}的小日子", { name: state.profile.name })
                    : pageTitles[tab]}
                </T>
                {tab === "records" ? (
                  <RecordsViewToggle
                    value={activeRecordView}
                    onChange={setActiveRecordView}
                  />
                ) : null}
              </View>
            ) : null}
            {message ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setMessage("")}
                accessibilityLabel={t("关闭提示")}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: c.soft,
                  minHeight: 44,
                  justifyContent: "center",
                }}
              >
                <T style={{ fontSize: 13 }}>{t(message)}　×</T>
              </Pressable>
            ) : null}
            <FamilySyncBanner
              pilot={family}
              onOpenFamily={() => {
                if (family.authStatus === "authenticated") openFamilyPage();
                else {
                  setTab("settings");
                  setSettingsPage("main");
                  mainScroll.current?.scrollTo({ y: 0, animated: false });
                }
              }}
            />
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
                              if (family.sharedMode) {
                                if (!deleteVersion.current)
                                  throw new Error("record_pending");
                                await family.deleteRecord(
                                  "entry",
                                  e.id,
                                  deleteVersion.current,
                                );
                              } else
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
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t("打开宝宝档案")} · ${age(state.profile.birthDate, new Date(now))}`}
                        onPress={showProfile}
                        style={{ minHeight: 44, justifyContent: "center" }}
                      >
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
                  <T
                    style={{
                      color: c.heroMuted,
                      fontSize: 11,
                      fontWeight: "600",
                    }}
                  >
                    今日数据
                  </T>
                  <View
                    style={[
                      row,
                      largeType && {
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: 16,
                      },
                    ]}
                  >
                    {[
                      [String(summary.feedMl), "mL 已记录奶量"],
                      [
                        summary.sleepMinutes
                          ? (summary.sleepMinutes / 60).toFixed(1)
                          : "0",
                        "小时 已记录睡眠",
                      ],
                      [String(summary.diaperCount), "次 换尿布"],
                    ].map(([v, l]) => (
                      <View key={l} style={{ flexShrink: 1, minWidth: 0 }}>
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
                <View style={[row, { flexWrap: "wrap" }]}>
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
                      <View
                        style={[
                          row,
                          { flexWrap: largeType ? "wrap" : "nowrap" },
                        ]}
                      >
                        <View
                          style={{
                            backgroundColor: c[type],
                            width: 45,
                            height: 45,
                            borderRadius: 15,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <CareIcon kind={type} color={c.icon} />
                        </View>
                        <View
                          style={{ flex: 1, minWidth: largeType ? "70%" : 0 }}
                        >
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
                                  ? type === "sleep"
                                    ? t("{time} 醒来 · 已清醒 {duration}", {
                                        time: sleepTime(last.end!, now),
                                        duration: elapsed(
                                          now - Date.parse(last.end!),
                                        ),
                                      })
                                    : t("上次 {time} · {duration}前", {
                                        time: time(last.start),
                                        duration: elapsed(
                                          now - Date.parse(last.start),
                                        ),
                                      })
                                  : "还没有记录，轻点开始"}
                          </T>
                          {((type === "feed" && activeFeed) ||
                            (type === "sleep" && active)) &&
                          family.sharedMode ? (
                            <T
                              raw
                              style={{
                                marginTop: 2,
                                fontSize: 11,
                                lineHeight: 16,
                                color: c.muted,
                              }}
                            >
                              {authorLabel(
                                type === "feed" ? activeFeed!.id : active!.id,
                              )}
                            </T>
                          ) : null}
                        </View>
                        {type === "feed" && activeFeed ? (
                          <FeedStopButton
                            disabled={
                              busy ||
                              family.busy ||
                              (family.sharedMode &&
                                !family.canControlFeed(activeFeed.id))
                            }
                            onPress={() =>
                              setFinishingFeed({
                                entry: activeFeed,
                                baseVersion: versionFor(activeFeed.id),
                                stoppedAt: new Date(
                                  Math.max(
                                    Date.now(),
                                    Date.parse(activeFeed.start),
                                  ),
                                ).toISOString(),
                              })
                            }
                          />
                        ) : type === "sleep" && active ? (
                          <FeedStopButton
                            label="醒了"
                            secondary
                            disabled={
                              busy ||
                              family.busy ||
                              (family.sharedMode &&
                                !family.canControlSleep(active.id))
                            }
                            onPress={() => void act(() => toggleSleep(active))}
                          />
                        ) : (
                          <Button
                            label={type === "sleep" ? "睡了" : "＋记录"}
                            disabled={busy || (type === "sleep" && family.busy)}
                            secondary
                            style={largeType ? { width: "100%" } : undefined}
                            onPress={() => {
                              if (type === "sleep")
                                void act(() => toggleSleep(active));
                              else beginEditor(newEntry(type));
                            }}
                          />
                        )}
                      </View>
                      {type === "feed" && latestFeed ? (
                        <T style={{ color: c.muted, fontSize: 13 }}>
                          {detail(activeFeed ?? latestFeed, now)}
                        </T>
                      ) : null}
                      {type === "sleep" && latestSleep && !active ? (
                        <T style={{ color: c.muted, fontSize: 13 }}>
                          {t("上一觉：{start}–{end} · 共睡 {duration}", {
                            start: sleepTime(latestSleep.start, now),
                            end: sleepTime(latestSleep.end!, now),
                            duration: elapsed(
                              Date.parse(latestSleep.end!) -
                                Date.parse(latestSleep.start),
                            ),
                          })}
                        </T>
                      ) : null}
                      {type === "sleep" ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => beginEditor(newEntry("sleep"))}
                          style={{
                            alignSelf: "flex-start",
                            minHeight: 44,
                            justifyContent: "center",
                          }}
                        >
                          <T style={{ fontSize: 12, color: c.primary }}>
                            补录睡眠 ›
                          </T>
                        </Pressable>
                      ) : null}
                      {type === "sleep" && sleepNotice ? (
                        <T
                          accessibilityRole="alert"
                          style={{ color: c.muted, fontSize: 13 }}
                        >
                          {sleepNotice}
                        </T>
                      ) : null}
                    </Card>
                  );
                })}
              </>
            ) : null}
            {tab === "records" ? (
              <Records
                key={familyContext}
                authorLabel={family.sharedMode ? authorLabel : undefined}
                canEdit={
                  family.sharedMode
                    ? (id) => family.canEditRecord("entry", id)
                    : undefined
                }
                view={activeRecordView}
                entries={entries}
                now={now}
                onEdit={beginEditor}
                onDelete={beginDelete}
              />
            ) : null}
            {tab === "growth" ? (
              <>
                <Card>
                  <View style={[row, { flexWrap: "wrap" }]}>
                    <T style={heading}>成长曲线</T>
                    <Button
                      label="＋测量"
                      secondary
                      onPress={() => beginEditor(newEntry("growth"))}
                    />
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 6,
                      flexWrap: largeType ? "wrap" : "nowrap",
                    }}
                  >
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
                            : "#9F4935"
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
                              minWidth: largeType ? "42%" : 0,
                              minHeight: 64,
                              borderRadius: 15,
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 2,
                              backgroundColor: selected ? c.soft : c.card,
                              borderWidth: 1,
                              borderColor: selected ? accent : c.line,
                              opacity: pressed ? 0.72 : 1,
                              paddingHorizontal: 5,
                              paddingVertical: 8,
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
                              fontSize: 13,
                              lineHeight: 18,
                              fontWeight: selected ? "700" : "500",
                            }}
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
                key={familyContext}
                sharedMode={family.sharedMode}
                sharedPlay={
                  extrasAvailable
                    ? {
                        selection:
                          sharedSelection?.kind === "play-selection"
                            ? sharedSelection.selection
                            : { included: [], excluded: [] },
                        checkins: [
                          ...new Set(
                            family.sharedExtras.flatMap((r) =>
                              r.record.kind === "play-checkin" &&
                              r.record.day === localDay(new Date(now))
                                ? [r.record.activityId]
                                : [],
                            ),
                          ),
                        ],
                        canChangeSelection: family.canEditRecord(
                          "extra",
                          "play-selection",
                        ),
                        canToggleCheckin,
                        onChangeSelection: (selection) =>
                          saveExtra(
                            {
                              id: "play-selection",
                              kind: "play-selection",
                              selection,
                            },
                            extraVersionFor("play-selection"),
                          ),
                        onToggleCheckin: async (id) => {
                          if (!canToggleCheckin(id))
                            throw new Error("record_forbidden");
                          const existing = checkinsFor(id);
                          if (existing.length) {
                            for (const r of existing)
                              await deleteExtra(r.record.id, r.version);
                          } else
                            await saveExtra({
                              id: randomUUID(),
                              kind: "play-checkin",
                              day: localDay(new Date(now)),
                              activityId: id,
                            });
                        },
                      }
                    : undefined
                }
                careVersions={Object.fromEntries(
                  family.fullSnapshot?.careRecords.map((r) => [
                    r.record.id,
                    r.version,
                  ]) ?? [],
                )}
                canEditCare={(id) =>
                  !family.sharedMode || family.canEditRecord("care", id)
                }
                birthDate={state.profile.birthDate}
                now={now}
                careRecords={state.careRecords ?? []}
                supplementsEnabled={
                  !family.sharedMode ||
                  family.fullSnapshot?.careSchemaVersion === 2
                }
                onSaveCare={async (record, baseVersion) => {
                  if (family.sharedMode) {
                    await family.saveRecord("care", record, baseVersion);
                    return;
                  }
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
                onDeleteCare={async (id, baseVersion) => {
                  if (family.sharedMode) {
                    if (!baseVersion) throw new Error("record_pending");
                    await family.deleteRecord("care", id, baseVersion);
                    return;
                  }
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
              ) : settingsPage === "family-demo" && familyDemoEnabled ? (
                <FamilyDemoScreen
                  onBack={() => {
                    setSettingsPage("main");
                    mainScroll.current?.scrollTo({ y: 0, animated: false });
                  }}
                />
              ) : settingsPage === "family" ? (
                <FamilyScreen
                  source={offlineState ?? initialState}
                  pilot={family}
                  feedbackHandledByGlobalBanner
                  onBack={() => {
                    setSettingsPage("main");
                    mainScroll.current?.scrollTo({ y: 0, animated: false });
                  }}
                />
              ) : (
                <Settings
                  key={familyContext}
                  familyPushPanel={
                    family.fullSnapshot && Platform.OS !== "web" ? (
                      <FamilyPushSettings controller={familyPush} />
                    ) : undefined
                  }
                  sharedMode={family.sharedMode}
                  sharedOwner={family.fullSnapshot?.family.role === "owner"}
                  sharedAvatarEditable={
                    !!extrasAvailable && family.canEditRecord("extra", "avatar")
                  }
                  sharedReminders={
                    extrasAvailable ? (
                      <SharedReminders
                        records={family.sharedExtras}
                        enabled={family.notificationsEnabled}
                        notificationError={family.notificationError}
                        canEdit={(id) => family.canEditRecord("extra", id)}
                        onSave={saveExtra}
                        onDelete={deleteExtra}
                        onEnable={family.setNotificationsEnabled}
                      />
                    ) : undefined
                  }
                  profileVersion={family.fullSnapshot?.family.profileVersion}
                  familyUiPreview={familyDemoEnabled}
                  accountPanel={
                    <FamilyScreenView
                      pilot={family}
                      section="account"
                      feedbackHandledByGlobalBanner
                    />
                  }
                  familySharingVisible={!!family.user || family.sharedMode}
                  accountDeletionPanel={
                    <FamilyScreenView
                      pilot={family}
                      section="deletion"
                      feedbackHandledByGlobalBanner
                    />
                  }
                  initialProfileExpanded={openProfile}
                  state={state}
                  avatarUri={avatarUri}
                  onAvatarChange={updateAvatar}
                  onCommit={async (next, recovery, baseVersion) => {
                    await commit(next, recovery, baseVersion);
                  }}
                  themePreference={themePreference}
                  recordView={recordView}
                  onRecordViewChange={async (value) => {
                    await saveRecordView(value);
                    setRecordView(value);
                    setActiveRecordView(value);
                  }}
                  language={language}
                  onLanguageChange={changeLanguage}
                  onOpenPrivacy={() => setSettingsPage("privacy")}
                  onOpenFamily={openFamilyPage}
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
            <AppTabBar
              tab={tab}
              colors={c}
              onSelect={(key) => {
                Keyboard.dismiss();
                setOpenProfile(false);
                if (key === "records" && tab !== "records") {
                  setActiveRecordView(recordView);
                }
                if (key !== tab) {
                  mainScroll.current?.scrollTo({ y: 0, animated: false });
                }
                setTab(key);
                setSettingsPage("main");
                setMessage("");
                setDeleting(null);
              }}
            />
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
              if (family.sharedMode)
                await family.finishFeed(
                  current.id,
                  finishingFeed.stoppedAt,
                  amount,
                  finishingFeed.baseVersion,
                  finishingFeed.entry,
                );
              else
                await upsert(
                  finishFeed(current, finishingFeed.stoppedAt, amount),
                  finishingFeed.baseVersion,
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
            sharedMode={family.sharedMode}
            hasAccount={!!family.user || family.tokenRecognized}
          />
        ) : null}
      </SafeAreaView>
    </Theme.Provider>
  );
}
