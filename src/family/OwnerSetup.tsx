import React, { useRef } from "react";
import type { State } from "../domain";
import OwnerSetupCard from "./OwnerSetupCard";
import {
  prepareOwnerSeed,
  serializeOwnerSeed,
  summarizeOwnerSeed,
} from "./ownerSeed";
import type { useFamilyPilot } from "./useFamilyPilot";
import { loadPersonalExtras } from "./personalExtras";

export default function OwnerSetup(context: {
  pilot: ReturnType<typeof useFamilyPilot>;
  source: State;
}) {
  const current = useRef(context);
  current.current = context;
  const user = context.pilot.user;
  if (
    !user ||
    context.pilot.authStatus !== "authenticated" ||
    context.pilot.sharedMode ||
    context.pilot.snapshot ||
    context.pilot.transitionPending
  )
    return null;
  const sourceNow = () => {
    const latest = current.current;
    if (
      latest.pilot.user?.id !== user.id ||
      latest.pilot.authStatus !== "authenticated" ||
      latest.pilot.sharedMode ||
      latest.pilot.snapshot ||
      latest.pilot.transitionPending ||
      latest.pilot.busy ||
      latest.pilot.syncing ||
      latest.pilot.accountDeletion
    )
      throw new Error("owner_setup_changed");
    return latest.source;
  };
  return (
    <OwnerSetupCard
      mode="full"
      pendingInvitationCount={
        context.pilot.inbox.filter(
          (invite) => Date.parse(invite.expiresAt) > Date.now(),
        ).length
      }
      profile={context.source.profile}
      summary={summarizeOwnerSeed(context.source)}
      onPrepare={async (emails) => {
        sourceNow();
        const extras = await loadPersonalExtras();
        return prepareOwnerSeed(sourceNow(), emails, user.email, extras);
      }}
      onSave={async (draft) => {
        sourceNow();
        const extras = await loadPersonalExtras();
        const latest = prepareOwnerSeed(
          sourceNow(),
          draft.inviteeEmails.join("\n"),
          user.email,
          extras,
        );
        if (serializeOwnerSeed(latest) !== serializeOwnerSeed(draft))
          throw new Error("owner_source_changed");
        await current.current.pilot.createFamilyFromSeed(latest);
      }}
    />
  );
}
