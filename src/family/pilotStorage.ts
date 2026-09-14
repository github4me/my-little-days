import type { PilotState } from "./pilotState";
import type { OwnerSeedDraft } from "./ownerSeed";
// Web preview is deliberately local-only; never cache shared infant data here.
export async function loadPilot(_accountId: string): Promise<PilotState> {
  throw new Error("native_required");
}
export async function savePilot(
  _accountId: string,
  _state: PilotState,
  _options?: { discardOwnerSetup?: boolean },
): Promise<void> {
  throw new Error("native_required");
}
export async function clearPilot(_accountId: string): Promise<void> {
  throw new Error("native_required");
}
export async function loadOwnerSetup(
  _accountKey: string,
  _ownEmail: string,
): Promise<OwnerSeedDraft | null> {
  throw new Error("native_required");
}
export async function saveOwnerSetup(
  _accountKey: string,
  _draft: OwnerSeedDraft,
): Promise<void> {
  throw new Error("native_required");
}
export async function clearOwnerSetup(_accountKey: string): Promise<void> {
  throw new Error("native_required");
}
