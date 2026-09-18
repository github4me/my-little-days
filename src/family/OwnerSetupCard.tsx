import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Modal from "../AccessibleModal";
import type { State } from "../domain";
import { useI18n } from "../i18n";
import { Button, Card, T, Theme } from "../ui";
import {
  familyMessage,
  fullFamilyMessage,
  type FamilyMessageKey,
} from "./messages";
import type { OwnerSeedDraft, OwnerSeedSummary } from "./ownerSeed";
import { MAX_INVITED_FAMILY_MEMBERS } from "./invitationCapacity";
import { extraRecordCounts } from "./extras";

const countLabels = [
  ["feed", "ownerCountFeed"],
  ["diaper", "ownerCountDiaper"],
  ["sleep", "ownerCountSleep"],
  ["growth", "ownerCountGrowth"],
  ["milestone", "ownerCountMilestone"],
  ["care", "ownerCountCare"],
] as const;

export function OwnerSeedCountsView({
  summary,
}: {
  summary: OwnerSeedSummary;
}) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  return (
    <View style={styles.counts}>
      {countLabels.map(([key, label]) => (
        <View key={key} style={[styles.count, { borderColor: c.line }]}>
          <T raw style={{ color: c.muted, fontSize: 13, flexShrink: 1 }}>
            {familyMessage(locale, label)}
          </T>
          <T raw style={{ fontSize: 16, fontWeight: "600" }}>
            {summary.counts[key]}
          </T>
        </View>
      ))}
    </View>
  );
}

export type OwnerSetupCardProps = {
  mode: "demo" | "local-only" | "full";
  profile: State["profile"];
  summary: OwnerSeedSummary;
  pending?: OwnerSeedDraft | null;
  pendingInvitationCount?: number;
  onPrepare: (emailsText: string) => Promise<OwnerSeedDraft>;
  onSave: (draft: OwnerSeedDraft) => Promise<void>;
  onDiscard?: () => Promise<void>;
};

// Presentation only: this component never reads auth, storage or app records,
// and cannot activate a family or upload anything on its own.
export default function OwnerSetupCard({
  mode,
  profile,
  summary,
  pending,
  pendingInvitationCount = 0,
  onPrepare,
  onSave,
  onDiscard,
}: OwnerSetupCardProps) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const m = (key: FamilyMessageKey) =>
    mode === "full"
      ? fullFamilyMessage(locale, key)
      : familyMessage(locale, key);
  const [expanded, setExpanded] = useState(false);
  const createsFamily = mode === "full" || mode === "demo";
  const consentLabel =
    m("ownerConsent") + (createsFamily ? ` ${m("ownerDeclineConsent")}` : "");
  const [emails, setEmails] = useState(
    () => pending?.inviteeEmails.join("\n") ?? "",
  );
  const [review, setReview] = useState<OwnerSeedDraft | null>(null);
  const [consent, setConsent] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FamilyMessageKey | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (pending) setEmails(pending.inviteeEmails.join("\n"));
  }, [pending]);

  async function act(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      if (mounted.current)
        setError(
          code.startsWith("legacy_reminder_")
            ? "ownerLegacyReminderError"
            : [
                  "avatar_read_failed",
                  "invalid_extra_record",
                  "owner_extra_read_failed",
                ].includes(code)
              ? "ownerExtraReadError"
              : code === "owner_active_timer"
                ? "ownerTimerError"
                : [
                      "owner_source_changed",
                      "owner_data_changed",
                      "owner_setup_changed",
                    ].includes(code)
                  ? "ownerChangedError"
                  : [
                        "owner_invalid_email",
                        "owner_self_invite",
                        "owner_recipient_limit",
                      ].includes(code)
                    ? "ownerEmailError"
                    : code === "invitation_decline_consent_required"
                      ? "errorDeclineConsent"
                      : "ownerGenericError",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const close = () => {
    if (lock.current) return;
    setReview(null);
    setDiscarding(false);
    setConsent(false);
    setError(null);
  };
  const body = (value: string) => (
    <T raw style={styles.body}>
      {value}
    </T>
  );
  const profileView = (value: State["profile"]) => (
    <View style={{ gap: 2 }}>
      <T raw style={{ color: c.muted, fontSize: 13 }}>
        {m("ownerSetupProfile")}
      </T>
      <T raw style={{ fontWeight: "600", fontSize: 17 }}>
        {value.name}
      </T>
      <T raw style={{ color: c.muted, fontSize: 13 }}>
        {value.birthDate || m("noBirthDate")}
      </T>
    </View>
  );

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={familyMessage(
          locale,
          expanded ? "hideSection" : "showSection",
          { section: m("ownerSetup") },
        )}
        accessibilityState={{ expanded, disabled: busy }}
        aria-expanded={expanded}
        disabled={busy}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.disclosure,
          { opacity: busy ? 0.5 : pressed ? 0.65 : 1 },
        ]}
      >
        <T raw accessibilityRole="header" style={styles.title}>
          {m("ownerSetup")}
        </T>
        <T
          raw
          accessibilityElementsHidden
          style={{ color: c.primary, fontSize: 20 }}
        >
          {expanded ? "−" : "+"}
        </T>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 12 }}>
          {body(m("ownerSetupDescription"))}
          {body(m("ownerCreatorRecommendation"))}
          {createsFamily ? body(m("ownerDeclineWarning")) : null}
          <View style={[styles.notice, { backgroundColor: c.soft }]}>
            {body(
              m(
                mode === "demo"
                  ? "ownerSetupDemoNotice"
                  : "ownerSetupLocalNotice",
              ),
            )}
          </View>
          {profileView(profile)}
          <T raw style={{ fontWeight: "600" }}>
            {m("ownerSetupCounts")}
          </T>
          <OwnerSeedCountsView summary={summary} />
          {body(m("ownerExclusions"))}
          {summary.runningCount > 0 ? (
            <T
              raw
              accessibilityRole="alert"
              style={{ fontWeight: "600", color: c.primary }}
            >
              {m("ownerTimerError")}
            </T>
          ) : null}
          <View style={{ gap: 6 }}>
            <T raw style={{ fontWeight: "600" }}>
              {m("ownerEmails")}
            </T>
            <TextInput
              accessibilityLabel={m("ownerEmails")}
              multiline
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={MAX_INVITED_FAMILY_MEMBERS * 260}
              value={emails}
              onChangeText={setEmails}
              editable={!busy}
              placeholder="family@example.com"
              placeholderTextColor={c.muted}
              keyboardAppearance={c.isDark ? "dark" : "light"}
              selectionColor={c.primary}
              allowFontScaling
              maxFontSizeMultiplier={0}
              accessibilityState={{ disabled: busy }}
              style={[
                styles.input,
                {
                  color: c.text,
                  backgroundColor: c.input,
                  borderColor: c.controlLine,
                },
              ]}
            />
            <T raw style={[styles.body, { color: c.muted }]}>
              {m("ownerEmailsHint")}
            </T>
          </View>
          {pending ? (
            <View style={[styles.notice, { backgroundColor: c.soft }]}>
              <T
                raw
                accessibilityLiveRegion="polite"
                style={{ fontWeight: "600" }}
              >
                {m("ownerDraftSaved")}
              </T>
              {body(m("ownerDraftHint"))}
            </View>
          ) : null}
          {error && !review && !discarding ? (
            <T raw accessibilityRole="alert">
              {m(error)}
            </T>
          ) : null}
          <Button
            label={m(
              busy ? "working" : pending ? "ownerReviewSaved" : "ownerReview",
            )}
            disabled={busy || !emails.trim() || summary.runningCount > 0}
            style={styles.button}
            onPress={() =>
              void act(async () => {
                Keyboard.dismiss();
                const prepared = await onPrepare(emails);
                if (prepared.inviteeEmails.length > MAX_INVITED_FAMILY_MEMBERS)
                  throw new Error("owner_recipient_limit");
                if (mounted.current) {
                  setReview(prepared);
                  setConsent(false);
                }
              })
            }
          />
          {pending && onDiscard ? (
            <Button
              label={m("ownerDiscardSaved")}
              secondary
              disabled={busy}
              style={styles.button}
              onPress={() => {
                setError(null);
                setDiscarding(true);
              }}
            />
          ) : null}
        </View>
      ) : null}
      <Modal
        visible={!!review || discarding}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <SafeAreaView style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalPosition}
          >
            <View
              accessibilityViewIsModal
              style={[styles.modal, { backgroundColor: c.elevated }]}
            >
              <ScrollView
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ gap: 14 }}
                keyboardShouldPersistTaps="handled"
              >
                <T raw accessibilityRole="header" style={styles.modalTitle}>
                  {m(discarding ? "ownerDiscardTitle" : "ownerReviewTitle")}
                </T>
                {discarding ? (
                  body(m("ownerDiscardDescription"))
                ) : review ? (
                  <>
                    <View style={[styles.notice, { backgroundColor: c.soft }]}>
                      {body(
                        m(
                          mode === "demo"
                            ? "ownerSetupDemoNotice"
                            : "ownerSetupLocalNotice",
                        ),
                      )}
                    </View>
                    {profileView(review.source.profile)}
                    <T raw style={{ fontWeight: "600" }}>
                      {familyMessage(locale, "ownerTotalRecords", {
                        count: review.counts.total,
                      })}
                    </T>
                    <OwnerSeedCountsView
                      summary={{ counts: review.counts, runningCount: 0 }}
                    />
                    {review.extrasSchemaVersion === 1 ? (
                      <View style={{ gap: 8 }}>
                        <T raw style={{ fontWeight: "600" }}>
                          {locale === "zh-CN"
                            ? "同时共享的资料"
                            : "Also shared with your family"}
                        </T>
                        {review.extraRecords?.map((record) =>
                          record.kind === "avatar" && record.dataUrl ? (
                            <Image
                              key={record.id}
                              accessibilityLabel={
                                locale === "zh-CN"
                                  ? "待共享的宝宝头像"
                                  : "Baby photo to share"
                              }
                              source={{ uri: record.dataUrl }}
                              style={{
                                width: 72,
                                height: 72,
                                borderRadius: 36,
                              }}
                            />
                          ) : null,
                        )}
                        {(() => {
                          const counts = extraRecordCounts(
                            review.extraRecords ?? [],
                          );
                          const selection = review.extraRecords?.find(
                            (r) => r.kind === "play-selection",
                          );
                          return (
                            <>
                              {body(
                                locale === "zh-CN"
                                  ? `宝宝头像 ${counts.avatar} 张 · 提醒 ${counts.reminders} 条 · 早教打卡 ${counts.playCheckins} 条`
                                  : `${counts.avatar} baby photo · ${counts.reminders} reminders · ${counts.playCheckins} play check-ins`,
                              )}
                              {selection?.kind === "play-selection"
                                ? body(
                                    locale === "zh-CN"
                                      ? `早教设置：默认按月龄推荐，手动选入 ${selection.selection.included.length} 项、排除 ${selection.selection.excluded.length} 项。`
                                      : `Play settings: age-based defaults, ${selection.selection.included.length} manually included and ${selection.selection.excluded.length} excluded.`,
                                  )
                                : null}
                              {counts.reminderSettings
                                ? body(
                                    locale === "zh-CN"
                                      ? "包含上次保存的提醒表单设置。"
                                      : "Includes the last saved reminder form settings.",
                                  )
                                : null}
                            </>
                          );
                        })()}
                        {review.extraRecords?.map((record) =>
                          record.kind === "reminder" ? (
                            <T
                              raw
                              key={record.id}
                              style={{ fontSize: 13, color: c.muted }}
                            >
                              {record.settings.title} ·{" "}
                              {record.onceAt
                                ? new Date(record.onceAt).toLocaleString()
                                : record.settings.mode === "daily"
                                  ? record.settings.dailyTime
                                  : `${record.settings.minutes} min`}
                            </T>
                          ) : null,
                        )}
                      </View>
                    ) : null}
                    <View style={{ gap: 4 }}>
                      <T raw style={{ fontWeight: "600" }}>
                        {familyMessage(locale, "ownerInviteeCount", {
                          count: review.inviteeEmails.length,
                          limit: MAX_INVITED_FAMILY_MEMBERS,
                        })}
                      </T>
                      {review.inviteeEmails.map((email) => (
                        <T raw key={email} style={styles.body}>
                          {email}
                        </T>
                      ))}
                    </View>
                    {body(m("ownerReviewSharing"))}
                    {body(m("ownerCreatorRecommendation"))}
                    {body(m("ownerExclusions"))}
                    {createsFamily ? (
                      <View
                        style={[styles.notice, { backgroundColor: c.soft }]}
                      >
                        {pendingInvitationCount > 0
                          ? body(
                              familyMessage(locale, "ownerPendingCount", {
                                count: pendingInvitationCount,
                              }),
                            )
                          : null}
                        {body(m("ownerDeclineWarning"))}
                      </View>
                    ) : null}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={consentLabel}
                      accessibilityState={{ checked: consent, disabled: busy }}
                      disabled={busy}
                      onPress={() => setConsent((value) => !value)}
                      style={styles.consent}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: c.primary,
                            backgroundColor: consent ? c.soft : c.bg,
                          },
                        ]}
                      >
                        <T
                          raw
                          accessibilityElementsHidden
                          style={{ color: c.primary, fontWeight: "700" }}
                        >
                          {consent ? "✓" : ""}
                        </T>
                      </View>
                      <T raw style={[styles.body, { flex: 1 }]}>
                        {consentLabel}
                      </T>
                    </Pressable>
                  </>
                ) : null}
              </ScrollView>
              <View style={[styles.modalFooter, { borderColor: c.line }]}>
                {error ? (
                  <T raw accessibilityRole="alert" style={styles.body}>
                    {m(error)}
                  </T>
                ) : null}
                <Button
                  label={m(
                    busy
                      ? "working"
                      : discarding
                        ? "ownerDiscardSaved"
                        : mode === "demo" || mode === "full"
                          ? pendingInvitationCount > 0
                            ? "ownerCreateAndDecline"
                            : "ownerCreateDemo"
                          : "ownerSaveLocal",
                  )}
                  disabled={busy || (!discarding && (!review || !consent))}
                  style={styles.button}
                  onPress={() =>
                    void act(async () => {
                      if (discarding && onDiscard) await onDiscard();
                      else if (review && consent) await onSave(review);
                      if (mounted.current) {
                        setReview(null);
                        setDiscarding(false);
                        setConsent(false);
                      }
                    })
                  }
                />
                <Button
                  label={m("cancel")}
                  secondary
                  disabled={busy}
                  style={styles.button}
                  onPress={close}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 20, gap: 12 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: "700", flex: 1 },
  disclosure: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  modalTitle: { fontSize: 22, lineHeight: 29, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 20 },
  notice: { borderRadius: 14, padding: 12, gap: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 108,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  counts: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  count: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 100,
    minHeight: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
  },
  button: { minHeight: 44 },
  consent: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 6,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  modalPosition: { flex: 1, justifyContent: "center", padding: 16 },
  modal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "94%",
    alignSelf: "center",
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  modalFooter: { gap: 10, borderTopWidth: 1, paddingTop: 12, flexShrink: 0 },
});
