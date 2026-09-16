import React from "react";
import FamilyScreenView from "./FamilyScreenView";
import type { useFamilyPilot } from "./useFamilyPilot";
import type { State } from "../domain";
import OwnerSetup from "./OwnerSetup";

export default function FamilyScreen({
  onBack,
  source,
  pilot,
}: {
  onBack: () => void;
  source: State;
  pilot: ReturnType<typeof useFamilyPilot>;
}) {
  return (
    <FamilyScreenView
      onBack={onBack}
      pilot={pilot}
      section="family"
      ownerSetup={<OwnerSetup pilot={pilot} source={source} />}
    />
  );
}
