import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectAvatarSource,
  sanitizeEncodedAvatarJpeg,
} from "./avatarSanitizer";

function segment(marker: number, payload: number[] | Buffer) {
  const length = payload.length + 2;
  return Buffer.from([255, marker, length >> 8, length & 255, ...payload]);
}
function jpg(width = 2, height = 3, metadata = true) {
  return Buffer.concat([
    Buffer.from([255, 216]),
    ...(metadata
      ? [
          segment(225, Buffer.from("Exif\0\0fake GPS device date orientation")),
          segment(225, Buffer.from("http://ns.adobe.com/xap/1.0/\0fake XMP")),
          segment(254, Buffer.from("private comment")),
        ]
      : []),
    segment(192, [
      8,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
      1,
      1,
      17,
      0,
    ]),
    segment(218, [1, 1, 0, 0, 63, 0]),
    Buffer.from([4, 5, 255, 0, 7, 255, 208, 9]),
    ...(metadata
      ? [segment(237, Buffer.from("private Photoshop profile"))]
      : []),
    segment(218, [1, 1, 0, 0, 63, 0]),
    Buffer.from([1, 2, 3, 255, 217]),
    ...(metadata ? [Buffer.from("private trailing data")] : []),
  ]);
}
const url = (kind: string, bytes: Buffer) =>
  `data:image/${kind};base64,${bytes.toString("base64")}`;
function box(kind: string, payload: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length + 8);
  return Buffer.concat([length, Buffer.from(kind), payload]);
}
function heic(width: number, height: number) {
  const size = Buffer.alloc(12);
  size.writeUInt32BE(width, 4);
  size.writeUInt32BE(height, 8);
  return Buffer.concat([
    box("ftyp", Buffer.from("heic0000")),
    box(
      "meta",
      Buffer.concat([
        Buffer.alloc(4),
        box("iprp", box("ipco", box("ispe", size))),
      ]),
    ),
  ]);
}
test("sanitizer strips EXIF, XMP, comments, inter-scan metadata and trailing bytes without altering JPEG pixels", () => {
  const cleaned = sanitizeEncodedAvatarJpeg(jpg().toString("base64"));
  assert.equal(cleaned, url("jpeg", jpg(2, 3, false)));
  const bytes = Buffer.from(cleaned.split(",")[1], "base64");
  for (const metadata of [
    "Exif",
    "GPS",
    "device",
    "orientation",
    "XMP",
    "private",
  ])
    assert.equal(bytes.includes(Buffer.from(metadata)), false);
  assert.deepEqual(inspectAvatarSource(cleaned), { width: 2, height: 3 });
});
test("source preflight bounds JPEG, PNG and HEIC dimensions before native decoding", () => {
  assert.deepEqual(inspectAvatarSource(url("jpeg", jpg())), {
    width: 2,
    height: 3,
  });
  assert.deepEqual(inspectAvatarSource(url("heic", heic(4000, 3000))), {
    width: 4000,
    height: 3000,
  });
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12);
  png.writeUInt32BE(200, 16);
  png.writeUInt32BE(300, 20);
  assert.deepEqual(inspectAvatarSource(url("png", png)), {
    width: 200,
    height: 300,
  });
  for (const source of [
    url("jpeg", jpg(12000, 12000)),
    url("heic", heic(12000, 12000)),
    url("png", Buffer.from("iVBORw0KGgo=", "base64")),
  ])
    assert.throws(() => inspectAvatarSource(source), /avatar_read_failed/);
});
test("malformed encoded output and oversized re-encodes fail closed instead of forwarding original bytes", () => {
  for (const output of [
    jpg(1025, 1),
    jpg().subarray(0, 15),
    Buffer.from([255, 216, 255, 225, 255, 255, 1]),
  ])
    assert.throws(
      () => sanitizeEncodedAvatarJpeg(output.toString("base64")),
      /avatar_read_failed/,
    );
  const invalidBox = heic(4000, 3000);
  invalidBox.writeUInt32BE(1, 0);
  assert.throws(
    () => inspectAvatarSource(url("heic", invalidBox)),
    /avatar_read_failed/,
  );
});
