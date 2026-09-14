import React, { useContext, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { State } from "../domain";
import { useI18n } from "../i18n";
import { Button, Card, T, Theme } from "../ui";
import { familyMessage, type FamilyMessageKey } from "./messages";
import type { OwnerSeedDraft, OwnerSeedSummary } from "./ownerSeed";

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
  mode: "demo" | "local-only";
  profile: State["profile"];
  summary: OwnerSeedSummary;
  pending?: OwnerSeedDraft | null;
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
  onPrepare,
  onSave,
  onDiscard,
}: OwnerSetupCardProps) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const m = (key: FamilyMessageKey) => familyMessage(locale, key);
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
          code === "owner_active_timer"
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
      <T raw accessibilityRole="header" style={styles.title}>
        {m("ownerSetup")}
      </T>
      {body(m("ownerSetupDescription"))}
      <View style={[styles.notice, { backgroundColor: c.soft }]}>
        {body(
          m(mode === "demo" ? "ownerSetupDemoNotice" : "ownerSetupLocalNotice"),
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
          maxLength={800}
          value={emails}
          onChangeText={setEmails}
          editable={!busy}
          placeholder="family@example.com"
          placeholderTextColor={c.muted}
          style={[
            styles.input,
            { color: c.text, backgroundColor: c.bg, borderColor: c.line },
          ]}
        />
        <T raw style={[styles.body, { color: c.muted }]}>
          {m("ownerEmailsHint")}
        </T>
      </View>
      {pending ? (
        <View style={[styles.notice, { backgroundColor: c.soft }]}>
          <T raw accessibilityLiveRegion="polite" style={{ fontWeight: "600" }}>
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
            const prepared = await onPrepare(emails);
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
              style={[styles.modal, { backgroundColor: c.card }]}
            >
              <ScrollView
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
                    <OwnerSeedCountsView
                      summary={{ counts: review.counts, runningCount: 0 }}
                    />
                    <View style={{ gap: 4 }}>
                      <T raw style={{ fontWeight: "600" }}>
                        {m("ownerEmails")}
                      </T>
                      {review.inviteeEmails.map((email) => (
                        <T raw key={email} style={styles.body}>
                          {email}
                        </T>
                      ))}
                    </View>
                    {body(m("ownerReviewSharing"))}
                    {body(m("ownerExclusions"))}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={m("ownerConsent")}
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
                        {m("ownerConsent")}
                      </T>
                    </Pressable>
                  </>
                ) : null}
                {error ? (
                  <T raw accessibilityRole="alert">
                    {m(error)}
                  </T>
                ) : null}
                <Button
                  label={m(
                    busy
                      ? "working"
                      : discarding
                        ? "ownerDiscardSaved"
                        : mode === "demo"
                          ? "ownerCreateDemo"
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
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 20, gap: 12 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
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
  },
});
