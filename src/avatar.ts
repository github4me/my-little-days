import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { validateAvatarDataUrl } from "./family/extras";
import {
  AVATAR_OUTPUT_EDGE,
  AVATAR_SOURCE_MAX_PIXELS,
  inspectAvatarSource,
  sanitizeEncodedAvatarJpeg,
} from "./avatarSanitizer";

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
  if (uri.startsWith("data:")) return sanitizeSharedAvatar(uri);
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
      const source = validateAvatarDataUrl(
        `data:image/${mime};base64,${encoded}`,
      );
      return await sanitizeSharedAvatar(source);
    } catch {
      /* Try the next supported container. */
    }
  }
  throw new Error("avatar_read_failed");
}

// Both picked photos and migrated app-owned/data-URL photos cross this boundary.
// Never upload the original bytes or rely on image-picker metadata behavior.
async function sanitizeSharedAvatar(source: string): Promise<string> {
  inspectAvatarSource(source);
  const references: { release(): void }[] = [];
  let temporary: string | undefined;
  try {
    const context = ImageManipulator.manipulate(source);
    references.push(context);
    const oriented = await context.renderAsync();
    references.push(oriented);
    const { width, height } = oriented;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > AVATAR_SOURCE_MAX_PIXELS
    )
      throw new Error("avatar_read_failed");
    const scale = Math.min(
      1,
      AVATAR_OUTPUT_EDGE / width,
      AVATAR_OUTPUT_EDGE / height,
    );
    const resizedContext = ImageManipulator.manipulate(oriented);
    references.push(resizedContext);
    resizedContext.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    });
    const resized = await resizedContext.renderAsync();
    references.push(resized);
    const encoded = await resized.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.85,
      base64: true,
    });
    temporary = encoded.uri;
    if (!encoded.base64) throw new Error("avatar_read_failed");
    return sanitizeEncodedAvatarJpeg(encoded.base64);
  } catch {
    throw new Error("avatar_read_failed");
  } finally {
    for (const reference of references.reverse()) {
      try {
        reference.release();
      } catch {
        /* Release every independent native reference. */
      }
    }
    // Delete only the cache result returned by the native encoder, never source files.
    if (
      temporary?.startsWith(Paths.cache.uri) &&
      !temporary.split("/").some((part) => part === "..")
    ) {
      try {
        const file = new File(temporary);
        if (file.exists) file.delete();
      } catch {
        /* A cache purge can remove an unreferenced temporary file later. */
      }
    }
  }
}
