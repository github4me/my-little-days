export async function copyAvatarFile(_sourceUri: string): Promise<string> {
  throw new Error("头像仅支持在手机安装版中保存");
}

export async function deleteAvatarFile(_uri: string | null) {}

export async function readAvatarDataUrl(
  uri: string | null,
): Promise<string | null> {
  if (uri === null) return null;
  // Browser previews cannot dereference a native avatar path or arbitrary URL.
  try {
    return validateAvatarDataUrl(uri);
  } catch {
    throw new Error("avatar_read_failed");
  }
}

export const readSelectedAvatarDataUrl = readAvatarDataUrl;
import { validateAvatarDataUrl } from "./family/extras";
