import React, { useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n, type AppLocale } from "../i18n";
import { Button, Card, T, Theme } from "../ui";
import type { SharedFeed } from "./contracts";
import type { FeedDraft } from "./pilotState";
import {
  familyErrorMessage,
  familyMessage,
  fullFamilyMessage,
  familyNoticeMessage,
  type FamilyMessageKey,
} from "./messages";
import type { useFamilyPilot } from "./useFamilyPilot";
import type { OwnerSeedSummary } from "./ownerSeed";
import { OwnerSeedCountsView } from "./OwnerSetupCard";
import { familyInvitationCapacity } from "./invitationCapacity";
import { FamilySyncDetails } from "./FamilySyncStatus";

type Translate = (
  key: FamilyMessageKey,
  values?: Record<string, string | number>,
) => string;
type Confirmation = {
  title: string;
  body: string;
  label: string;
  action: () => Promise<void>;
  acknowledgement?: string;
  allowDuringTransition?: boolean;
  requiresAuthentication: boolean;
};

function Disclosure({
  title,
  children,
  initiallyOpen = false,
  status,
}: {
  title: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
  status?: string;
}) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={familyMessage(
          locale,
          open ? "hideSection" : "showSection",
          { section: title },
        )}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [
          styles.disclosure,
          { opacity: pressed ? 0.65 : 1 },
        ]}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <T raw style={styles.sectionTitle}>
            {title}
          </T>
          {status ? (
            <T
              raw
              accessibilityLiveRegion="polite"
              style={styles.muted(c.muted)}
            >
              {status}
            </T>
          ) : null}
        </View>
        <T
          raw
          accessibilityElementsHidden
          style={{ color: c.primary, fontSize: 20 }}
        >
          {open ? "−" : "+"}
        </T>
      </Pressable>
      {open ? <View style={styles.stack}>{children}</View> : null}
    </Card>
  );
}

function Input({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const c = useContext(Theme);
  return (
    <View style={styles.field}>
      <T raw style={{ fontSize: 13, color: c.muted }}>
        {label}
      </T>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.bg, borderColor: c.line },
          props.style,
        ]}
      />
    </View>
  );
}

function Consent({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled: boolean;
}) {
  const c = useContext(Theme);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        styles.consent,
        { opacity: disabled ? 0.5 : pressed ? 0.65 : 1 },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: checked ? c.soft : c.bg,
            borderColor: checked ? c.primary : c.muted,
          },
        ]}
      >
        <T
          raw
          accessibilityElementsHidden
          style={{ color: c.primary, fontWeight: "700" }}
        >
          {checked ? "✓" : ""}
        </T>
      </View>
      <T raw style={{ flex: 1, fontSize: 13, lineHeight: 20, color: c.muted }}>
        {label}
      </T>
    </Pressable>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");
function localFields(iso: string) {
  const value = new Date(iso);
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

function localISO(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(year, month - 1, day, hour, minute);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  )
    return null;
  return value.toISOString();
}

function displayDate(value: string, locale: AppLocale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function DateFields({
  value,
  dateLabel,
  timeLabel,
  onChange,
  onValidityChange,
  disabled,
}: {
  value: string;
  dateLabel: string;
  timeLabel: string;
  onChange: (iso: string) => void;
  onValidityChange: (valid: boolean) => void;
  disabled: boolean;
}) {
  const c = useContext(Theme);
  const [fields, setFields] = useState(() => localFields(value));
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  useEffect(() => {
    setFields(localFields(value));
    onValidityChange(true);
  }, [value]);
  function update(next: typeof fields) {
    setFields(next);
    const iso = localISO(next.date, next.time);
    onValidityChange(iso !== null);
    if (iso) onChange(iso);
  }
  return (
    <View style={styles.stack}>
      <View style={styles.dateRow}>
        {Platform.OS === "web" ? (
          <>
            <View style={{ flex: 1.25 }}>
              <Input
                label={dateLabel}
                value={fields.date}
                onChangeText={(date) => update({ ...fields, date })}
                placeholder="YYYY-MM-DD"
                maxLength={10}
                editable={!disabled}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label={timeLabel}
                value={fields.time}
                onChangeText={(time) => update({ ...fields, time })}
                placeholder="HH:mm"
                maxLength={5}
                editable={!disabled}
              />
            </View>
          </>
        ) : (
          <>
            <View style={{ flex: 1.25, gap: 4 }}>
              <T raw style={{ color: c.muted, fontSize: 13 }}>
                {dateLabel}
              </T>
              <Button
                label={fields.date}
                secondary
                disabled={disabled}
                onPress={() => setPicker(picker === "date" ? null : "date")}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <T raw style={{ color: c.muted, fontSize: 13 }}>
                {timeLabel}
              </T>
              <Button
                label={fields.time}
                secondary
                disabled={disabled}
                onPress={() => setPicker(picker === "time" ? null : "time")}
              />
            </View>
          </>
        )}
      </View>
      {picker && Platform.OS !== "web" ? (
        <DateTimePicker
          value={new Date(value)}
          mode={picker}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={new Date()}
          is24Hour
          onChange={(event, next) => {
            if (Platform.OS !== "ios" || event.type === "dismissed")
              setPicker(null);
            if (next && event.type !== "dismissed") {
              onValidityChange(true);
              onChange(next.toISOString());
            }
          }}
        />
      ) : null}
    </View>
  );
}

function DraftEditor({
  draft,
  busy,
  canSave,
  m,
  onChange,
  onSave,
  onDiscard,
}: {
  draft: FeedDraft;
  busy: boolean;
  canSave: boolean;
  m: Translate;
  onChange: (draft: FeedDraft) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const c = useContext(Theme);
  const [startValid, setStartValid] = useState(true);
  const [endValid, setEndValid] = useState(true);
  const [validation, setValidation] = useState<FamilyMessageKey | null>(null);
  function save() {
    if (
      !startValid ||
      !endValid ||
      !Number.isFinite(Date.parse(draft.start)) ||
      !Number.isFinite(Date.parse(draft.end))
    )
      return setValidation("errorDate");
    if (Date.parse(draft.end) < Date.parse(draft.start))
      return setValidation("errorEnd");
    if (
      Date.parse(draft.start) > Date.now() + 60000 ||
      Date.parse(draft.end) > Date.now() + 60000
    )
      return setValidation("errorFuture");
    if (!/^\d+$/.test(draft.amount.trim()) || Number(draft.amount) > 2000)
      return setValidation("errorAmount");
    setValidation(null);
    onSave();
  }
  return (
    <Card style={{ ...styles.card, borderColor: c.primary }}>
      <T raw accessibilityRole="header" style={styles.sectionTitle}>
        {m(draft.baseVersion ? "editingFeed" : "privateDraft")}
      </T>
      <T raw style={styles.muted(c.muted)}>
        {m("draftDescription")}
      </T>
      <DateFields
        value={draft.start}
        dateLabel={m("startDate")}
        timeLabel={m("startTime")}
        disabled={busy}
        onValidityChange={setStartValid}
        onChange={(start) => onChange({ ...draft, start })}
      />
      <DateFields
        value={draft.end}
        dateLabel={m("endDate")}
        timeLabel={m("endTime")}
        disabled={busy}
        onValidityChange={setEndValid}
        onChange={(end) => onChange({ ...draft, end })}
      />
      <T raw style={styles.muted(c.muted)}>
        {m("localTimeHint")}
      </T>
      <Input
        label={m("amount")}
        value={draft.amount}
        onChangeText={(amount) => onChange({ ...draft, amount })}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        editable={!busy}
      />
      <T raw style={styles.muted(c.muted)}>
        {m("amountHint")}
      </T>
      <Input
        label={m("note")}
        value={draft.note}
        onChangeText={(note) => onChange({ ...draft, note })}
        placeholder={m("notePlaceholder")}
        maxLength={500}
        multiline
        editable={!busy}
        style={{ minHeight: 72, textAlignVertical: "top" }}
      />
      {validation ? (
        <T raw accessibilityRole="alert">
          {m(validation)}
        </T>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={m(busy ? "saving" : "saveFeed")}
          onPress={save}
          disabled={busy || !canSave}
          style={styles.flexButton}
        />
        <Button
          label={m("discardDraft")}
          secondary
          onPress={onDiscard}
          disabled={busy}
          style={styles.flexButton}
        />
      </View>
    </Card>
  );
}

export default function FamilyScreenView({
  onBack,
  pilot,
  demo = false,
  section = "all",
  ownerSetup,
  initialDataSummary,
}: {
  onBack?: () => void;
  pilot: ReturnType<typeof useFamilyPilot>;
  demo?: boolean;
  section?: "all" | "account" | "family";
  ownerSetup?: React.ReactNode;
  initialDataSummary?: OwnerSeedSummary;
}) {
  const c = useContext(Theme);
  const { locale } = useI18n();
  const m: Translate = (key, values) =>
    demo
      ? familyMessage(locale, key, values)
      : fullFamilyMessage(locale, key, values);
  const [babyName, setBabyName] = useState("");
  const [createConsent, setCreateConsent] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileBirthDate, setProfileBirthDate] = useState("");
  const [recipient, setRecipient] = useState("");
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [localError, setLocalError] = useState<FamilyMessageKey | null>(null);
  const [dismissedFeedback, setDismissedFeedback] = useState<string | null>(
    null,
  );
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );
  const [acting, setActing] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const busy = acting || pilot.busy;
  const authenticated = pilot.authStatus === "authenticated";
  const needsSignIn = pilot.authStatus === "reauth_required";
  const showAccount =
    section !== "family" ||
    !authenticated ||
    pilot.transitionPending ||
    (pilot.sharedMode && !pilot.ready);
  const accountStatusKey: FamilyMessageKey = {
    signed_out: "accountSignedOut",
    checking: "accountChecking",
    authenticated: "accountSignedIn",
    reauth_required: "accountExpired",
    unverified: "accountUnverified",
  }[pilot.authStatus] as FamilyMessageKey;
  const snapshot = pilot.snapshot;
  const inviteCapacity = snapshot
    ? familyInvitationCapacity(snapshot.members, snapshot.invitations)
    : null;
  const replacesPendingInvitation = snapshot?.invitations.some(
    (invite) =>
      invite.status === "pending" &&
      Date.parse(invite.expiresAt) > Date.now() &&
      invite.email.toLowerCase() === recipient.trim().toLowerCase(),
  );
  const invitationAtCapacity =
    inviteCapacity?.remaining === 0 && !replacesPendingInvitation;
  const owner = snapshot?.family.role === "owner";
  const activeMembers =
    snapshot?.members.filter((member) => member.status === "active") ?? [];
  const successors = activeMembers.filter(
    (member) => member.id !== pilot.user?.id,
  );
  const transfer = snapshot?.ownershipTransfer;
  const deletion = pilot.deletionStatus ?? pilot.accountDeletion;
  const workspaceBusy =
    busy || !authenticated || pilot.transitionPending || !!deletion;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setCreatedInvite(null);
    setRecipient("");
  }, [pilot.user?.id, snapshot?.family.id]);
  useEffect(() => {
    setProfileName(snapshot?.family.babyName ?? "");
    setProfileBirthDate(snapshot?.family.babyBirthDate ?? "");
  }, [
    snapshot?.family.id,
    snapshot?.family.babyName,
    snapshot?.family.babyBirthDate,
  ]);

  async function run(action: () => Promise<void>, close = false) {
    if (lock.current) return;
    lock.current = true;
    setActing(true);
    setLocalError(null);
    if (close) setConfirmationError(null);
    try {
      await action();
      if (mounted.current && close) setConfirmation(null);
    } catch (cause) {
      // The controller publishes safe error codes; never show exception payloads.
      if (mounted.current && close)
        setConfirmationError(
          cause instanceof Error && /^[a-z_]+$/.test(cause.message)
            ? cause.message
            : "request_failed",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setActing(false);
    }
  }

  function confirm(
    title: FamilyMessageKey,
    body: string,
    label: FamilyMessageKey,
    action: () => Promise<void>,
    acknowledgement?: FamilyMessageKey,
  ) {
    const requiresAuthentication =
      label !== "signOut" && label !== "discardDraft";
    if (requiresAuthentication && !authenticated) return;
    setConfirmationError(null);
    setAcknowledged(false);
    setConfirmation({
      title: m(title),
      body,
      label: m(label),
      action,
      acknowledgement: acknowledgement ? m(acknowledgement) : undefined,
      allowDuringTransition: label === "signOut",
      requiresAuthentication,
    });
  }

  const memberName = (id: string) =>
    snapshot?.members.find((member) => member.id === id)?.displayName ||
    m("memberFallback");
  const obsoleteAuthError =
    pilot.error === "sign_in_cancelled" ||
    (authenticated &&
      (pilot.error === "sign_in_required" || pilot.error === "unauthorized"));
  const error = localError
    ? m(localError)
    : pilot.error && !obsoleteAuthError
      ? familyErrorMessage(locale, pilot.error)
      : null;
  const notice =
    pilot.notice && (demo || pilot.notice !== "saved_locally")
      ? familyNoticeMessage(locale, pilot.notice)
      : null;
  const feedback = error ?? notice;
  const feedbackKey = feedback
    ? JSON.stringify([
        pilot.user?.id,
        snapshot?.family.id,
        pilot.authStatus,
        localError
          ? ["local", localError]
          : error
            ? ["error", pilot.error]
            : ["notice", pilot.notice],
      ])
    : null;
  useEffect(() => {
    setDismissedFeedback(null);
  }, [feedbackKey]);
  const confirmationAuthBlocked =
    !!confirmation?.requiresAuthentication && !authenticated;
  const modalError = confirmationAuthBlocked
    ? m(needsSignIn ? "accountExpiredAction" : "accountVerifyAction")
    : confirmationError
      ? familyErrorMessage(locale, confirmationError)
      : null;
  const staleDraft =
    !!pilot.draft &&
    !!snapshot &&
    (pilot.draft.historyId !== snapshot.historyId ||
      pilot.draft.membershipId !== snapshot.family.membershipId);
  const draftEditor =
    pilot.draft && snapshot && !staleDraft && !workspaceBusy ? (
      <View style={styles.stack}>
        <DraftEditor
          key={pilot.draft.recordId}
          draft={pilot.draft}
          busy={busy}
          canSave={!!snapshot && !staleDraft}
          m={m}
          onChange={(draft) => {
            void pilot.setDraft(draft).catch(() => {});
          }}
          onSave={() => void run(pilot.saveDraft)}
          onDiscard={() =>
            confirm(
              "discardDraftTitle",
              m("discardDraftDescription"),
              "discardDraft",
              pilot.discardDraft,
            )
          }
        />
      </View>
    ) : null;

  function feedItem(
    feed: SharedFeed & {
      pending?: boolean;
      pendingDelete?: boolean;
      awaitingRefresh?: boolean;
    },
  ) {
    const waiting = feed.pending || feed.pendingDelete || feed.awaitingRefresh;
    const canEdit = owner || feed.recordedBy === pilot.user?.id;
    return (
      <View key={feed.id} style={[styles.listItem, { borderColor: c.line }]}>
        <View style={styles.spread}>
          <T raw style={{ fontSize: 18, fontWeight: "700" }}>
            {feed.amount} mL
          </T>
          {waiting ? (
            <T raw style={{ color: c.primary, fontSize: 13 }}>
              {m(
                feed.awaitingRefresh
                  ? "savedRefreshing"
                  : feed.pendingDelete
                    ? "pendingDelete"
                    : "pendingFeed",
              )}
            </T>
          ) : null}
        </View>
        <T raw>
          {displayDate(feed.start, locale)} — {displayDate(feed.end, locale)}
        </T>
        {feed.note ? (
          <T raw style={styles.muted(c.muted)}>
            {feed.note}
          </T>
        ) : null}
        <T raw style={styles.muted(c.muted)}>
          {m("recordedBy", { name: memberName(feed.recordedBy) })}
        </T>
        {feed.lastEditedBy !== feed.recordedBy ? (
          <T raw style={styles.muted(c.muted)}>
            {m("editedBy", { name: memberName(feed.lastEditedBy) })}
          </T>
        ) : null}
        {canEdit ? (
          <View style={styles.actions}>
            <Button
              label={m("editFeed")}
              secondary
              disabled={workspaceBusy || !!waiting || !!pilot.draft}
              onPress={() => void run(() => pilot.beginFeed(feed))}
              style={styles.flexButton}
            />
            <Button
              label={m("deleteFeed")}
              secondary
              disabled={workspaceBusy || !!waiting || !!pilot.draft}
              onPress={() =>
                confirm(
                  "deleteFeedTitle",
                  m("deleteFeedDescription"),
                  "deleteFeed",
                  () => pilot.deleteFeed(feed.id),
                )
              }
              style={styles.flexButton}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {section !== "account" ? (
        <>
          <View style={styles.spread}>
            <T raw accessibilityRole="header" style={styles.title}>
              {m("title")}
            </T>
            {onBack ? (
              <Button
                label={m("back")}
                secondary
                onPress={onBack}
                style={{ minHeight: 44, paddingHorizontal: 14 }}
              />
            ) : null}
          </View>
          <View style={[styles.notice, { backgroundColor: c.soft }]}>
            <T raw style={{ fontSize: 13, lineHeight: 20 }}>
              {m(demo ? "demoNotice" : "pilotNotice")}
            </T>
          </View>
        </>
      ) : null}

      {feedback && (demo || dismissedFeedback !== feedbackKey) ? (
        <View
          style={[
            styles.notice,
            error
              ? { borderColor: c.primary, borderWidth: 1 }
              : { backgroundColor: c.soft },
          ]}
        >
          <View style={[styles.spread, { alignItems: "flex-start" }]}>
            <T
              raw
              accessibilityRole={error ? "alert" : undefined}
              accessibilityLiveRegion={error ? undefined : "polite"}
              style={{ flex: 1 }}
            >
              {feedback}
            </T>
            {!demo ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  locale === "zh-CN" ? "关闭提示" : "Dismiss message"
                }
                onPress={() => setDismissedFeedback(feedbackKey)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  margin: -8,
                }}
              >
                <T
                  raw
                  accessibilityElementsHidden
                  style={{ color: c.muted, fontSize: 22 }}
                >
                  ×
                </T>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {deletion ? (
        <Card style={styles.card}>
          <T raw accessibilityRole="header" style={styles.sectionTitle}>
            {m(
              pilot.transitionPending
                ? "transitionPending"
                : deletion.status === "completed"
                  ? "deletionComplete"
                  : deletion.status === "awaiting_identity_deletion"
                    ? "deletionIdentity"
                    : "deletionPending",
            )}
          </T>
          {pilot.transitionPending || deletion.status !== "completed" ? (
            <T raw style={styles.muted(c.muted)}>
              {m(
                pilot.transitionPending
                  ? "transitionDescription"
                  : deletion.status === "awaiting_identity_deletion"
                    ? "deletionIdentityDescription"
                    : "deletionPendingDescription",
              )}
            </T>
          ) : null}
          <T raw style={styles.muted(c.muted)}>
            {m("deletionRequestedAt", {
              time: displayDate(deletion.requestedAt, locale),
            })}
          </T>
          <Button
            label={m("checkDeletionStatus")}
            secondary
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await pilot.checkDeletionStatus();
              })
            }
          />
          {deletion.status === "completed" && !pilot.transitionPending ? (
            <Button
              label={m("deletionDone")}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  if (pilot.user) await pilot.signOut();
                  await pilot.dismissDeletionStatus();
                })
              }
            />
          ) : null}
          {pilot.transitionPending && pilot.user ? (
            <Button
              label={m(pilot.syncing ? "refreshing" : "refresh")}
              disabled={busy || pilot.syncing}
              onPress={() => void run(pilot.refresh)}
            />
          ) : null}
          {pilot.user ? (
            <Button
              label={m("signOut")}
              secondary
              disabled={busy || pilot.activationPending}
              onPress={() =>
                confirm(
                  "signOutTitle",
                  m(
                    pilot.transitionPending
                      ? "signOutDuringTransition"
                      : "signOutDescription",
                  ),
                  "signOut",
                  pilot.signOut,
                )
              }
            />
          ) : null}
        </Card>
      ) : !pilot.configured || pilot.webUnsupported ? (
        <Card style={styles.card}>
          <T raw accessibilityRole="header" style={styles.sectionTitle}>
            {m(
              section === "account"
                ? "account"
                : !pilot.configured
                  ? "unconfigured"
                  : "nativeOnly",
            )}
          </T>
          {section === "account" ? (
            <T raw style={styles.muted(c.muted)}>
              {m(!pilot.configured ? "unconfigured" : "nativeOnly")}
            </T>
          ) : null}
          <T raw style={styles.muted(c.muted)}>
            {m(
              !pilot.configured
                ? "unconfiguredDescription"
                : "nativeOnlyDescription",
            )}
          </T>
        </Card>
      ) : !pilot.user ? (
        <Card style={styles.card}>
          <T raw accessibilityRole="header" style={styles.sectionTitle}>
            {m("account")}
          </T>
          <T raw style={styles.muted(c.muted)}>
            {m(accountStatusKey)}
          </T>
          <T raw style={styles.muted(c.muted)}>
            {m("signInDescription")}
          </T>
          <Button
            label={m(
              busy
                ? "working"
                : pilot.error === "sign_out_failed"
                  ? "retrySignOut"
                  : "signIn",
            )}
            disabled={busy}
            onPress={() =>
              void run(
                pilot.error === "sign_out_failed"
                  ? pilot.signOut
                  : pilot.signIn,
              )
            }
          />
        </Card>
      ) : (
        <>
          {showAccount ? (
            <Disclosure
              title={m("account")}
              status={m(accountStatusKey)}
              initiallyOpen={!authenticated}
            >
              <T raw style={{ fontWeight: "600" }}>
                {pilot.user.displayName}
              </T>
              <T raw selectable style={styles.muted(c.muted)}>
                {pilot.user.email}
              </T>
              {!authenticated ? (
                <T raw style={styles.muted(c.muted)}>
                  {m("accountCachedDetails")}
                </T>
              ) : null}
              {needsSignIn ? (
                <>
                  <T raw>{m("accountExpiredAction")}</T>
                  <Button
                    label={m("signInAgain")}
                    disabled={busy}
                    onPress={() => void run(pilot.signIn)}
                  />
                </>
              ) : !snapshot || !authenticated ? (
                <Button
                  label={m(pilot.syncing ? "refreshing" : "refresh")}
                  secondary
                  disabled={
                    busy || pilot.syncing || pilot.authStatus === "checking"
                  }
                  onPress={() => void run(pilot.refresh)}
                />
              ) : null}
              <Button
                label={m("signOut")}
                secondary
                disabled={busy || pilot.activationPending}
                onPress={() =>
                  confirm(
                    "signOutTitle",
                    m(
                      pilot.transitionPending
                        ? "signOutDuringTransition"
                        : pilot.hasPrivateWork
                          ? "signOutWithWork"
                          : "signOutDescription",
                    ),
                    "signOut",
                    pilot.signOut,
                  )
                }
              />
              {!pilot.accountDeletion ? (
                <>
                  <T raw style={styles.muted(c.muted)}>
                    {m(
                      owner
                        ? "deleteAccountBlocked"
                        : "deleteAccountDescription",
                    )}
                  </T>
                  <Button
                    label={m("deleteAccount")}
                    secondary
                    disabled={workspaceBusy || owner}
                    onPress={() =>
                      confirm(
                        "deleteAccountTitle",
                        m("deleteAccountDescription"),
                        "deleteAccount",
                        pilot.deleteAccount,
                        "deleteAccountConsent",
                      )
                    }
                  />
                </>
              ) : null}
            </Disclosure>
          ) : null}

          {pilot.transitionPending ? (
            <Card style={styles.card}>
              <T raw accessibilityRole="header" style={styles.sectionTitle}>
                {m("transitionPending")}
              </T>
              <T raw style={styles.muted(c.muted)}>
                {m("transitionDescription")}
              </T>
              <Button
                label={m(pilot.syncing ? "refreshing" : "refresh")}
                disabled={busy || pilot.syncing}
                onPress={() => void run(pilot.refresh)}
              />
            </Card>
          ) : section === "account" || !authenticated ? null : !demo &&
            pilot.sharedMode &&
            !pilot.ready ? (
            <Card>
              <T raw>
                {locale === "zh-CN"
                  ? "家庭记录暂不可见。请联网刷新权限与完整记录后继续。"
                  : "Family records are hidden until access and the complete history have been refreshed."}
              </T>
              <Button
                label={m("refresh")}
                disabled={busy || pilot.syncing}
                onPress={() => void run(pilot.refresh)}
              />
            </Card>
          ) : !snapshot ? (
            <>
              {section === "family" ? (
                <Button
                  label={m(pilot.syncing ? "refreshing" : "refresh")}
                  secondary
                  disabled={busy || pilot.syncing}
                  onPress={() => void run(pilot.refresh)}
                />
              ) : null}
              <Disclosure
                title={m("joinSection")}
                initiallyOpen={!ownerSetup || !!pilot.inbox.length}
              >
                <T raw style={styles.muted(c.muted)}>
                  {m("joinDescription")}
                </T>
                {!pilot.inbox.length ? (
                  <T raw style={styles.muted(c.muted)}>
                    {m("noIncomingInvitations")}
                  </T>
                ) : (
                  pilot.inbox.map((invitation) => (
                    <View
                      key={invitation.id}
                      style={[styles.listItem, { borderColor: c.line }]}
                    >
                      <T raw style={{ fontWeight: "600" }}>
                        {m("invitedBy", { name: invitation.ownerDisplayName })}
                      </T>
                      <T raw style={styles.muted(c.muted)}>
                        {m("expiresAt", {
                          time: displayDate(invitation.expiresAt, locale),
                        })}
                      </T>
                      <View style={styles.actions}>
                        <Button
                          label={m("acceptInvite")}
                          disabled={workspaceBusy}
                          style={styles.flexButton}
                          onPress={() =>
                            confirm(
                              "acceptInviteTitle",
                              `${m("joinWarning")}\n\n${m("joinDeclineWarning")}`,
                              "acceptInvite",
                              () => pilot.acceptInvitation(invitation.id),
                              "joinConsent",
                            )
                          }
                        />
                        <Button
                          label={m("declineInvite")}
                          secondary
                          disabled={workspaceBusy}
                          style={styles.flexButton}
                          onPress={() =>
                            confirm(
                              "declineInviteTitle",
                              m("declineInviteDescription"),
                              "declineInvite",
                              () => pilot.declineInvitation(invitation.id),
                            )
                          }
                        />
                      </View>
                    </View>
                  ))
                )}
              </Disclosure>
              {ownerSetup ??
                (demo ? (
                  <Disclosure title={m("createSection")}>
                    <T raw style={styles.muted(c.muted)}>
                      {m("oneFamily")}
                    </T>
                    <Input
                      label={m("babyName")}
                      value={babyName}
                      onChangeText={setBabyName}
                      placeholder={m("babyNamePlaceholder")}
                      maxLength={60}
                      editable={!busy}
                    />
                    <Consent
                      checked={createConsent}
                      onChange={setCreateConsent}
                      disabled={busy}
                      label={m("createConsent")}
                    />
                    <Button
                      label={m("createFamily")}
                      disabled={busy || !babyName.trim() || !createConsent}
                      onPress={() =>
                        void run(() => pilot.createFamily(babyName.trim()))
                      }
                    />
                  </Disclosure>
                ) : null)}
            </>
          ) : (
            <>
              <View style={styles.spread}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T raw style={{ fontSize: 18, fontWeight: "700" }}>
                    {snapshot.family.babyName}
                  </T>
                  <T raw style={styles.muted(c.muted)}>
                    {m(owner ? "owner" : "caregiver")}
                  </T>
                </View>
                <Button
                  label={m(pilot.syncing ? "refreshing" : "refresh")}
                  secondary
                  disabled={busy || pilot.syncing}
                  onPress={() => void run(pilot.refresh)}
                  style={{ minHeight: 44, paddingHorizontal: 14 }}
                />
              </View>

              {initialDataSummary ? (
                <Card style={styles.card}>
                  <T raw accessibilityRole="header" style={styles.sectionTitle}>
                    {m("ownerSeededCounts")}
                  </T>
                  <OwnerSeedCountsView summary={initialDataSummary} />
                  <T raw style={styles.muted(c.muted)}>
                    {m("ownerSeededHint")}
                  </T>
                </Card>
              ) : null}

              <Card style={styles.card}>
                <T raw accessibilityRole="header" style={styles.sectionTitle}>
                  {m("ownerSetup")}
                </T>
                <T raw style={styles.muted(c.muted)}>
                  {m(owner ? "createBlockedOwner" : "createBlockedMember")}
                </T>
              </Card>

              {transfer?.toUserId === pilot.user.id ? (
                <Card style={{ ...styles.card, borderColor: c.primary }}>
                  <T raw accessibilityRole="header" style={styles.sectionTitle}>
                    {m("ownershipIncoming")}
                  </T>
                  <T raw style={styles.muted(c.muted)}>
                    {m("ownershipIncomingDescription")}
                  </T>
                  <Button
                    label={m("acceptOwnership")}
                    disabled={workspaceBusy}
                    onPress={() =>
                      confirm(
                        "acceptOwnershipTitle",
                        m("ownershipIncomingDescription"),
                        "acceptOwnership",
                        pilot.acceptOwnership,
                      )
                    }
                  />
                </Card>
              ) : null}

              {pilot.pending.length ? (
                <View style={[styles.notice, { backgroundColor: c.soft }]}>
                  <T
                    raw
                    accessibilityLiveRegion="polite"
                    style={{ fontWeight: "600" }}
                  >
                    {m("pendingCount", { count: pilot.pending.length })}
                  </T>
                  <T raw style={styles.muted(c.muted)}>
                    {m("pendingDescription")}
                  </T>
                </View>
              ) : null}

              {demo ? (
                <>
                  {draftEditor}
                  <Card style={styles.card}>
                    <T
                      raw
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
                      {m("feedSection")}
                    </T>
                    <T raw style={styles.muted(c.muted)}>
                      {m("feedDescription")}
                    </T>
                    {!pilot.draft ? (
                      <Button
                        label={m("addFeed")}
                        disabled={busy}
                        onPress={() => void run(() => pilot.beginFeed())}
                      />
                    ) : null}
                    {!pilot.feeds.length ? (
                      <T raw style={styles.muted(c.muted)}>
                        {m("noFeeds")}
                      </T>
                    ) : (
                      pilot.feeds.map(feedItem)
                    )}
                  </Card>
                </>
              ) : (
                <Card>
                  <T raw>
                    {locale === "zh-CN"
                      ? "所有家庭记录已连接到首页、记录、成长和照护。返回主界面即可记录。"
                      : "All family records are connected to Today, Records, Growth and Care. Return to the main app to add or edit records."}
                  </T>
                </Card>
              )}
            </>
          )}

          {section !== "account" && !demo ? (
            <FamilySyncDetails pilot={pilot} />
          ) : null}

          {section !== "account" &&
          snapshot &&
          !workspaceBusy &&
          pilot.conflicts.length ? (
            <Disclosure
              title={m("preservedSection", { count: pilot.conflicts.length })}
              initiallyOpen
            >
              <T raw style={styles.muted(c.muted)}>
                {m("preservedDescription")}
              </T>
              {pilot.conflicts.map((conflict) => (
                <View
                  key={conflict.operation.operationId}
                  style={[styles.listItem, { borderColor: c.line }]}
                >
                  <T raw>
                    {familyErrorMessage(
                      locale,
                      conflict.error ?? "record_changed",
                    )}
                  </T>
                  {conflict.operation.feed ? (
                    <>
                      <T raw style={{ fontWeight: "600" }}>
                        {conflict.operation.feed.amount} mL
                      </T>
                      <T raw style={styles.muted(c.muted)}>
                        {displayDate(conflict.operation.feed.start, locale)} —{" "}
                        {displayDate(conflict.operation.feed.end, locale)}
                      </T>
                      {conflict.operation.feed.note ? (
                        <T raw>{conflict.operation.feed.note}</T>
                      ) : null}
                    </>
                  ) : (
                    <T raw style={styles.muted(c.muted)}>
                      {m("preservedDelete")}
                    </T>
                  )}
                  <View style={styles.actions}>
                    <Button
                      label={m("discardPreserved")}
                      secondary
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          "discardPreservedTitle",
                          m("discardPreservedDescription"),
                          "discardPreserved",
                          () =>
                            pilot.discardConflict(
                              conflict.operation.operationId,
                            ),
                        )
                      }
                      style={styles.flexButton}
                    />
                  </View>
                </View>
              ))}
            </Disclosure>
          ) : null}

          {section !== "account" &&
          snapshot &&
          !pilot.transitionPending &&
          !pilot.accountDeletion ? (
            <>
              <Disclosure
                title={m("membersCount", { count: snapshot.members.length })}
              >
                <T raw style={styles.muted(c.muted)}>
                  {m("sharingDescription")}
                </T>
                {snapshot.members.map((member) => (
                  <View
                    key={member.membershipId}
                    style={[styles.listItem, { borderColor: c.line }]}
                  >
                    <View style={styles.spread}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T raw style={{ fontWeight: "600" }}>
                          {member.displayName}
                          {member.id === pilot.user?.id ? ` (${m("you")})` : ""}
                        </T>
                        <T raw style={styles.muted(c.muted)}>
                          {m(member.role)} ·{" "}
                          {m(
                            member.status === "left"
                              ? "leftMember"
                              : member.status === "removed"
                                ? "removedMember"
                                : "activeMember",
                          )}
                        </T>
                      </View>
                      {owner &&
                      member.role !== "owner" &&
                      member.status === "active" ? (
                        <Button
                          label={m("remove")}
                          secondary
                          disabled={busy}
                          onPress={() =>
                            confirm(
                              "removeTitle",
                              m("removeDescription", {
                                name: member.displayName,
                              }),
                              "remove",
                              () => pilot.removeMember(member.id),
                            )
                          }
                          style={{ minHeight: 44, paddingHorizontal: 14 }}
                        />
                      ) : null}
                    </View>
                    {member.email ? (
                      <T raw style={styles.muted(c.muted)}>
                        {member.email}
                      </T>
                    ) : null}
                    {member.endedAt ? (
                      <T raw style={styles.muted(c.muted)}>
                        {m("endedAt", {
                          time: displayDate(member.endedAt, locale),
                        })}
                      </T>
                    ) : null}
                  </View>
                ))}
                {!owner ? (
                  <Button
                    label={m("leave")}
                    secondary
                    disabled={busy}
                    onPress={() =>
                      confirm(
                        "leaveTitle",
                        m("leaveDescription"),
                        "leave",
                        pilot.leaveFamily,
                      )
                    }
                  />
                ) : null}
              </Disclosure>

              {demo ? (
                <Disclosure title={m("profile")}>
                  <T raw style={styles.muted(c.muted)}>
                    {m("profileDescription")}
                  </T>
                  {owner ? (
                    <>
                      <Input
                        label={m("babyName")}
                        value={profileName}
                        onChangeText={setProfileName}
                        maxLength={60}
                        editable={!workspaceBusy}
                      />
                      <Input
                        label={m("babyBirthDate")}
                        value={profileBirthDate}
                        onChangeText={setProfileBirthDate}
                        placeholder="YYYY-MM-DD"
                        maxLength={10}
                        editable={!workspaceBusy}
                      />
                      <Button
                        label={m("saveProfile")}
                        disabled={workspaceBusy || !profileName.trim()}
                        onPress={() => {
                          const date = profileBirthDate.trim();
                          const iso = date ? localISO(date, "00:00") : null;
                          if (date && (!iso || Date.parse(iso) > Date.now())) {
                            setLocalError("profileDateError");
                            return;
                          }
                          void run(() =>
                            pilot.updateProfile(
                              profileName.trim(),
                              date || null,
                            ),
                          );
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <T raw>{snapshot.family.babyName}</T>
                      <T raw style={styles.muted(c.muted)}>
                        {snapshot.family.babyBirthDate || m("noBirthDate")}
                      </T>
                    </>
                  )}
                </Disclosure>
              ) : null}

              {owner ? (
                <Disclosure title={m("inviteSection")}>
                  {inviteCapacity ? (
                    <T raw accessibilityLiveRegion="polite">
                      {m("invitationSlots", inviteCapacity)}
                    </T>
                  ) : null}
                  <T raw style={styles.muted(c.muted)}>
                    {m("invitationCapacityHint")}
                  </T>
                  <T raw style={styles.muted(c.muted)}>
                    {m("recipientHint")}
                  </T>
                  <Input
                    label={m("recipientEmail")}
                    value={recipient}
                    onChangeText={setRecipient}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!workspaceBusy}
                    maxLength={254}
                  />
                  <Button
                    label={m("createInvitation")}
                    disabled={
                      workspaceBusy || !recipient.trim() || invitationAtCapacity
                    }
                    onPress={() => {
                      if (
                        workspaceBusy ||
                        !recipient.trim() ||
                        invitationAtCapacity
                      )
                        return;
                      void run(async () => {
                        setCreatedInvite(null);
                        const email = recipient.trim();
                        await pilot.createInvitation(email);
                        if (mounted.current) {
                          setCreatedInvite(email);
                          setRecipient("");
                        }
                      });
                    }}
                  />
                  {createdInvite ? (
                    <View style={[styles.notice, { backgroundColor: c.soft }]}>
                      <T
                        raw
                        accessibilityLiveRegion="polite"
                        style={{ fontWeight: "600" }}
                      >
                        {m("invitationReady")}
                      </T>
                      <T raw>{createdInvite}</T>
                    </View>
                  ) : null}
                  <T raw style={{ fontWeight: "600" }}>
                    {m("invitations")}
                  </T>
                  {!snapshot.invitations.length ? (
                    <T raw style={styles.muted(c.muted)}>
                      {m("noInvitations")}
                    </T>
                  ) : (
                    snapshot.invitations.map((invitation) => {
                      const pending =
                        invitation.status === "pending" &&
                        Date.parse(invitation.expiresAt) > Date.now();
                      const status =
                        invitation.status === "pending" && !pending
                          ? "expired"
                          : invitation.status;
                      const statusLabel: Record<
                        typeof status,
                        FamilyMessageKey
                      > = {
                        pending: "pendingInvitation",
                        accepted: "acceptedInvitation",
                        declined: "declinedInvitation",
                        revoked: "revokedInvitation",
                        expired: "expiredInvitation",
                      };
                      return (
                        <View
                          key={invitation.id}
                          style={[styles.listItem, { borderColor: c.line }]}
                        >
                          <T raw>{invitation.email}</T>
                          <T raw style={styles.muted(c.muted)}>
                            {m(
                              status === "declined" &&
                                invitation.declineReason === "created_family"
                                ? "declinedCreatedFamily"
                                : status === "declined" &&
                                    invitation.declineReason === "joined_family"
                                  ? "declinedJoinedFamily"
                                  : statusLabel[status],
                            )}
                          </T>
                          <T raw style={styles.muted(c.muted)}>
                            {m("expiresAt", {
                              time: displayDate(invitation.expiresAt, locale),
                            })}
                          </T>
                          {pending ? (
                            <Button
                              label={m("revoke")}
                              secondary
                              disabled={busy}
                              onPress={() =>
                                confirm(
                                  "revokeTitle",
                                  m("revokeDescription", {
                                    email: invitation.email,
                                  }),
                                  "revoke",
                                  async () => {
                                    await pilot.revokeInvitation(invitation.id);
                                    setCreatedInvite(null);
                                  },
                                )
                              }
                            />
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </Disclosure>
              ) : null}
              {owner ? (
                <Disclosure title={m("ownership")}>
                  <T raw style={styles.muted(c.muted)}>
                    {m("ownershipDescription")}
                  </T>
                  {transfer ? (
                    <View style={styles.stack}>
                      <T raw>
                        {m("ownershipPending", {
                          name: memberName(transfer.toUserId),
                        })}
                      </T>
                      <Button
                        label={m("cancelOwnership")}
                        secondary
                        disabled={workspaceBusy}
                        onPress={() =>
                          confirm(
                            "cancelOwnershipTitle",
                            m("cancelOwnershipDescription"),
                            "cancelOwnership",
                            pilot.cancelOwnership,
                          )
                        }
                      />
                    </View>
                  ) : successors.length ? (
                    successors.map((member) => (
                      <View
                        key={member.membershipId}
                        style={[styles.listItem, { borderColor: c.line }]}
                      >
                        <T raw>{member.displayName}</T>
                        <Button
                          label={m("nominateOwner")}
                          secondary
                          disabled={workspaceBusy}
                          onPress={() =>
                            confirm(
                              "nominateOwnerTitle",
                              m("nominateOwnerDescription", {
                                name: member.displayName,
                              }),
                              "nominateOwner",
                              () => pilot.nominateOwner(member.id),
                            )
                          }
                        />
                      </View>
                    ))
                  ) : (
                    <T raw style={styles.muted(c.muted)}>
                      {m("noSuccessor")}
                    </T>
                  )}
                  <View style={[styles.listItem, { borderColor: c.line }]}>
                    <T raw style={styles.muted(c.muted)}>
                      {m(
                        successors.length
                          ? "closeFamilyBlocked"
                          : "closeFamilyDescription",
                      )}
                    </T>
                    <Button
                      label={m("closeFamily")}
                      secondary
                      disabled={workspaceBusy || successors.length > 0}
                      onPress={() =>
                        confirm(
                          "closeFamilyTitle",
                          m("closeFamilyDescription"),
                          "closeFamily",
                          pilot.closeFamily,
                          "closeFamilyConsent",
                        )
                      }
                    />
                  </View>
                </Disclosure>
              ) : null}
              <Disclosure title={m("details")}>
                <T raw style={styles.muted(c.muted)}>
                  {m("firstCommit")}
                </T>
              </Disclosure>
            </>
          ) : null}
        </>
      )}

      {busy ? (
        <ActivityIndicator
          color={c.primary}
          accessibilityLabel={m("working")}
        />
      ) : null}

      <Modal
        visible={confirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setConfirmation(null);
        }}
      >
        <SafeAreaView style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{
              width: "100%",
              maxWidth: 420,
              maxHeight: "100%",
              flexShrink: 1,
              alignSelf: "center",
            }}
          >
            <View
              accessibilityViewIsModal
              style={[styles.modal, { backgroundColor: c.card }]}
            >
              <ScrollView
                contentContainerStyle={styles.stack}
                keyboardShouldPersistTaps="handled"
              >
                <T raw accessibilityRole="header" style={styles.title}>
                  {confirmation?.title}
                </T>
                {demo ? (
                  <T raw style={{ color: c.primary, fontWeight: "600" }}>
                    {m("demoConfirmation")}
                  </T>
                ) : null}
                <T raw>{confirmation?.body}</T>
                {confirmation?.acknowledgement ? (
                  <Consent
                    checked={acknowledged}
                    onChange={setAcknowledged}
                    disabled={busy}
                    label={confirmation.acknowledgement}
                  />
                ) : null}
                {modalError ? (
                  <T raw accessibilityRole="alert">
                    {modalError}
                  </T>
                ) : null}
                <Button
                  label={
                    busy ? m("working") : (confirmation?.label ?? m("confirm"))
                  }
                  disabled={
                    busy ||
                    confirmationAuthBlocked ||
                    (!!confirmation?.acknowledgement && !acknowledged) ||
                    (pilot.transitionPending &&
                      !confirmation?.allowDuringTransition)
                  }
                  onPress={() => {
                    if (
                      confirmation &&
                      !confirmationAuthBlocked &&
                      !busy &&
                      (!confirmation.acknowledgement || acknowledged) &&
                      (!pilot.transitionPending ||
                        confirmation.allowDuringTransition)
                    )
                      void run(confirmation.action, true);
                  }}
                />
                <Button
                  label={m("cancel")}
                  secondary
                  disabled={busy}
                  onPress={() => setConfirmation(null)}
                />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    screen: { width: "100%", maxWidth: 680, alignSelf: "center", gap: 14 },
    title: { fontSize: 22, lineHeight: 29, fontWeight: "700", flexShrink: 1 },
    sectionTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700", flex: 1 },
    card: { padding: 16, borderRadius: 20, gap: 12 },
    stack: { gap: 12 },
    spread: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },
    disclosure: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    notice: { borderRadius: 16, padding: 14, gap: 8 },
    field: { gap: 4 },
    input: {
      borderWidth: 1,
      borderRadius: 14,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      lineHeight: 22,
    },
    consent: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      minHeight: 44,
      paddingVertical: 4,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderWidth: 1,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    dateRow: { flexDirection: "row", gap: 10 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    flexButton: { flexGrow: 1, flexBasis: 120, paddingHorizontal: 12 },
    listItem: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 20,
    },
    modal: { borderRadius: 24, padding: 20, maxHeight: "100%" },
  }),
  muted: (color: string) => ({ color, fontSize: 15, lineHeight: 22 }),
};
