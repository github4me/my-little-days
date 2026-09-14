import React, { useContext, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { State, validateState } from "./domain";
import { Theme, T, Card, Field, Button, Chips, row, heading } from "./ui";
import { exportBackup, importBackup } from "./backup";
import {
  saveAutoFeedReminder,
  loadReminderSettings,
  saveReminderSettings,
} from "./storage";
import {
  Reminder,
  addAutoFeedReminder,
  addReminder,
  cancelReminder,
  listReminders,
  updateReminderSilent,
} from "./reminders";
import { type ReminderMode, type ReminderSettings } from "./reminderSettings";
import { copyAvatarFile, deleteAvatarFile } from "./avatar";
import { t, type LanguagePreference } from "./i18n";
import type { RecordView } from "./recordCalendar";

const reminderKindLabels = {
  feed: "喂养",
  diaper: "换尿布",
  sleep: "睡眠",
} as const;

function SettingsSection({
  title,
  busy,
  children,
}: {
  title: string;
  busy: boolean;
  children: React.ReactNode;
}) {
  const c = useContext(Theme);
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(expanded ? "收起{section}" : "展开{section}", {
          section: t(title),
        })}
        accessibilityState={{ expanded, disabled: busy }}
        aria-expanded={expanded}
        disabled={busy}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}
      >
        <T style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: "700" }}>
          {title}
        </T>
        <T style={{ color: c.primary, fontSize: 13, flexShrink: 0 }}>
          {expanded ? "收起　⌃" : "展开　⌄"}
        </T>
      </Pressable>
      {expanded ? children : null}
    </Card>
  );
}

export default function Settings({
  familyUiPreview = false,
  initialProfileExpanded = false,
  state,
  avatarUri,
  onAvatarChange,
  onCommit,
  themePreference,
  recordView,
  onRecordViewChange,
  onDarkMode,
  language,
  onLanguageChange,
  onOpenPrivacy,
  onOpenFamily,
}: {
  familyUiPreview?: boolean;
  initialProfileExpanded?: boolean;
  state: State;
  avatarUri: string | null;
  onAvatarChange: (uri: string | null) => Promise<void>;
  onCommit: (next: State, recovery?: boolean) => Promise<void>;
  themePreference: boolean | null;
  recordView: RecordView;
  onRecordViewChange: (value: RecordView) => Promise<void>;
  onDarkMode: (v: boolean | null) => Promise<void>;
  language: LanguagePreference;
  onLanguageChange: (language: LanguagePreference) => Promise<void>;
  onOpenPrivacy: () => void;
  onOpenFamily: () => void;
}) {
  const c = useContext(Theme);
  const [name, setName] = useState(state.profile.name),
    [birthDate, setBirthDate] = useState(state.profile.birthDate),
    [sex, setSex] = useState<string>(state.profile.sex);
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    mounted = useRef(true);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [pending, setPending] = useState<State | null>(null),
    [backupNotice, setBackupNotice] = useState("");
  const source = "备份文件";
  const [profileExpanded, setProfileExpanded] = useState(
    initialProfileExpanded,
  );
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [mode, setMode] = useState<ReminderMode>("once"),
    [minutes, setMinutes] = useState("120"),
    [dailyTime, setDailyTime] = useState("09:00"),
    [kind, setKind] = useState<ReminderSettings["kind"]>("feed"),
    [title, setTitle] = useState(""),
    [silent, setSilent] = useState(true);
  function applyReminderSettings(settings: ReminderSettings) {
    setKind(settings.kind);
    setMode(settings.mode);
    setMinutes(String(settings.minutes));
    setDailyTime(settings.dailyTime || "09:00");
    setTitle(settings.title);
    setSilent(settings.silent);
  }
  useEffect(() => {
    setName(state.profile.name);
    setBirthDate(state.profile.birthDate);
    setSex(state.profile.sex);
  }, [state.profile.name, state.profile.birthDate, state.profile.sex]);
  useEffect(() => {
    mounted.current = true;
    if (Platform.OS !== "web")
      Promise.all([listReminders(), loadReminderSettings()])
        .then(([items, savedSettings]) => {
          if (!mounted.current) return;
          setReminders(items);
          const activeSettings = items.find((item) => item.settings)?.settings;
          const settings = savedSettings ?? activeSettings;
          if (settings) {
            applyReminderSettings(settings);
            if (!savedSettings)
              void saveReminderSettings(settings).catch(() => {});
          }
        })
        .catch((e) => {
          if (mounted.current)
            setError(e instanceof Error ? e.message : "暂时无法读取提醒");
        });
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh() {
    const values = await listReminders();
    if (mounted.current) setReminders(values);
  }
  function reminderSettings(nextSilent = silent): ReminderSettings {
    const currentMinutes = Number(minutes);
    return {
      kind,
      mode,
      title: title.trim() || t(`${reminderKindLabels[kind]}提醒`),
      minutes:
        mode === "daily" &&
        (!Number.isFinite(currentMinutes) ||
          currentMinutes < 1 ||
          currentMinutes > 10080)
          ? 120
          : currentMinutes,
      dailyTime: mode === "daily" ? dailyTime.trim() : "",
      silent: nextSilent,
    };
  }
  function changeSilent(nextSilent: boolean) {
    const previous = silent;
    setSilent(nextSilent);
    void run(async () => {
      try {
        const settings = reminderSettings(nextSilent);
        await saveReminderSettings(settings);
        if (settings.mode === "after-feed")
          await saveAutoFeedReminder(settings);
        await Promise.all(
          reminders
            .filter(
              (reminder) =>
                reminder.settings?.kind === settings.kind &&
                reminder.settings.mode === settings.mode,
            )
            .map((reminder) => updateReminderSilent(reminder.id, nextSilent)),
        );
        await refresh();
        setMessage("提醒设置已自动保存");
      } catch (error) {
        setSilent(previous);
        throw error;
      }
    });
  }
  function changeTheme(nextDarkMode: boolean | null) {
    void run(async () => {
      await onDarkMode(nextDarkMode);
      setMessage("主题已自动保存");
    });
  }
  return (
    <View style={{ gap: 18 }}>
      <View>
        <T style={{ color: c.muted }}>属于宝宝，也属于你的小小日常。</T>
      </View>
      {!!error && (
        <Card>
          <T accessibilityRole="alert" style={{ color: "#B34B3B" }}>
            {t(error)}
          </T>
        </Card>
      )}
      {!!message && (
        <Card>
          <T accessibilityLiveRegion="polite" style={{ color: c.primary }}>
            {t(message)}
          </T>
        </Card>
      )}
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            profileExpanded ? "收起宝宝档案" : "展开宝宝档案",
          )}
          accessibilityState={{ expanded: profileExpanded }}
          aria-expanded={profileExpanded}
          disabled={busy}
          onPress={() => setProfileExpanded((expanded) => !expanded)}
          style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}
        >
          <T style={{ fontSize: 18, fontWeight: "700" }}>宝宝档案</T>
          <T style={{ color: c.primary, fontSize: 13 }}>
            {profileExpanded ? "收起　⌃" : "展开　⌄"}
          </T>
        </Pressable>
        {profileExpanded ? (
          <>
            <View pointerEvents={busy ? "none" : "auto"} style={{ gap: 14 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
              >
                <View
                  style={{
                    width: 70,
                    height: 70,
                    borderRadius: 35,
                    backgroundColor: c.avatar,
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {avatarUri ? (
                    <Image
                      accessibilityLabel={t("宝宝头像")}
                      resizeMode="cover"
                      source={{ uri: avatarUri }}
                      style={{ width: 70, height: 70 }}
                    />
                  ) : (
                    <T style={{ color: c.primary, fontSize: 28 }}>☘</T>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: "600" }}>宝宝头像</T>
                  <T style={{ color: c.muted, fontSize: 12 }}>
                    仅保存在这台设备，不会上传
                  </T>
                </View>
              </View>
              {Platform.OS === "web" ? (
                <T style={{ color: c.muted, fontSize: 12 }}>
                  网页预览不支持保存本机头像，请在手机安装版中设置。
                </T>
              ) : (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button
                    label={avatarUri ? "更换照片" : "选择照片"}
                    secondary
                    disabled={busy}
                    style={{ flex: 1 }}
                    onPress={() =>
                      run(async () => {
                        const result =
                          await ImagePicker.launchImageLibraryAsync({
                            mediaTypes: ["images"],
                            allowsEditing: true,
                            aspect: [1, 1],
                            quality: 0.7,
                          });
                        if (result.canceled) return;
                        const nextAvatar = await copyAvatarFile(
                          result.assets[0].uri,
                        );
                        try {
                          await onAvatarChange(nextAvatar);
                        } catch (e) {
                          await deleteAvatarFile(nextAvatar);
                          throw e;
                        }
                        await deleteAvatarFile(avatarUri);
                        setMessage("宝宝头像已保存到本机");
                      })
                    }
                  />
                  {avatarUri ? (
                    <Button
                      label="移除头像"
                      secondary
                      disabled={busy}
                      style={{ flex: 1 }}
                      onPress={() =>
                        run(async () => {
                          await onAvatarChange(null);
                          await deleteAvatarFile(avatarUri);
                          setMessage("宝宝头像已移除");
                        })
                      }
                    />
                  ) : null}
                </View>
              )}
              <Field
                label="宝宝名字"
                value={name}
                onChange={setName}
                maxLength={100}
                placeholder="宝宝"
              />
              <Field
                label="出生日期 · 可暂不填写"
                value={birthDate}
                onChange={setBirthDate}
                placeholder="YYYY-MM-DD"
                maxLength={10}
              />
              <T style={{ color: c.muted, fontSize: 13 }}>
                性别 · 用于匹配成长参考曲线
              </T>
              <Chips
                value={sex}
                onChange={setSex}
                iconized
                options={[
                  { label: "男宝宝", value: "male", icon: "♂" },
                  { label: "女宝宝", value: "female", icon: "♀" },
                  { label: "暂不填写", value: "unspecified", icon: "○" },
                ]}
              />
            </View>
            <Button
              label="保存档案"
              disabled={busy}
              onPress={() =>
                run(async () => {
                  const next = validateState({
                    ...state,
                    profile: {
                      name: name.trim(),
                      birthDate: birthDate.trim(),
                      sex,
                    },
                  });
                  if (next.profile.birthDate) {
                    const now = new Date(),
                      today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                    if (next.profile.birthDate > today)
                      throw new Error("出生日期不能在未来");
                  }
                  await onCommit(next);
                  setMessage("宝宝档案已保存");
                })
              }
            />
          </>
        ) : null}
      </Card>
      <SettingsSection title="语言" busy={busy}>
        <T style={{ color: c.muted, fontSize: 13 }}>
          跟随系统语言，或在这里固定选择显示语言。
        </T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            {
              value: "system" as const,
              icon: "⌘",
              label: "自动",
              accessibilityLabel: "跟随系统",
            },
            {
              value: "zh" as const,
              icon: "中",
              label: "中文",
              accessibilityLabel: "简体中文",
            },
            {
              value: "en" as const,
              icon: "A",
              label: "English",
              accessibilityLabel: "English",
            },
          ].map(({ value, icon, label, accessibilityLabel }) => {
            const selected = language === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(accessibilityLabel)}
                accessibilityState={{ selected }}
                disabled={busy}
                key={value}
                onPress={() =>
                  void run(async () => {
                    await onLanguageChange(value as LanguagePreference);
                    setMessage(t("语言已保存"));
                  })
                }
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minWidth: 0,
                    minHeight: 66,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    backgroundColor: selected ? c.soft : c.card,
                    borderWidth: 1,
                    borderColor: selected ? c.primary : c.line,
                    opacity: pressed || busy ? 0.7 : 1,
                  },
                ]}
              >
                <T
                  raw
                  style={{
                    color: selected ? c.primary : c.muted,
                    fontSize: 22,
                    lineHeight: 26,
                    fontWeight: icon === "A" ? "700" : "500",
                  }}
                >
                  {icon}
                </T>
                <T
                  style={{
                    color: selected ? c.primary : c.muted,
                    fontSize: 11,
                    lineHeight: 15,
                    fontWeight: selected ? "700" : "500",
                  }}
                >
                  {label}
                </T>
              </Pressable>
            );
          })}
        </View>
      </SettingsSection>
      <SettingsSection title="主题" busy={busy}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("主题")}>
          {(
            [
              [null, "自动（跟随系统）", "◐"],
              [false, "浅色", "☼"],
              [true, "深色", "☾"],
            ] as const
          ).map(([value, label, icon], index) => (
            <Pressable
              key={label}
              accessibilityRole="radio"
              aria-checked={themePreference === value}
              accessibilityLabel={t(label)}
              accessibilityState={{
                checked: themePreference === value,
                disabled: busy,
              }}
              disabled={busy}
              onPress={() => changeTheme(value)}
              style={[
                row,
                {
                  minHeight: 52,
                  paddingVertical: 10,
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: c.line,
                },
              ]}
            >
              <T style={{ fontSize: 25, width: 30, textAlign: "center" }}>
                {icon}
              </T>
              <T style={{ flex: 1, fontSize: 17 }}>{label}</T>
              <T
                style={{
                  color: themePreference === value ? c.primary : c.muted,
                  fontSize: 23,
                }}
              >
                {themePreference === value ? "✓" : "○"}
              </T>
            </Pressable>
          ))}
        </View>
        <T style={{ color: c.muted, fontSize: 13 }}>
          自动跟随设备的系统外观，选择后立即保存。
        </T>
      </SettingsSection>
      <SettingsSection title="记录默认视图" busy={busy}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("记录默认视图")}
        >
          {(
            [
              ["calendar", "日历视图", "▦"],
              ["bars", "柱状图", "▥"],
            ] as const
          ).map(([value, label, icon]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={t(label)}
              accessibilityState={{
                checked: recordView === value,
                disabled: busy,
              }}
              disabled={busy}
              style={[row, { minHeight: 52 }]}
              onPress={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                setError("");
                try {
                  await onRecordViewChange(value);
                } catch {
                  setError(t("无法保存视图设置，请重试。"));
                } finally {
                  lock.current = false;
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              <T style={{ fontSize: 24, width: 30 }}>{icon}</T>
              <T style={{ flex: 1 }}>{label}</T>
              <T style={{ color: c.primary, fontSize: 22 }}>
                {recordView === value ? "✓" : "○"}
              </T>
            </Pressable>
          ))}
        </View>
        <T style={{ fontSize: 13, color: c.muted }}>
          选择后立即保存；每次进入记录页时使用，也可在记录页临时切换。
        </T>
      </SettingsSection>
      <SettingsSection title="照护提醒" busy={busy}>
        <T style={{ color: c.muted, fontSize: 13 }}>
          {kind === "feed"
            ? "跟随模式会在每次保存喂奶后，按最新开始时间安排下一次提醒。"
            : "按自己的需要设置。间隔提醒从现在算起，只提醒一次。"}
        </T>
        {Platform.OS === "web" ? (
          <T style={{ color: c.muted }}>
            浏览器预览不支持本地通知，请在手机安装版中设置和测试。
          </T>
        ) : (
          <>
            <View pointerEvents={busy ? "none" : "auto"} style={{ gap: 13 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {[
                  { value: "feed", icon: "◒" },
                  { value: "diaper", icon: "♧" },
                  { value: "sleep", icon: "☾" },
                ].map(({ value, icon }) => {
                  const selected = kind === value;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        reminderKindLabels[value as ReminderSettings["kind"]],
                      )}
                      accessibilityState={{ selected }}
                      key={value}
                      onPress={() => {
                        const next = value as ReminderSettings["kind"];
                        setKind(next);
                        if (next !== "feed" && mode === "after-feed")
                          setMode("once");
                      }}
                      style={({ pressed }) => [
                        {
                          flex: 1,
                          minHeight: 70,
                          borderRadius: 18,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: selected ? c.soft : c.card,
                          borderWidth: 1,
                          borderColor: selected ? c.primary : c.line,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <T
                        style={{
                          color: selected ? c.primary : c.muted,
                          fontSize: 23,
                          lineHeight: 27,
                        }}
                      >
                        {icon}
                      </T>
                      <T
                        style={{
                          color: selected ? c.primary : c.muted,
                          fontSize: 12,
                          fontWeight: selected ? "700" : "400",
                        }}
                      >
                        {reminderKindLabels[value as ReminderSettings["kind"]]}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
              <Field
                label="提醒标题 · 可选"
                value={title}
                onChange={setTitle}
                placeholder={t(`${reminderKindLabels[kind]}提醒`)}
                maxLength={100}
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                {(kind === "feed"
                  ? [
                      {
                        value: "after-feed" as const,
                        label: "随最新喂养",
                        shortLabel: "跟随",
                        icon: "↻",
                      },
                      {
                        value: "once" as const,
                        label: "仅提醒一次",
                        shortLabel: "一次",
                        icon: "◷",
                      },
                      {
                        value: "daily" as const,
                        label: "每天固定时间",
                        shortLabel: "每天",
                        icon: "☀",
                      },
                    ]
                  : [
                      {
                        value: "once" as const,
                        label: "稍后提醒一次",
                        shortLabel: "一次",
                        icon: "◷",
                      },
                      {
                        value: "daily" as const,
                        label: "每天固定时间",
                        shortLabel: "每天",
                        icon: "☀",
                      },
                    ]
                ).map(({ value, label, shortLabel, icon }) => {
                  const selected = mode === value;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(label)}
                      accessibilityState={{ selected }}
                      key={value}
                      onPress={() => setMode(value)}
                      style={({ pressed }) => [
                        {
                          flex: 1,
                          minHeight: 68,
                          borderRadius: 18,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: selected ? c.soft : c.card,
                          borderWidth: 1,
                          borderColor: selected ? c.primary : c.line,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <T
                        style={{
                          color: selected ? c.primary : c.muted,
                          fontSize: 24,
                          lineHeight: 28,
                        }}
                      >
                        {icon}
                      </T>
                      <T
                        style={{
                          color: selected ? c.primary : c.muted,
                          fontSize: 12,
                          fontWeight: selected ? "700" : "400",
                        }}
                      >
                        {shortLabel}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
              {mode === "daily" ? (
                <Field
                  label="每天当地时间 · HH:mm"
                  value={dailyTime}
                  onChange={setDailyTime}
                  placeholder="09:00"
                  maxLength={5}
                />
              ) : (
                <Field
                  label={
                    mode === "after-feed" ? "喂养开始后多少分钟" : "多少分钟后"
                  }
                  value={minutes}
                  onChange={setMinutes}
                  keyboardType="number-pad"
                  placeholder="120"
                />
              )}
              <View style={row}>
                <View style={{ flex: 1 }}>
                  <T>静音提醒</T>
                  <T style={{ color: c.muted, fontSize: 11 }}>切换后自动保存</T>
                </View>
                <Switch
                  accessibilityLabel={t("静音提醒")}
                  value={silent}
                  onValueChange={changeSilent}
                  disabled={busy}
                  trackColor={{ true: c.primary }}
                />
              </View>
            </View>
            <Button
              label="添加提醒"
              disabled={busy}
              onPress={() =>
                run(async () => {
                  if (mode !== "daily" && !minutes.trim())
                    throw new Error("请填写提醒间隔");
                  if (
                    mode === "daily" &&
                    !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime.trim())
                  )
                    throw new Error("时间格式应为 HH:mm");
                  const settings = reminderSettings();
                  const reminderTitle = settings.title;
                  if (mode === "after-feed")
                    await addAutoFeedReminder(
                      reminderTitle,
                      settings.minutes,
                      silent,
                      state.entries,
                    );
                  else
                    await addReminder(
                      reminderTitle,
                      settings.minutes,
                      mode === "daily" ? dailyTime.trim() : undefined,
                      silent,
                      kind,
                    );
                  await saveReminderSettings(settings);
                  await refresh();
                  setMessage(
                    mode === "after-feed"
                      ? "提醒已添加；保存下一次喂养后会自动重置"
                      : "提醒已添加",
                  );
                })
              }
            />
            {reminders.length === 0 ? (
              <T style={{ color: c.muted, fontSize: 13 }}>还没有待提醒事项</T>
            ) : (
              reminders.map((reminder) => (
                <View
                  key={reminder.id}
                  style={{
                    ...row,
                    borderTopWidth: 1,
                    borderTopColor: c.line,
                    paddingTop: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: "600" }}>{t(reminder.title)}</T>
                    <T style={{ color: c.muted, fontSize: 12 }}>
                      {t(reminder.detail)}
                    </T>
                  </View>
                  <Button
                    label="取消"
                    secondary
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await cancelReminder(reminder.id);
                        await refresh();
                        setMessage("提醒已取消");
                      })
                    }
                  />
                </View>
              ))
            )}
          </>
        )}
      </SettingsSection>
      <SettingsSection title="备份与恢复" busy={busy}>
        <T style={{ color: c.muted, fontSize: 13 }}>
          记录保存在当前设备。换手机或卸载前，请导出备份并妥善保存。备份包含宝宝档案和全部记录，不含提醒；重新安装后需重新设置提醒。
        </T>
        <Button
          label="导出备份文件"
          disabled={busy || !!pending}
          onPress={() =>
            run(async () => {
              await exportBackup(state);
              const notice = "导出操作已完成，请确认备份文件已保存";
              setMessage(notice);
              setBackupNotice(notice);
            })
          }
        />
        <Button
          label="选择备份文件"
          secondary
          disabled={busy || !!pending}
          onPress={() =>
            run(async () => {
              const next = await importBackup();
              if (next) {
                setBackupNotice("");
                setPending(next);
              }
            })
          }
        />
        {backupNotice ? (
          <View
            style={{
              backgroundColor: c.soft,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <T style={{ color: c.muted, fontSize: 12 }}>{t(backupNotice)}</T>
          </View>
        ) : null}
        {pending && (
          <View
            style={{
              backgroundColor: c.soft,
              padding: 16,
              borderRadius: 16,
              gap: 12,
            }}
          >
            <T style={{ fontWeight: "700" }}>
              {t("确认恢复：{source}", { source: t(source) })}
            </T>
            <T>
              {t("{name} · {count} 条记录", {
                name: pending.profile.name,
                count:
                  pending.entries.length + (pending.careRecords?.length ?? 0),
              })}
            </T>
            <T style={{ fontSize: 13 }}>
              {t(
                "这会替换当前「{name}」的 {count} 条记录，不会合并。替换前的数据会保留一份，可从上方入口恢复。",
                {
                  name: state.profile.name,
                  count:
                    state.entries.length + (state.careRecords?.length ?? 0),
                },
              )}
            </T>
            <Button
              label="确认替换当前数据"
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await onCommit(pending, true);
                  await onAvatarChange(null);
                  await deleteAvatarFile(avatarUri);
                  setPending(null);
                  setBackupNotice("");
                  setMessage(
                    "记录已恢复；头像已移除，现有提醒保持不变，请按需检查",
                  );
                })
              }
            />
            <Button
              label="取消恢复"
              secondary
              disabled={busy}
              onPress={() => {
                setPending(null);
                setBackupNotice("");
              }}
            />
          </View>
        )}
      </SettingsSection>
      <SettingsSection title="家庭邀请试点" busy={busy}>
        <T style={{ color: c.muted, fontSize: 13 }}>
          {familyUiPreview
            ? "预览邀请和成员管理界面。仅使用样例，不登录、不联网、不保存。"
            : "独立测试空间，仅使用虚构数据。现有宝宝记录不会上传或共享。"}
        </T>
        <Button
          label={familyUiPreview ? "界面预览（无需登录）" : "打开家庭邀请试点"}
          secondary
          onPress={onOpenFamily}
        />
      </SettingsSection>
      <SettingsSection title="隐私与支持" busy={busy}>
        <T style={{ color: c.muted, fontSize: 13 }}>
          了解本机数据、备份和软件更新
        </T>
        <Button label="隐私与支持" secondary onPress={onOpenPrivacy} />
      </SettingsSection>
      <SettingsSection title="致谢" busy={busy}>
        <T style={{ color: c.muted, fontSize: 13 }}>
          感谢 Trista（来自 FPH）和她群里的 Mia、Violet、Bill
          提出的建议与想法，也感谢群里每一位妈妈爸爸的支持。期待更多妈妈爸爸出现在这里，一起让小日子更好。
        </T>
      </SettingsSection>
      <View style={{ padding: 10, gap: 5 }}>
        <T style={{ color: c.muted, fontSize: 12, textAlign: "center" }}>
          Little Days · 单机离线版
        </T>
        <T style={{ color: c.muted, fontSize: 12, textAlign: "center" }}>
          本机记录无需账号 · 家庭试点为独立测试空间 · 不上传照片
        </T>
        <T style={{ color: c.muted, fontSize: 12, textAlign: "center" }}>
          日期按设备当地时区显示和统计
        </T>
      </View>
    </View>
  );
}
