import type { FullFamilySnapshot } from "./contracts";
import { validateFullSnapshot } from "./fullState";

// A deliberately separate format from the personal offline backup. It is a
// read-only copy of confirmed server data, not an import/restore request.
export type FamilyBackupDocument = {
  format: "my-little-days-family-backup";
  formatVersion: 1;
  exportedAt: string;
  family: {
    id: string;
    historyId: string;
    revision: string;
  };
  profile: FullFamilySnapshot["profile"];
  entries: FullFamilySnapshot["entries"];
  careRecords: FullFamilySnapshot["careRecords"];
  extrasSchemaVersion: 1;
  extraRecords: NonNullable<FullFamilySnapshot["extraRecords"]>;
};

export function createFamilyBackup(
  snapshot: FullFamilySnapshot,
  exportedAt = new Date().toISOString(),
): FamilyBackupDocument {
  const checked = validateFullSnapshot(snapshot);
  // Older API projections can omit supplements or extras. A partial export
  // must never be labelled a complete family backup.
  if (checked.careSchemaVersion !== 2)
    throw new Error("supplement_sharing_unavailable");
  if (checked.extrasSchemaVersion !== 1 || !checked.extraRecords)
    throw new Error("extras_sharing_unavailable");
  return {
    format: "my-little-days-family-backup",
    formatVersion: 1,
    exportedAt,
    family: {
      id: checked.family.id,
      historyId: checked.historyId,
      revision: checked.revision,
    },
    profile: checked.profile,
    entries: checked.entries,
    careRecords: checked.careRecords,
    extrasSchemaVersion: 1,
    extraRecords: checked.extraRecords,
  };
}
