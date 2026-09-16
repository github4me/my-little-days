import type { Entry } from "../domain";
import type { FamilyExtraRecord } from "./extras";

// Browser previews do not schedule or persist family notifications.
export async function loadFamilyReminderOptIn(
  _origin: string,
): Promise<boolean> {
  return false;
}
export async function setFamilyReminderOptIn(
  _origin: string,
  enabled: boolean,
): Promise<void> {
  if (enabled) throw new Error("native_required");
}
export async function syncFamilyReminders(
  _origin: string,
  _records: readonly FamilyExtraRecord[],
  _entries: readonly Entry[],
): Promise<void> {}
export async function clearFamilyReminders(): Promise<void> {}
export async function suspendFamilyReminders(): Promise<void> {}
export function shouldShowFamilyNotification(
  _data: Record<string, unknown> | undefined,
): boolean {
  return false;
}
