import { File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { State, validateState } from "./domain";
import { t } from "./i18n";
export async function exportBackup(state: State) {
  const file = new File(Paths.cache, `little-days-${Date.now()}.json`);
  file.write(JSON.stringify(validateState(state), null, 2));
  try {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("这台设备暂不支持导出文件");
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: t("保存成长记录备份"),
    });
  } finally {
    if (file.exists) file.delete();
  }
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
