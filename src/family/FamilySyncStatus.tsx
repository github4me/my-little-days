import React, { useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Modal from "../AccessibleModal";
import { SafeAreaView } from "react-native-safe-area-context";
import { localize, useI18n, type AppLocale } from "../i18n";
import { Button, Card, T, Theme } from "../ui";
import {
  familyErrorMessage,
  familyNoticeMessage,
  fullFamilyMessage,
} from "./messages";
import type { QueuedRecord } from "./fullState";
import type { useFamilyPilot } from "./useFamilyPilot";
import { conflictMessage } from "./conflictMessages";
import {
  dismissSyncIssues,
  familySyncIssues,
  initialSyncPresentation,
  updateSyncPresentation,
  visibleSyncIssues,
  type FamilySyncIssue,
} from "./syncIssues";

type Pilot = ReturnType<typeof useFamilyPilot>;

function sharingText(text: string) {
  return text
    .replaceAll("试点", "家庭共享")
    .replaceAll("pilot", "family sharing");
}

function conflictOperationId(issue: FamilySyncIssue) {
  if (!issue.kind.endsWith("conflict")) return null;
  try {
    const key = JSON.parse(issue.key);
    return Array.isArray(key) && typeof key[1] === "string" ? key[1] : null;
  } catch {
    return null;
  }
}

function reviewableRecordConflicts(pilot: Pilot) {
  const snapshot = pilot.fullSnapshot;
  if (
    pilot.authStatus !== "authenticated" ||
    !pilot.ready ||
    pilot.transitionPending ||
    !snapshot ||
    !pilot.user
  )
    return [];
  return pilot.recordConflicts.filter(
    (item) =>
      item.origin.userId === pilot.user!.id &&
      item.origin.familyId === snapshot.family.id &&
      item.origin.membershipId === snapshot.family.membershipId &&
      item.origin.historyId === snapshot.historyId,
  );
}

function timerConflictMessage(
  item: QueuedRecord,
  pilot: Pilot,
  locale: AppLocale,
  formattingLocale: string,
) {
  const kind = item.operation.entry?.type;
  const snapshot = pilot.fullSnapshot;
  if ((kind !== "feed" && kind !== "sleep") || !snapshot)
    return familyErrorMessage(locale, "active_timer_conflict");
  const active = snapshot.entries.find(({ entry }) =>
    kind === "sleep"
      ? entry.type === "sleep" && !entry.end
      : entry.type === "feed" && entry.feedRunning === true && !entry.end,
  );
  if (!active) return familyErrorMessage(locale, "active_timer_conflict");
  const starter =
    snapshot.members.find((member) => member.id === active.recordedBy)
      ?.displayName || fullFamilyMessage(locale, "memberFallback");
  const startedAt = new Date(active.entry.start);
  if (!Number.isFinite(startedAt.getTime()))
    return familyErrorMessage(locale, "active_timer_conflict");
  const time = startedAt.toLocaleTimeString(formattingLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return localize(
    "{starter} 已于 {time} 开始{kind}计时，目前仍在进行。你这次开始未共享，已保留在本机。返回“今天”可结束现有计时。",
    "{starter} started the {kind} timer at {time}, and it is still ongoing. Your new timer was not shared and is preserved on this device. Return to Today to finish the ongoing timer.",
    {
      starter,
      time,
      kind:
        kind === "sleep"
          ? localize("睡眠", "sleep", undefined, locale)
          : localize("喂养", "feeding", undefined, locale),
    },
    locale,
  );
}

function timerAlreadyFinishedMessage(
  item: QueuedRecord,
  pilot: Pilot,
  locale: AppLocale,
  formattingLocale: string,
) {
  const kind = item.timerCompletion ?? item.operation.entry?.type;
  const record = pilot.fullSnapshot?.entries.find(
    ({ entry }) => entry.id === item.operation.recordId,
  );
  if ((kind !== "sleep" && kind !== "feed") || !record || !record.entry.end)
    return familyErrorMessage(locale, "timer_already_finished");
  const fallback = fullFamilyMessage(locale, "memberFallback");
  const starter =
    pilot.fullSnapshot?.members.find(
      (member) => member.id === record.recordedBy,
    )?.displayName || fallback;
  const finisher =
    pilot.fullSnapshot?.members.find(
      (member) => member.id === (record.endedBy ?? record.lastEditedBy),
    )?.displayName || fallback;
  const endedAt = new Date(record.entry.end);
  if (!Number.isFinite(endedAt.getTime()))
    return familyErrorMessage(locale, "timer_already_finished");
  const time = endedAt.toLocaleTimeString(formattingLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return localize(
    "{finisher} 已于 {time} 结束由 {starter} 开始的{kind}计时。最新家庭记录已保留；你选择的结束时间没有覆盖它，并保留在本机供检查。",
    "{finisher} finished the {kind} timer started by {starter} at {time}. The latest family record is kept; your chosen end time did not overwrite it and remains on this device for review.",
    {
      finisher,
      starter,
      time,
      kind:
        kind === "sleep"
          ? localize("睡眠", "sleep", undefined, locale)
          : localize("喂养", "feeding", undefined, locale),
    },
    locale,
  );
}

function IssueMessages({
  issues,
  pilot,
}: {
  issues: FamilySyncIssue[];
  pilot: Pilot;
}) {
  const { locale, formattingLocale, localize: text } = useI18n();
  const conflicts = issues.filter((issue) => issue.kind.endsWith("conflict"));
  const activeTimerConflicts = conflicts.filter(
    (issue) => issue.code === "active_timer_conflict",
  );
  const finishedTimerConflicts = conflicts.filter(
    (issue) => issue.code === "timer_already_finished",
  );
  const hasOtherConflicts = conflicts.some(
    (issue) =>
      issue.code !== "active_timer_conflict" &&
      issue.code !== "timer_already_finished",
  );
  const reviewable = reviewableRecordConflicts(pilot);
  return (
    <>
      {issues
        .filter(
          (issue) =>
            (issue.kind === "error" || issue.kind === "notice") &&
            !(conflicts.length && issue.code === "change_not_shared") &&
            !(
              activeTimerConflicts.length &&
              issue.kind === "error" &&
              issue.code === "active_timer_conflict"
            ) &&
            !(
              finishedTimerConflicts.length &&
              issue.kind === "error" &&
              issue.code === "timer_already_finished"
            ),
        )
        .map((issue) => (
          <T raw key={issue.key}>
            {sharingText(
              issue.kind === "error"
                ? familyErrorMessage(locale, issue.code)
                : (familyNoticeMessage(locale, issue.code) ?? ""),
            )}
          </T>
        ))}
      {activeTimerConflicts.map((issue) => {
        const operationId = conflictOperationId(issue);
        const item = operationId
          ? reviewable.find(
              (conflict) => conflict.operation.operationId === operationId,
            )
          : undefined;
        return (
          <T raw key={`active:${issue.key}`}>
            {item
              ? timerConflictMessage(item, pilot, locale, formattingLocale)
              : familyErrorMessage(locale, "active_timer_conflict")}
          </T>
        );
      })}
      {finishedTimerConflicts.map((issue) => {
        const operationId = conflictOperationId(issue);
        const item = operationId
          ? reviewable.find(
              (conflict) => conflict.operation.operationId === operationId,
            )
          : undefined;
        return (
          <T raw key={`finished:${issue.key}`}>
            {item
              ? timerAlreadyFinishedMessage(
                  item,
                  pilot,
                  locale,
                  formattingLocale,
                )
              : familyErrorMessage(locale, "timer_already_finished")}
          </T>
        );
      })}
      {hasOtherConflicts ? (
        <T raw>
          {text(
            "部分修改未能共享，已保留在此设备上。请查看最新记录，再决定如何处理。",
            "Some changes could not be shared and are preserved on this device. Review the latest records before deciding what to do.",
          )}
        </T>
      ) : null}
    </>
  );
}

export function FamilySyncBanner({
  pilot,
  onOpenFamily,
}: {
  pilot: Pilot;
  onOpenFamily: () => void;
}) {
  const c = useContext(Theme);
  const { localize: text } = useI18n();
  const [presentation, setPresentation] = useState(initialSyncPresentation);
  const current = updateSyncPresentation(presentation, pilot);
  const issues = visibleSyncIssues(current, pilot);
  useEffect(() => {
    if (current !== presentation) setPresentation(current);
  }, [current, presentation]);

  if (!issues.length) return null;
  return (
    <View testID="family-sync-banner">
      <Card style={styles.card}>
        <View style={styles.headingRow}>
          <T raw style={styles.heading}>
            {text("家庭共享需要处理", "Family sharing needs attention")}
          </T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={text(
              "关闭家庭共享提示",
              "Dismiss family sharing notice",
            )}
            accessibilityHint={text(
              "仅隐藏提示；未发送修改和冲突草稿会保留。",
              "Hides this notice. Unsent changes and preserved drafts are kept.",
            )}
            onPress={() => setPresentation(dismissSyncIssues(current, pilot))}
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: c.soft, opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <T raw style={styles.closeText}>
              ×
            </T>
          </Pressable>
        </View>
        <View accessibilityLiveRegion="polite" style={styles.stack}>
          <IssueMessages issues={issues} pilot={pilot} />
        </View>
        <Button
          secondary
          label={text("查看家庭共享", "Review family sharing")}
          onPress={onOpenFamily}
        />
      </Card>
    </View>
  );
}

const recordLabels: Record<string, [string, string]> = {
  feed: ["喂养", "Feed"],
  diaper: ["尿布", "Diaper"],
  sleep: ["睡眠", "Sleep"],
  growth: ["成长", "Growth"],
  milestone: ["里程碑", "Milestone"],
  temperature: ["体温", "Temperature"],
  bath: ["洗澡", "Bath"],
  wash: ["清洁", "Wash"],
  oral: ["口腔护理", "Oral care"],
  nails: ["指甲护理", "Nail care"],
  avatar: ["宝宝头像", "Baby photo"],
  "play-selection": ["早教设置", "Play settings"],
  "play-checkin": ["早教打卡", "Play check-in"],
  reminder: ["提醒", "Reminder"],
  "reminder-settings": ["提醒设置", "Reminder settings"],
};

function recordDescription(
  item: QueuedRecord,
  locale: AppLocale,
  formattingLocale: string,
) {
  const { operation } = item;
  const kind =
    operation.entry?.type ??
    operation.careRecord?.kind ??
    operation.extraRecord?.kind;
  const labelPair = kind ? recordLabels[kind] : null;
  const label = labelPair
    ? localize(labelPair[0], labelPair[1], undefined, locale)
    : null;
  const action =
    operation.kind === "delete"
      ? localize("删除", "Delete", undefined, locale)
      : operation.kind === "create"
        ? localize("新增", "Create", undefined, locale)
        : localize("修改", "Edit", undefined, locale);
  const time = operation.entry?.start ?? operation.careRecord?.time;
  const displayedTime =
    time && Number.isFinite(Date.parse(time))
      ? new Date(time).toLocaleString(formattingLocale)
      : null;
  return [
    action,
    label ?? localize("记录", "Record", undefined, locale),
    displayedTime,
  ]
    .filter(Boolean)
    .join(" · ");
}

type SelectedConflict = {
  item: QueuedRecord;
  reviewedVersion: string;
};

function currentConflictRecord(pilot: Pilot, item: QueuedRecord) {
  const proposed = item.operation.entry;
  if (
    !item.serverConflict ||
    item.operation.collection !== "entry" ||
    item.operation.kind !== "update" ||
    !proposed ||
    (proposed.type !== "feed" && proposed.type !== "sleep")
  )
    return undefined;
  const current = pilot.fullSnapshot?.entries.find(
    ({ entry }) => entry.id === item.operation.recordId,
  );
  return current?.entry.type === proposed.type &&
    current.version !== item.operation.baseVersion
    ? current
    : undefined;
}

function openConflict(
  pilot: Pilot,
  item: QueuedRecord,
): SelectedConflict | null {
  const current = currentConflictRecord(pilot, item);
  return current ? { item, reviewedVersion: current.version } : null;
}

function displayConflictTime(value: string, formattingLocale: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(formattingLocale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : value;
}

function conflictEntryLines(
  entry: NonNullable<QueuedRecord["operation"]["entry"]>,
  locale: AppLocale,
  formattingLocale: string,
) {
  const message = (key: Parameters<typeof conflictMessage>[1]) =>
    conflictMessage(locale, key);
  const lines = [
    {
      label: message("start"),
      value: displayConflictTime(entry.start, formattingLocale),
    },
    {
      label: message("end"),
      value: entry.end
        ? displayConflictTime(entry.end, formattingLocale)
        : message("ongoing"),
    },
  ];
  if (entry.type === "feed" && entry.amount !== undefined)
    lines.push({ label: message("amount"), value: `${entry.amount} mL` });
  if (entry.note)
    lines.push({
      label: message("notes"),
      value:
        entry.note.length > 240 ? `${entry.note.slice(0, 240)}…` : entry.note,
    });
  return lines;
}

function ConflictVersionCard({
  title,
  actor,
  entry,
  locale,
  formattingLocale,
}: {
  title: string;
  actor?: string;
  entry: NonNullable<QueuedRecord["operation"]["entry"]>;
  locale: AppLocale;
  formattingLocale: string;
}) {
  const c = useContext(Theme);
  return (
    <View style={[styles.versionCard, { borderColor: c.line }]}>
      <T raw style={styles.versionTitle}>
        {title}
      </T>
      {actor ? (
        <T raw style={{ color: c.muted }}>
          {conflictMessage(locale, "changedBy", { name: actor })}
        </T>
      ) : null}
      {conflictEntryLines(entry, locale, formattingLocale).map((line) => (
        <View key={line.label} style={styles.detailRow}>
          <T raw style={[styles.detailLabel, { color: c.muted }]}>
            {line.label}
          </T>
          <T raw style={styles.detailValue}>
            {line.value}
          </T>
        </View>
      ))}
    </View>
  );
}

function ConflictResolutionModal({
  pilot,
  selected,
  onClose,
}: {
  pilot: Pilot;
  selected: SelectedConflict | null;
  onClose: () => void;
}) {
  const c = useContext(Theme);
  const { width } = useWindowDimensions();
  const { locale, formattingLocale } = useI18n();
  const [busy, setBusy] = useState<"keep" | "replace" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const item = selected?.item;
  const current = item ? currentConflictRecord(pilot, item) : undefined;
  const proposed = item?.operation.entry;
  const currentActor = current
    ? (pilot.fullSnapshot?.members.find(
        (member) => member.id === current.lastEditedBy,
      )?.displayName ?? conflictMessage(locale, "unknownMember"))
    : conflictMessage(locale, "unknownMember");
  const changedAgain =
    !!selected && !!current && current.version !== selected.reviewedVersion;
  const replaceAllowed =
    !!item &&
    !!current &&
    !!proposed &&
    !changedAgain &&
    pilot.canReplaceRecordConflict(item.operation.operationId);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const fail = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : "request_failed";
    setError(
      code === "conflict_resolution_changed"
        ? conflictMessage(locale, "changedAgain")
        : code === "conflict_resolution_unavailable"
          ? conflictMessage(locale, "unavailable")
          : sharingText(familyErrorMessage(locale, code)),
    );
  };
  const resolve = (resolution: "keep" | "replace") => {
    if (!item || busy || (resolution === "replace" && !replaceAllowed)) return;
    setBusy(resolution);
    setError(null);
    const action =
      resolution === "replace"
        ? pilot.replaceRecordConflict(
            item.operation.operationId,
            selected?.reviewedVersion,
          )
        : pilot.discardRecordConflict(item.operation.operationId);
    void action.then(onClose, fail).finally(() => setBusy(null));
  };

  return (
    <Modal
      visible={!!selected}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <SafeAreaView
        style={[
          styles.backdrop,
          { justifyContent: width >= 600 ? "center" : "flex-end" },
        ]}
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.modal,
            styles.conflictModal,
            { backgroundColor: c.elevated },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.stack}
            keyboardShouldPersistTaps="handled"
          >
            <T raw accessibilityRole="header" style={styles.heading}>
              {conflictMessage(locale, "title")}
            </T>
            <T raw>{conflictMessage(locale, "explanation")}</T>
            {current && proposed ? (
              <>
                <ConflictVersionCard
                  title={conflictMessage(locale, "familyVersion")}
                  actor={currentActor}
                  entry={current.entry}
                  locale={locale}
                  formattingLocale={formattingLocale}
                />
                <ConflictVersionCard
                  title={conflictMessage(locale, "yourChange")}
                  entry={proposed}
                  locale={locale}
                  formattingLocale={formattingLocale}
                />
              </>
            ) : null}
            {changedAgain ? (
              <T raw accessibilityRole="alert" style={{ color: c.danger }}>
                {conflictMessage(locale, "changedAgain")}
              </T>
            ) : !replaceAllowed && selected ? (
              <T raw style={{ color: c.muted }}>
                {conflictMessage(locale, "unavailable")}
              </T>
            ) : null}
            {error ? (
              <T raw accessibilityRole="alert" style={{ color: c.danger }}>
                {error}
              </T>
            ) : null}
            <Button
              secondary
              label={conflictMessage(locale, "keep")}
              busy={busy === "keep"}
              disabled={!!busy || !item}
              onPress={() => resolve("keep")}
            />
            {replaceAllowed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={conflictMessage(locale, "replace")}
                accessibilityState={{
                  disabled: !!busy,
                  busy: busy === "replace",
                }}
                disabled={!!busy}
                onPress={() => resolve("replace")}
                style={({ pressed }) => [
                  styles.destructiveButton,
                  {
                    backgroundColor: c.danger,
                    opacity: busy ? 0.65 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                {busy === "replace" ? (
                  <ActivityIndicator accessible={false} color={c.onPrimary} />
                ) : null}
                <T
                  raw
                  style={{
                    color: c.onPrimary,
                    fontWeight: "600",
                    textAlign: "center",
                    flexShrink: 1,
                  }}
                >
                  {conflictMessage(locale, "replace")}
                </T>
              </Pressable>
            ) : null}
            <Button
              secondary
              label={conflictMessage(locale, "later")}
              disabled={!!busy}
              onPress={close}
            />
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export function FamilyConflictPrompt({ pilot }: { pilot: Pilot }) {
  const [selected, setSelected] = useState<SelectedConflict | null>(null);
  const observedContext = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const snapshot = pilot.fullSnapshot;
  const context =
    pilot.authStatus === "authenticated" &&
    pilot.ready &&
    snapshot &&
    pilot.user
      ? `${pilot.user.id}|${snapshot.family.id}|${snapshot.family.membershipId}|${snapshot.historyId}`
      : null;
  const candidates = reviewableRecordConflicts(pilot).filter((item) =>
    Boolean(currentConflictRecord(pilot, item)),
  );

  useEffect(() => {
    if (!context) {
      observedContext.current = null;
      seen.current = new Set();
      setSelected(null);
      return;
    }
    const ids = candidates.map((item) => item.operation.operationId);
    if (observedContext.current !== context) {
      observedContext.current = context;
      seen.current = new Set(ids);
      setSelected(null);
      return;
    }
    const newlyConflicted = candidates.find(
      (item) => !seen.current.has(item.operation.operationId),
    );
    if (!selected && newlyConflicted) {
      seen.current.add(newlyConflicted.operation.operationId);
      setSelected(openConflict(pilot, newlyConflicted));
    }
  }, [candidates, context, pilot, selected]);

  return (
    <ConflictResolutionModal
      pilot={pilot}
      selected={selected}
      onClose={() => setSelected(null)}
    />
  );
}

export function FamilySyncDetails({ pilot }: { pilot: Pilot }) {
  const c = useContext(Theme);
  const { locale, formattingLocale, localize: text } = useI18n();
  const [discard, setDiscard] = useState<{
    operationId: string;
    origin: string;
  } | null>(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SelectedConflict | null>(null);
  const issues = familySyncIssues(pilot);
  const snapshot = pilot.fullSnapshot;
  const canReview =
    pilot.authStatus === "authenticated" &&
    pilot.ready &&
    !pilot.transitionPending &&
    !!snapshot &&
    !!pilot.user;
  const recordConflicts = canReview ? reviewableRecordConflicts(pilot) : [];
  const selected =
    discard &&
    recordConflicts.find(
      (item) =>
        item.operation.operationId === discard.operationId &&
        JSON.stringify(item.origin) === discard.origin,
    );
  const busy = pilot.busy || discardBusy;
  const canDiscard = canReview && !busy;

  useEffect(() => {
    if (discard && !selected) setDiscard(null);
  }, [discard, selected]);

  if (!issues.length) return null;
  return (
    <View testID="family-sync-details" style={styles.stack}>
      <Card style={styles.card}>
        <T raw accessibilityRole="header" style={styles.heading}>
          {fullFamilyMessage(locale, "sharingIssuesTitle")}
        </T>
        <View accessibilityLiveRegion="polite" style={styles.stack}>
          <IssueMessages issues={issues} pilot={pilot} />
        </View>
        {recordConflicts.some((item) => currentConflictRecord(pilot, item)) ? (
          <T raw style={{ color: c.muted }}>
            {text(
              "请逐条打开“检查冲突”，比较当前家庭版本和你的修改。替换需等待服务器确认；确认前记录和柱状图仍显示家庭版本。",
              "Open Review conflict for each item and compare the family version with your change. A replacement waits for server confirmation; records and charts keep showing the family version until then.",
            )}
          </T>
        ) : null}
        {recordConflicts.some(
          (item) =>
            item.error !== "active_timer_conflict" &&
            !currentConflictRecord(pilot, item),
        ) ? (
          <T raw style={{ color: c.muted }}>
            {text(
              "这些修改不会自动重发。请回到记录页面，重新打开最新记录查看后修改。丢弃只会删除此设备上保留的修改，不会更改家庭已共享的记录。",
              "These changes will not retry automatically. Return to your records and reopen the latest record to review and edit it. Discarding removes only the preserved change on this device; shared family records stay unchanged.",
            )}
          </T>
        ) : null}
        {recordConflicts.map((item) => (
          <View
            key={item.operation.operationId}
            style={[styles.conflict, { borderColor: c.line }]}
          >
            <T raw style={{ fontWeight: "600" }}>
              {recordDescription(item, locale, formattingLocale)}
            </T>
            {item.error === "active_timer_conflict" ||
            item.error === "timer_already_finished" ? null : (
              <T raw>
                {sharingText(
                  familyErrorMessage(locale, item.error ?? "record_changed"),
                )}
              </T>
            )}
            {item.operation.entry?.note || item.operation.careRecord?.note ? (
              <T raw style={{ color: c.muted }}>
                {item.operation.entry?.note ?? item.operation.careRecord?.note}
              </T>
            ) : null}
            {currentConflictRecord(pilot, item) ? (
              <Button
                label={conflictMessage(locale, "review")}
                disabled={!canReview || busy}
                onPress={() => {
                  if (!canReview || busy) return;
                  setConflict(openConflict(pilot, item));
                }}
              />
            ) : (
              <Button
                secondary
                label={fullFamilyMessage(locale, "discardPreserved")}
                disabled={!canDiscard}
                onPress={() => {
                  if (!canDiscard) return;
                  setDiscardError(null);
                  setDiscard({
                    operationId: item.operation.operationId,
                    origin: JSON.stringify(item.origin),
                  });
                }}
              />
            )}
          </View>
        ))}
      </Card>
      <ConflictResolutionModal
        pilot={pilot}
        selected={conflict}
        onClose={() => setConflict(null)}
      />
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setDiscard(null);
        }}
      >
        <SafeAreaView style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={[styles.modal, { backgroundColor: c.elevated }]}
          >
            <ScrollView contentContainerStyle={styles.stack}>
              <T raw accessibilityRole="header" style={styles.heading}>
                {fullFamilyMessage(locale, "discardPreservedTitle")}
              </T>
              <T raw>
                {fullFamilyMessage(locale, "discardPreservedDescription")}
              </T>
              {selected ? (
                <T raw style={{ color: c.muted }}>
                  {recordDescription(selected, locale, formattingLocale)}
                </T>
              ) : null}
              {discardError ? (
                <T raw accessibilityRole="alert">
                  {discardError}
                </T>
              ) : null}
              <Button
                label={fullFamilyMessage(
                  locale,
                  busy ? "working" : "discardPreserved",
                )}
                disabled={!canDiscard || !selected}
                onPress={() => {
                  if (!canDiscard || !selected) return;
                  setDiscardBusy(true);
                  setDiscardError(null);
                  void pilot
                    .discardRecordConflict(selected.operation.operationId)
                    .then(
                      () => setDiscard(null),
                      (cause: unknown) =>
                        setDiscardError(
                          sharingText(
                            familyErrorMessage(
                              locale,
                              cause instanceof Error
                                ? cause.message
                                : "request_failed",
                            ),
                          ),
                        ),
                    )
                    .finally(() => setDiscardBusy(false));
                }}
              />
              <Button
                secondary
                label={fullFamilyMessage(locale, "cancel")}
                disabled={busy}
                onPress={() => setDiscard(null)}
              />
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 20, gap: 12 },
  stack: { gap: 12 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heading: {
    flex: 1,
    flexShrink: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  closeText: { fontSize: 24, lineHeight: 28 },
  conflict: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  versionCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  versionTitle: { fontWeight: "700" },
  detailRow: { gap: 2 },
  detailLabel: { fontSize: 14, lineHeight: 19 },
  detailValue: { flexShrink: 1 },
  destructiveButton: {
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  backdrop: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modal: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "100%",
    alignSelf: "center",
    borderRadius: 24,
    padding: 20,
  },
  conflictModal: { borderRadius: 24 },
});
