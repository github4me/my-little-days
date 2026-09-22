import { File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { State, validateState } from "./domain";
import { t } from "./i18n";
import type { FamilyBackupDocument } from "./family/backup";

async function shareJson(
  value: unknown,
  name: string,
  title: string,
  ensureCurrent?: () => void,
) {
  ensureCurrent?.();
  const file = new File(Paths.cache, name);
  try {
    file.write(JSON.stringify(value, null, 2));
    if (!(await Sharing.isAvailableAsync()))
      throw new Error(t("这台设备暂不支持导出文件"));
    ensureCurrent?.();
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: title,
    });
  } finally {
    if (file.exists) file.delete();
  }
}
export async function exportBackup(state: State) {
  return shareJson(
    validateState(state),
    `little-days-${Date.now()}.json`,
    t("保存成长记录备份"),
  );
}
export async function exportFamilyBackup(
  document: FamilyBackupDocument,
  ensureCurrent?: () => void,
) {
  return shareJson(
    document,
    `little-days-family-${Date.now()}.json`,
    t("保存家庭记录备份"),
    ensureCurrent,
  );
}
export async function importBackup(): Promise<State | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const file = new File(result.assets[0].uri);
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("备份文件不能超过 25 MB");
    return validateState(JSON.parse(await file.text()));
  } finally {
    if (file.exists) file.delete();
  }
}
