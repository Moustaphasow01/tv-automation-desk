import { inflateSync, deflateSync } from "node:zlib";
import { requireFact } from "../domain/batch-contract.js";

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
}
const paeth = (a, b, c) => {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};

/** Lossless pixel crop, never OCR/resampling or a source-file write. */
function pngChunks(bytes) {
  requireFact(bytes.subarray(0, 8).equals(signature), "FORENSIC_PNG_INVALID");
  const data = [], chunks = new Map();
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    requireFact(offset + length + 12 <= bytes.length, "FORENSIC_PNG_INVALID");
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    requireFact(crc32(bytes.subarray(offset + 4, offset + 8 + length)) === bytes.readUInt32BE(offset + 8 + length), "FORENSIC_PNG_CRC_INVALID");
    if (type === "IDAT") data.push(payload); else chunks.set(type, payload);
    offset += length + 12;
  }
  return { data, chunks };
}

function cropShape({ header, x, y, width, height }) {
  const parentWidth = header.readUInt32BE(0), parentHeight = header.readUInt32BE(4);
  const channels = header[9] === 6 ? 4 : header[9] === 2 ? 3 : header[9] === 0 ? 1 : 0;
  requireFact(header[8] === 8 && channels && header[12] === 0, "FORENSIC_PNG_FORMAT_UNSUPPORTED");
  requireFact([x, y, width, height].every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= parentWidth && y + height <= parentHeight && parentWidth * parentHeight <= 32_000_000,
  "FORENSIC_CROP_BOUNDS_INVALID");
  return { parentWidth, parentHeight, channels };
}

export function cropForensicPng({ bytes, x, y, width, height }) {
  const { data, chunks } = pngChunks(bytes), header = chunks.get("IHDR");
  const { parentWidth, parentHeight, channels } = cropShape({ header, x, y, width, height });
  const stride = parentWidth * channels, raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * parentHeight });
  requireFact(raw.length === (stride + 1) * parentHeight, "FORENSIC_PNG_INVALID");
  const cropped = Buffer.alloc((width * channels + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < y + height; row++) {
    const decoded = unfilter({ raw, row, stride, channels, previous }); previous = decoded;
    if (row >= y) decoded.copy(cropped, (row - y) * (width * channels + 1) + 1, x * channels, (x + width) * channels);
  }
  const resized = Buffer.from(header); resized.writeUInt32BE(width, 0); resized.writeUInt32BE(height, 4);
  const output = [signature, chunk("IHDR", resized)];
  for (const type of ["sRGB", "gAMA", "cHRM", "tRNS"]) if (chunks.has(type)) output.push(chunk(type, chunks.get(type)));
  output.push(chunk("IDAT", deflateSync(cropped)), chunk("IEND", Buffer.alloc(0)));
  return { bytes: Buffer.concat(output), parent_width: parentWidth, parent_height: parentHeight, x, y, width, height };
}

function unfilter({ raw, row, stride, channels, previous }) {
  const start = row * (stride + 1), filter = raw[start], decoded = Buffer.alloc(stride);
  requireFact(filter <= 4, "FORENSIC_PNG_FILTER_UNSUPPORTED");
  for (let col = 0; col < stride; col++) {
    const a = col >= channels ? decoded[col - channels] : 0, b = previous[col], c = col >= channels ? previous[col - channels] : 0;
    const predictors = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)];
    decoded[col] = (raw[start + col + 1] + predictors[filter]) & 255;
  }
  return decoded;
}
