import React from "react";
import FamilyScreenView from "./FamilyScreenView";
import { useFamilyPilot } from "./useFamilyPilot";
import type { State } from "../domain";
import OwnerSetup from "./OwnerSetup";

export default function FamilyScreen({
  onBack,
  source,
}: {
  onBack: () => void;
  source: State;
}) {
  const pilot = useFamilyPilot();
  return (
    <FamilyScreenView
      onBack={onBack}
      pilot={pilot}
      ownerSetup={<OwnerSetup pilot={pilot} source={source} />}
    />
  );
}
