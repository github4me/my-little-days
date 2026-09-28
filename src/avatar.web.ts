import {
  AVATAR_OUTPUT_EDGE,
  AVATAR_SOURCE_MAX_PIXELS,
  inspectAvatarSource,
  sanitizeEncodedAvatarJpeg,
} from "./avatarSanitizer";
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
    inspectAvatarSource(uri);
    if (typeof document === "undefined" || typeof Image === "undefined")
      throw new Error("avatar_read_failed");
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        image.src = "";
        reject(new Error("avatar_read_failed"));
      }, 15000);
      image.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("avatar_read_failed"));
      };
      image.src = uri;
    });
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (width < 1 || height < 1 || width * height > AVATAR_SOURCE_MAX_PIXELS)
      throw new Error("avatar_read_failed");
    const scale = Math.min(
      1,
      AVATAR_OUTPUT_EDGE / width,
      AVATAR_OUTPUT_EDGE / height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("avatar_read_failed");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return sanitizeEncodedAvatarJpeg(
      canvas.toDataURL("image/jpeg", 0.85).split(",")[1],
    );
  } catch {
    throw new Error("avatar_read_failed");
  }
}

export const readSelectedAvatarDataUrl = readAvatarDataUrl;
