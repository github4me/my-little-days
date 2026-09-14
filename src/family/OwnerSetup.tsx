import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import type { State } from "../domain";
import { useI18n } from "../i18n";
import { Button, Card, T } from "../ui";
import { familyConfig } from "./config";
import { familyMessage } from "./messages";
import OwnerSetupCard from "./OwnerSetupCard";
import {
  prepareOwnerSeed,
  serializeOwnerSeed,
  summarizeOwnerSeed,
  type OwnerSeedDraft,
} from "./ownerSeed";
import {
  clearOwnerSetup,
  loadOwnerSetup,
  saveOwnerSetup,
} from "./pilotStorage";
import type { useFamilyPilot } from "./useFamilyPilot";

type Pilot = ReturnType<typeof useFamilyPilot>;
type Context = { pilot: Pilot; source: State };

// No network writes or main-app state setters are available here. This is an
// account-scoped local preparation, not migration or an activated shared family.
export default function OwnerSetup(context: Context) {
  const current = useRef(context);
  current.current = context;
  const user = context.pilot.user;
  if (!familyConfig || !user) return null;
  const accountKey = `${familyConfig.apiUrl}|${familyConfig.tenantId}|${user.id}`;
  return (
    <AccountSetup
      key={accountKey}
      accountKey={accountKey}
      email={user.email}
      current={current}
    />
  );
}

function AccountSetup({
  accountKey,
  email,
  current,
}: {
  accountKey: string;
  email: string;
  current: React.RefObject<Context>;
}) {
  const { locale } = useI18n();
  const [stored, setStored] = useState<OwnerSeedDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setReady(false);
    setFailed(false);
    void loadOwnerSetup(accountKey, email)
      .then((value) => {
        if (!cancelled) {
          setStored(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [accountKey, email, retry]);

  function sourceNow() {
    const { pilot, source } = current.current;
    const currentKey = `${familyConfig?.apiUrl}|${familyConfig?.tenantId}|${pilot.user?.id}`;
    if (
      !mounted.current ||
      currentKey !== accountKey ||
      pilot.user?.email !== email ||
      pilot.snapshot ||
      pilot.transitionPending ||
      pilot.accountDeletion ||
      pilot.busy ||
      pilot.syncing
    )
      throw new Error("owner_setup_changed");
    return source;
  }

  if (failed)
    return (
      <Card>
        <T raw>{familyMessage(locale, "ownerGenericError")}</T>
        <Button
          label={
            locale === "zh-CN"
              ? "重试读取本机准备内容"
              : "Retry loading local setup"
          }
          onPress={() => setRetry((n) => n + 1)}
        />
      </Card>
    );
  if (!ready)
    return (
      <ActivityIndicator
        accessibilityLabel={familyMessage(locale, "working")}
      />
    );
  const source = current.current.source;
  return (
    <OwnerSetupCard
      mode="local-only"
      profile={source.profile}
      summary={summarizeOwnerSeed(source)}
      pending={stored}
      onPrepare={async (emails) => prepareOwnerSeed(sourceNow(), emails, email)}
      onSave={async (draft) => {
        // Review is a snapshot. A timer, edit or profile change after review must
        // force a new review rather than silently save different/stale contents.
        const latest = prepareOwnerSeed(
          sourceNow(),
          draft.inviteeEmails.join("\n"),
          email,
        );
        if (serializeOwnerSeed(latest) !== serializeOwnerSeed(draft))
          throw new Error("owner_source_changed");
        // Store enqueues synchronously; logout's clearPilot is ordered after this
        // write and clears the setup table in the same account-cleanup transaction.
        await saveOwnerSetup(accountKey, latest);
        if (mounted.current) setStored(latest);
      }}
      onDiscard={async () => {
        sourceNow();
        await clearOwnerSetup(accountKey);
        if (mounted.current) setStored(null);
      }}
    />
  );
}
