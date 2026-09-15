import React, { useRef } from "react";
import type { State } from "../domain";
import OwnerSetupCard from "./OwnerSetupCard";
import {
  prepareOwnerSeed,
  serializeOwnerSeed,
  summarizeOwnerSeed,
} from "./ownerSeed";
import type { useFamilyPilot } from "./useFamilyPilot";

export default function OwnerSetup(context: {
  pilot: ReturnType<typeof useFamilyPilot>;
  source: State;
}) {
  const current = useRef(context);
  current.current = context;
  const user = context.pilot.user;
  if (
    !user ||
    context.pilot.sharedMode ||
    context.pilot.snapshot ||
    context.pilot.transitionPending
  )
    return null;
  const sourceNow = () => {
    const latest = current.current;
    if (
      latest.pilot.user?.id !== user.id ||
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
      profile={context.source.profile}
      summary={summarizeOwnerSeed(context.source)}
      onPrepare={async (emails) =>
        prepareOwnerSeed(sourceNow(), emails, user.email)
      }
      onSave={async (draft) => {
        const latest = prepareOwnerSeed(
          sourceNow(),
          draft.inviteeEmails.join("\n"),
          user.email,
        );
        if (serializeOwnerSeed(latest) !== serializeOwnerSeed(draft))
          throw new Error("owner_source_changed");
        await current.current.pilot.createFamilyFromSeed(latest);
      }}
    />
  );
}
