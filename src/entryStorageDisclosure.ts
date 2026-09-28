/** Describe the current write destination, not whether a write has synchronized. */
export function entryStorageDisclosure({
  sharedMode,
  hasAccount,
}: {
  sharedMode: boolean;
  hasAccount: boolean;
}): string {
  // Cached family workspaces remain shared while access/connectivity is checked.
  // Conversely, recognizing an account alone does not consent to uploading data.
  if (sharedMode) return "家庭共享记录 · 保存后等待同步确认";
  if (hasAccount) return "本机记录 · 登录不会自动上传";
  return "仅保存在这台设备 · 无需联网";
}
