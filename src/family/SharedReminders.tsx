import React, { useContext, useRef, useState } from "react";
import NativeDateTimeField from "../NativeDateTimeField";
import RecordActionButton from "../RecordActionButton";
import { View, Switch, Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import { Button, Chips, Field, T, Theme, row } from "../ui";
import { useI18n } from "../i18n";
import {
  parseReminderSettings,
  type ReminderSettings,
} from "../reminderSettings";
import type { FamilyExtraRecord } from "./extras";
import type { SharedRecord } from "./contracts";
import { familyErrorMessage } from "./messages";

export type SharedRemindersProps = {
  records: SharedRecord<{ record: FamilyExtraRecord }>[];
  enabled: boolean;
  notificationError: string | null;
  canEdit: (id: string) => boolean;
  onSave: (record: FamilyExtraRecord, version?: string) => Promise<void>;
  onDelete: (id: string, version: string) => Promise<void>;
  onEnable: (enabled: boolean) => Promise<void>;
};
type ReminderRecord = Extract<FamilyExtraRecord, { kind: "reminder" }>;
export default function SharedReminders(props: SharedRemindersProps) {
  const c = useContext(Theme);
  const { locale, formattingLocale, localize: copy } = useI18n();
  const preset = props.records.find(
    (r) => r.record.kind === "reminder-settings",
  )?.record;
  const defaults: ReminderSettings =
    preset?.kind === "reminder-settings" && preset.settings
      ? preset.settings
      : {
          kind: "feed",
          mode: "once",
          title: "",
          minutes: 120,
          dailyTime: "",
          silent: true,
        };
  const [draft, setDraft] = useState(defaults);
  const [minutes, setMinutes] = useState(String(defaults.minutes));
  const [editing, setEditing] = useState<{
    record: ReminderRecord;
    version: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    version: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await action();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "request_failed";
      setError(
        code === "invalid_extra_record"
          ? copy(
              "请检查时间：间隔需为 1–10080 分钟，每日时间为 HH:mm。",
              "Check the time: use 1–10080 minutes or daily HH:mm.",
            )
          : /^[a-z_]+$/.test(code)
            ? familyErrorMessage(locale, code)
            : code,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const reminders = props.records.filter(
    (r): r is SharedRecord<{ record: ReminderRecord }> =>
      r.record.kind === "reminder",
  );
  const kindLabel = (kind: ReminderSettings["kind"]) =>
    kind === "feed"
      ? copy("喂养", "Feed")
      : kind === "diaper"
        ? copy("换尿布", "Nappy")
        : copy("睡眠", "Sleep");
  return (
    <View style={{ gap: 14 }}>
      <T raw style={{ color: c.muted, fontSize: 13 }}>
        {copy(
          "提醒规则与家庭共享，通知需在每台手机单独启用。每天提醒使用该手机当地时间；已过期的一次性提醒不会重新触发。",
          "Reminder rules are shared. Enable delivery separately on each phone. Daily reminders use this phone’s local time; expired one-time reminders do not restart.",
        )}
      </T>
      <Button
        secondary
        disabled={busy || Platform.OS === "web"}
        label={
          props.enabled
            ? copy("关闭本机通知", "Disable on this phone")
            : copy("启用本机通知", "Enable on this phone")
        }
        onPress={() => run(() => props.onEnable(!props.enabled))}
      />
      {props.notificationError ? (
        <T raw accessibilityRole="alert">
          {copy(
            "本机通知未就绪，请检查通知权限并重新启用。",
            "Device notifications are not ready. Check notification permission and enable again.",
          )}
        </T>
      ) : null}
      <View pointerEvents={busy ? "none" : "auto"} style={{ gap: 12 }}>
        <T raw style={{ fontWeight: "700" }}>
          {editing
            ? copy("编辑家庭提醒", "Edit family reminder")
            : copy("新增家庭提醒", "New family reminder")}
        </T>
        <Chips
          options={(["feed", "diaper", "sleep"] as const).map((value) => ({
            value,
            label: kindLabel(value),
          }))}
          value={draft.kind}
          onChange={(value) =>
            setDraft({
              ...draft,
              kind: value as ReminderSettings["kind"],
              mode:
                value !== "feed" && draft.mode === "after-feed"
                  ? "once"
                  : draft.mode,
            })
          }
        />
        <Field
          label={copy("标题", "Title")}
          value={draft.title}
          onChange={(title) => setDraft({ ...draft, title })}
          maxLength={100}
        />
        <Chips
          options={[
            { value: "once", label: copy("一次", "Once") },
            { value: "daily", label: copy("每天", "Daily") },
            ...(draft.kind === "feed"
              ? [
                  {
                    value: "after-feed",
                    label: copy("随最新喂养", "After feed"),
                  },
                ]
              : []),
          ]}
          value={draft.mode}
          onChange={(mode) =>
            setDraft({
              ...draft,
              mode: mode as ReminderSettings["mode"],
              dailyTime: mode === "daily" ? draft.dailyTime || "09:00" : "",
            })
          }
        />
        {draft.mode === "daily" ? (
          <NativeDateTimeField
            mode="time"
            label={copy("每日时间 · HH:mm", "Daily time · HH:mm")}
            value={draft.dailyTime}
            onChange={(dailyTime) => setDraft({ ...draft, dailyTime })}
          />
        ) : (
          <Field
            label={copy("分钟", "Minutes")}
            value={minutes}
            onChange={setMinutes}
            keyboardType="number-pad"
          />
        )}
        <View style={row}>
          <T raw>{copy("静音通知", "Silent notifications")}</T>
          <Switch
            accessibilityLabel={copy("静音通知", "Silent notifications")}
            value={draft.silent}
            onValueChange={(silent) => setDraft({ ...draft, silent })}
          />
        </View>
      </View>
      {editing?.record.onceAt ? (
        <T raw style={{ fontSize: 12, color: c.muted }}>
          {copy("原定时间：", "Scheduled: ")}
          {new Date(editing.record.onceAt).toLocaleString(formattingLocale)}
          {copy(
            "。修改间隔才会从现在重新计时。",
            ". Changing the interval starts a new countdown.",
          )}
        </T>
      ) : null}
      <Button
        label={copy("保存提醒", "Save reminder")}
        disabled={busy || (!!editing && !props.canEdit(editing.record.id))}
        onPress={() =>
          run(async () => {
            const currentMinutes = Number(minutes.trim());
            const settings = parseReminderSettings({
              ...draft,
              minutes:
                draft.mode === "daily" &&
                (!Number.isFinite(currentMinutes) ||
                  currentMinutes < 1 ||
                  currentMinutes > 10080)
                  ? 120
                  : currentMinutes,
              title: draft.title.trim() || kindLabel(draft.kind),
            });
            if (!settings) throw new Error("invalid_extra_record");
            const unchangedTime =
              editing?.record.settings.mode === "once" &&
              editing.record.settings.minutes === settings.minutes;
            const record: ReminderRecord = {
              id: editing?.record.id ?? randomUUID(),
              kind: "reminder",
              settings,
              ...(settings.mode === "once"
                ? {
                    onceAt: unchangedTime
                      ? editing!.record.onceAt!
                      : new Date(
                          Date.now() + settings.minutes * 60000,
                        ).toISOString(),
                  }
                : {}),
            };
            if (!props.canEdit(record.id)) throw new Error("record_forbidden");
            await props.onSave(record, editing?.version);
            setEditing(null);
            setSaved(true);
          })
        }
      />
      {editing ? (
        <Button
          secondary
          label={copy("取消编辑", "Cancel edit")}
          disabled={busy}
          onPress={() => {
            setEditing(null);
            setDraft(defaults);
            setMinutes(String(defaults.minutes));
            setError("");
          }}
        />
      ) : null}
      {error ? (
        <T raw accessibilityRole="alert">
          {error}
        </T>
      ) : null}
      {saved ? (
        <T raw>
          {copy("已保存，等待家庭同步。", "Saved, waiting for family sync.")}
        </T>
      ) : null}
      <T raw style={{ fontWeight: "700" }}>
        {copy("家庭提醒", "Family reminders")} ({reminders.length})
      </T>
      {!reminders.length ? (
        <T raw style={{ color: c.muted }}>
          {copy("还没有家庭提醒。", "No shared reminders yet.")}
        </T>
      ) : null}
      {reminders.map(({ record, version }) => (
        <View
          key={record.id}
          style={{
            gap: 7,
            borderTopWidth: 1,
            borderColor: c.line,
            paddingTop: 10,
          }}
        >
          <T raw>{record.settings.title || kindLabel(record.settings.kind)}</T>
          <T raw style={{ fontSize: 12, color: c.muted }}>
            {record.settings.mode === "daily"
              ? copy("每天 ", "Daily ") + record.settings.dailyTime
              : record.settings.mode === "after-feed"
                ? copy("喂养开始后 ", "After feed start: ") +
                  record.settings.minutes +
                  copy(" 分钟", " min")
                : new Date(record.onceAt!).toLocaleString(formattingLocale) +
                  (Date.parse(record.onceAt!) <= Date.now()
                    ? copy(" · 已过期", " · Expired")
                    : "")}
          </T>
          <View style={[row, { justifyContent: "flex-end", gap: 8 }]}>
            <RecordActionButton
              action="edit"
              accessibilityLabel={
                copy("编辑家庭提醒：", "Edit family reminder: ") +
                (record.settings.title || kindLabel(record.settings.kind))
              }
              accessibilityHint={copy(
                "打开记录编辑界面",
                "Opens the record editor",
              )}
              disabled={busy || !props.canEdit(record.id)}
              onPress={() => {
                if (!props.canEdit(record.id)) return;
                setEditing({ record, version });
                setDraft(record.settings);
                setMinutes(String(record.settings.minutes));
                setSaved(false);
                setError("");
              }}
            />
            <RecordActionButton
              action="delete"
              accessibilityLabel={
                copy("删除家庭提醒：", "Delete family reminder: ") +
                (record.settings.title || kindLabel(record.settings.kind))
              }
              accessibilityHint={copy(
                "打开删除确认",
                "Opens a confirmation before deleting",
              )}
              disabled={busy || !props.canEdit(record.id)}
              onPress={() => {
                if (props.canEdit(record.id))
                  setDeleting({ id: record.id, version });
              }}
            />
          </View>
          {!props.canEdit(record.id) ? (
            <T raw style={{ fontSize: 12, color: c.muted }}>
              {copy(
                "仅记录人或管理员可修改；同步中的提醒请稍候。",
                "Only its author or admin can change this reminder. Wait if a change is syncing.",
              )}
            </T>
          ) : null}
          {deleting?.id === record.id ? (
            <View style={{ gap: 8 }}>
              <T raw accessibilityRole="alert">
                {copy(
                  "从整个家庭删除这个提醒？所有成员的设备联网刷新后会停止该提醒。",
                  "Delete this reminder for the whole family? Devices stop it after reconnecting and refreshing.",
                )}
              </T>
              <Button
                label={copy("确认删除", "Confirm delete")}
                disabled={busy || !props.canEdit(record.id)}
                onPress={() =>
                  run(async () => {
                    if (!props.canEdit(record.id))
                      throw new Error("record_forbidden");
                    await props.onDelete(deleting.id, deleting.version);
                    setDeleting(null);
                  })
                }
              />
              <Button
                secondary
                label={copy("取消", "Cancel")}
                disabled={busy}
                onPress={() => setDeleting(null)}
              />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
