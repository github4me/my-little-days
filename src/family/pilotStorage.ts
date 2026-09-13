import type { PilotState } from "./pilotState";
// Web preview is deliberately local-only; never cache shared infant data here.
export async function loadPilot(_accountId: string): Promise<PilotState> {
  throw new Error("native_required");
}
export async function savePilot(
  _accountId: string,
  _state: PilotState,
): Promise<void> {
  throw new Error("native_required");
}
export async function clearPilot(_accountId: string): Promise<void> {
  throw new Error("native_required");
}
