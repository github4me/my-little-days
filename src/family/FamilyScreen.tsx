import React from "react";
import FamilyScreenView from "./FamilyScreenView";
import type { useFamilyPilot } from "./useFamilyPilot";
import type { State } from "../domain";
import OwnerSetup from "./OwnerSetup";

export default function FamilyScreen({
  onBack,
  source,
  pilot,
  feedbackHandledByGlobalBanner = false,
}: {
  onBack?: () => void;
  source: State;
  pilot: ReturnType<typeof useFamilyPilot>;
  feedbackHandledByGlobalBanner?: boolean;
}) {
  return (
    <FamilyScreenView
      onBack={onBack}
      pilot={pilot}
      feedbackHandledByGlobalBanner={feedbackHandledByGlobalBanner}
      section="family"
      ownerSetup={<OwnerSetup pilot={pilot} source={source} />}
    />
  );
}
