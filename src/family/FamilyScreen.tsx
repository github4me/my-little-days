import React from "react";
import FamilyScreenView from "./FamilyScreenView";
import { useFamilyPilot } from "./useFamilyPilot";

export default function FamilyScreen({ onBack }: { onBack: () => void }) {
  const pilot = useFamilyPilot();
  return <FamilyScreenView onBack={onBack} pilot={pilot} />;
}
