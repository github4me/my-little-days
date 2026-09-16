import { validateAvatarDataUrl } from "./family/extras";

export const AVATAR_SOURCE_MAX_PIXELS = 24_000_000;
export const AVATAR_OUTPUT_EDGE = 1024;
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const invalid = (): never => {
  throw new Error("avatar_read_failed");
};
const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32 = (b: Uint8Array, p: number) =>
  b[p] * 16777216 + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const text = (b: Uint8Array, p: number, length: number) =>
  String.fromCharCode(...b.subarray(p, p + length));

function decode(value: string): Uint8Array {
  const encoded = value.slice(value.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((encoded.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < encoded.length; i += 4) {
    const value =
      (alphabet.indexOf(encoded[i]) << 18) |
      (alphabet.indexOf(encoded[i + 1]) << 12) |
      ((encoded[i + 2] === "=" ? 0 : alphabet.indexOf(encoded[i + 2])) << 6) |
      (encoded[i + 3] === "=" ? 0 : alphabet.indexOf(encoded[i + 3]));
    if (offset < output.length) output[offset++] = value >> 16;
    if (offset < output.length) output[offset++] = value >> 8;
    if (offset < output.length) output[offset++] = value;
  }
  return output;
}
function encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const value =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    chunk +=
      alphabet[(value >> 18) & 63] +
      alphabet[(value >> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(value >> 6) & 63] : "=") +
      (i + 2 < bytes.length ? alphabet[value & 63] : "=");
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = "";
    }
  }
  return chunks.join("") + chunk;
}

function dimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 12000 ||
    height > 12000 ||
    width * height > AVATAR_SOURCE_MAX_PIXELS
  )
    return invalid();
  return { width, height };
}

function jpeg(bytes: Uint8Array, strip: boolean) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return invalid();
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let position = 2;
  let size: { width: number; height: number } | undefined;
  let sawScan = false;
  while (position < bytes.length) {
    const start = position;
    if (bytes[position++] !== 255) return invalid();
    while (bytes[position] === 255) position++;
    const marker = bytes[position++];
    if (marker === 217) {
      if (!size || !sawScan) return invalid();
      kept.push(new Uint8Array([255, 217]));
      const output = new Uint8Array(
        kept.reduce((sum, part) => sum + part.length, 0),
      );
      let offset = 0;
      for (const part of kept) {
        output.set(part, offset);
        offset += part.length;
      }
      return { ...size, output };
    }
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 216 ||
      (marker >= 208 && marker <= 215) ||
      position + 2 > bytes.length
    )
      return invalid();
    const length = u16(bytes, position);
    if (length < 2 || position + length > bytes.length) return invalid();
    const end = position + length;
    if ([192, 193, 194].includes(marker)) {
      if (length < 8) return invalid();
      size = dimensions(u16(bytes, position + 5), u16(bytes, position + 3));
      if (!strip) return { ...size, output: bytes };
    }
    // All APP segments (including EXIF, XMP, ICC and vendor extensions), COM,
    // and bytes after EOI are omitted. Pixels were already oriented by native
    // decoding; retaining the original orientation tag would rotate them twice.
    if (!(marker >= 224 && marker <= 239) && marker !== 254)
      kept.push(bytes.subarray(start, end));
    position = end;
    if (marker === 218) {
      sawScan = true;
      const entropyStart = position;
      while (position < bytes.length) {
        if (bytes[position] !== 255) {
          position++;
          continue;
        }
        let next = position + 1;
        while (bytes[next] === 255) next++;
        const code = bytes[next];
        if (code === 0 || (code >= 208 && code <= 215)) {
          position = next + 1;
          continue;
        }
        break;
      }
      kept.push(bytes.subarray(entropyStart, position));
    }
  }
  return invalid();
}

export function inspectAvatarSource(dataUrl: string) {
  const checked = validateAvatarDataUrl(dataUrl);
  const bytes = decode(checked);
  if (checked.startsWith("data:image/jpeg;")) {
    const { width, height } = jpeg(bytes, false);
    return { width, height };
  }
  if (checked.startsWith("data:image/png;")) {
    if (
      bytes.length < 33 ||
      u32(bytes, 8) !== 13 ||
      text(bytes, 12, 4) !== "IHDR"
    )
      return invalid();
    return dimensions(u32(bytes, 16), u32(bytes, 20));
  }
  if (checked.startsWith("data:image/webp;")) {
    const kind = text(bytes, 12, 4);
    const le24 = (p: number) =>
      bytes[p] + (bytes[p + 1] << 8) + (bytes[p + 2] << 16);
    if (kind === "VP8X" && bytes.length >= 30)
      return dimensions(1 + le24(24), 1 + le24(27));
    if (
      kind === "VP8 " &&
      bytes.length >= 30 &&
      text(bytes, 23, 3) === "\x9d\x01\x2a"
    )
      return dimensions(
        (bytes[26] | (bytes[27] << 8)) & 16383,
        (bytes[28] | (bytes[29] << 8)) & 16383,
      );
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 47)
      return dimensions(
        1 + ((bytes[21] | (bytes[22] << 8)) & 16383),
        1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 16383),
      );
    return invalid();
  }
  // HEIC image dimensions live in bounded ISO-BMFF item property boxes. Check
  // every image property (primary image, tiles and thumbnails), not just one.
  const sizes: { width: number; height: number }[] = [];
  let boxes = 0;
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 4) return invalid();
    let p = start;
    while (p < end) {
      if (p + 8 > end || ++boxes > 4096) return invalid();
      const length = u32(bytes, p),
        kind = text(bytes, p + 4, 4);
      // Extended/zero-size boxes are unnecessary for <=12 MiB avatar files.
      if (length < 8 || p + length > end) return invalid();
      if (kind === "ispe") {
        if (length !== 20 || sizes.length >= 64) return invalid();
        sizes.push(dimensions(u32(bytes, p + 12), u32(bytes, p + 16)));
      } else if (["meta", "iprp", "ipco"].includes(kind))
        walk(p + 8 + (kind === "meta" ? 4 : 0), p + length, depth + 1);
      p += length;
    }
  };
  walk(0, bytes.length, 0);
  if (!sizes.length) return invalid();
  return sizes.reduce((largest, size) =>
    size.width * size.height > largest.width * largest.height ? size : largest,
  );
}

export function sanitizeEncodedAvatarJpeg(base64: string): string {
  const dataUrl = validateAvatarDataUrl(`data:image/jpeg;base64,${base64}`);
  const result = jpeg(decode(dataUrl), true);
  if (result.width > AVATAR_OUTPUT_EDGE || result.height > AVATAR_OUTPUT_EDGE)
    return invalid();
  return validateAvatarDataUrl(
    `data:image/jpeg;base64,${encode(result.output)}`,
  );
}
