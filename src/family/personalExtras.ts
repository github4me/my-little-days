import { readAvatarDataUrl } from "../avatar";
import { captureReminderRecords } from "../reminders";
import {
  loadAllPlayCheckins,
  loadAvatarUri,
  loadPlaySelection,
  loadReminderSettings,
} from "../storage";
import { validateExtraRecords, type FamilyExtraRecord } from "./extras";

// This is a read-only snapshot. The activation controller freezes/drains writes
// before comparing it with the reviewed seed and never substitutes another
// family's cache for any of these personal stores.
export async function loadPersonalExtras(): Promise<FamilyExtraRecord[]> {
  const [avatarUri, selection, checkins, reminderSettings, reminders] =
    await Promise.all([
      loadAvatarUri(),
      loadPlaySelection(),
      loadAllPlayCheckins(),
      loadReminderSettings(),
      captureReminderRecords(),
    ]);
  const avatar = await readAvatarDataUrl(avatarUri);
  const records: FamilyExtraRecord[] = [
    { id: "avatar", kind: "avatar", dataUrl: avatar },
    {
      id: "play-selection",
      kind: "play-selection",
      selection: {
        included: [...selection.included].sort(),
        excluded: [...selection.excluded].sort(),
      },
    },
    {
      id: "reminder-settings",
      kind: "reminder-settings",
      settings: reminderSettings,
    },
    ...checkins.flatMap(({ day, ids }) =>
      ids.map((activityId): FamilyExtraRecord => ({
        id: `play-${day}-${activityId}`,
        kind: "play-checkin",
        day,
        activityId,
      })),
    ),
    ...reminders,
  ];
  return validateExtraRecords(records).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
