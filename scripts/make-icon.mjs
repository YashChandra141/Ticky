/**
 * Generates build/icon.ico (+ icon.png) with zero image dependencies:
 * a rounded ledger-green square with a white T, encoded as PNG and wrapped
 * in the ICO container (PNG-in-ICO, the Vista+ format electron-builder
 * and Windows both accept for 256px icons).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 256;
const RADIUS = 56;
const GREEN = [15, 107, 71];
const WHITE = [255, 255, 255];

function makePixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const inRoundedSquare = (x, y) => {
    const inner = SIZE - RADIUS;
    if (x >= RADIUS && x <= inner) return true;
    if (y >= RADIUS && y <= inner) return true;
    const cx = x < RADIUS ? RADIUS : inner;
    const cy = y < RADIUS ? RADIUS : inner;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= RADIUS * RADIUS;
  };
  const inT = (x, y) =>
    (x >= 56 && x <= 200 && y >= 64 && y <= 92) || // top bar
    (x >= 112 && x <= 144 && y >= 92 && y <= 204); // stem
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      if (!inRoundedSquare(x, y)) {
        pixels[i + 3] = 0;
        continue;
      }
      const [r, g, b] = inT(x, y) ? WHITE : GREEN;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(pixels) {
  const stride = SIZE * 4 + 1; // filter byte per row
  const raw = Buffer.alloc(SIZE * stride);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * stride] = 0; // filter: none
    pixels.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = encodePng(makePixels());

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // 1 image

const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 → 0
entry[1] = 0; // height 256 → 0
entry[2] = 0; // palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // bytes in resource
entry.writeUInt32LE(22, 12); // image data offset: 6 + 16

mkdirSync("build", { recursive: true });
writeFileSync("build/icon.png", png);
writeFileSync("build/icon.ico", Buffer.concat([header, entry, png]));
console.log("✓ wrote build/icon.ico and build/icon.png");
