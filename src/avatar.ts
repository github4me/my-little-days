import { File, Paths } from "expo-file-system";
import { validateAvatarDataUrl } from "./family/extras";

const maxAvatarBytes = 12 * 1024 * 1024;
const localPrefix = "little-days-avatar-";

function extensionFor(uri: string) {
  const extension = /\.([a-zA-Z0-9]{2,5})(?:[?#]|$)/.exec(uri)?.[1];
  return extension &&
    ["jpg", "jpeg", "png", "heic", "webp"].includes(extension.toLowerCase())
    ? extension.toLowerCase()
    : "jpg";
}

function isLocalAvatar(uri: string) {
  return uri.startsWith(Paths.document.uri + localPrefix);
}

export async function copyAvatarFile(sourceUri: string) {
  const source = new File(sourceUri);
  if (!source.exists) throw new Error("无法读取所选照片，请重试");
  if (source.size > maxAvatarBytes) throw new Error("请选择 12 MB 以内的照片");
  const target = new File(
    Paths.document,
    `${localPrefix}${Date.now()}.${extensionFor(sourceUri)}`,
  );
  await source.copy(target);
  if (!target.exists || target.size === 0)
    throw new Error("头像保存失败，请重试");
  return target.uri;
}

export async function deleteAvatarFile(uri: string | null) {
  if (!uri || !isLocalAvatar(uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function readAvatarDataUrl(
  uri: string | null,
): Promise<string | null> {
  if (uri === null) return null;
  if (uri.startsWith("data:")) return validateAvatarDataUrl(uri);
  // Only the current app-owned copy is read, never arbitrary URLs or other files.
  if (
    !isLocalAvatar(uri) ||
    !/^little-days-avatar-\d+\.(?:jpg|jpeg|png|heic|webp)$/.test(
      uri.slice(Paths.document.uri.length),
    )
  )
    throw new Error("avatar_read_failed");
  return readLocalImage(uri);
}

export async function readSelectedAvatarDataUrl(
  uri: string | null,
): Promise<string | null> {
  if (uri === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error("avatar_read_failed");
  }
  const directories = [Paths.cache.uri, Paths.document.uri].map((base) =>
    decodeURIComponent(base),
  );
  if (
    !decoded.startsWith("file://") ||
    /[\\?#\u0000-\u001f\u007f]/.test(decoded) ||
    decoded.split("/").some((part) => part === "." || part === "..") ||
    !directories.some((base) =>
      decoded.startsWith(base.endsWith("/") ? base : base + "/"),
    )
  )
    throw new Error("avatar_read_failed");
  return readLocalImage(uri);
}

async function readLocalImage(uri: string): Promise<string> {
  const file = new File(uri);
  if (!file.exists || file.size <= 0 || file.size > maxAvatarBytes)
    throw new Error("avatar_read_failed");
  const encoded = await file.base64();
  // Inspect the actual container; iOS exports sometimes retain a misleading extension.
  for (const mime of ["jpeg", "png", "heic", "webp"]) {
    try {
      return validateAvatarDataUrl(`data:image/${mime};base64,${encoded}`);
    } catch {
      /* Try the next supported container. */
    }
  }
  throw new Error("avatar_read_failed");
}
