import { State, validateState } from "./domain";
import type { FamilyBackupDocument } from "./family/backup";

function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportBackup(state: State) {
  downloadJson(validateState(state), `little-days-${Date.now()}.json`);
}
export async function exportFamilyBackup(
  document: FamilyBackupDocument,
  ensureCurrent?: () => void,
) {
  ensureCurrent?.();
  downloadJson(document, `little-days-family-${Date.now()}.json`);
}
export async function importBackup(): Promise<State | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        if (file.size > 25 * 1024 * 1024)
          throw new Error("备份文件不能超过 25 MB");
        resolve(validateState(JSON.parse(await file.text())));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
