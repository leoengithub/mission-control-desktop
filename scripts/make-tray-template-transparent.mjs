import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('src-tauri/icons/tray-template.png');
const source = readFileSync(target);
const signature = source.subarray(0, 8);
const chunks = readChunks(source);
const header = chunks.find(({ type }) => type === 'IHDR')?.data;

if (!header || header.readUInt8(8) !== 8 || header.readUInt8(9) !== 6) {
  throw new Error('tray-template.png must be an 8-bit RGBA PNG');
}

const width = header.readUInt32BE(0);
const height = header.readUInt32BE(4);
const packed = Buffer.concat(chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data));
const pixels = unfilter(inflateSync(packed), width, height);
const alreadyTransparent = Array.from(
  { length: width * height },
  (_, index) => pixels[index * 4 + 3],
).some((alpha) => alpha < 255);

for (let index = 0; index < pixels.length; index += 4) {
  const luminance = Math.round(
    pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722,
  );
  pixels[index] = 0;
  pixels[index + 1] = 0;
  pixels[index + 2] = 0;
  pixels[index + 3] = alreadyTransparent ? pixels[index + 3] : 255 - luminance;
}

const scanlines = Buffer.alloc((width * 4 + 1) * height);
for (let row = 0; row < height; row += 1) {
  const offset = row * (width * 4 + 1);
  scanlines[offset] = 0;
  pixels.copy(scanlines, offset + 1, row * width * 4, (row + 1) * width * 4);
}

const output = Buffer.concat([
  signature,
  pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);
const temporary = `${target}.tmp`;
writeFileSync(temporary, output);
renameSync(temporary, target);
const alphaValues = Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]);
console.log(
  `Wrote ${target} with alpha range ${Math.min(...alphaValues)}-${Math.max(...alphaValues)}.`,
);

function readChunks(png) {
  const result = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    result.push({ type, data });
    offset += length + 12;
  }
  return result;
}

function unfilter(raw, width, height) {
  const stride = width * 4;
  const result = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const inputOffset = row * (stride + 1);
    const outputOffset = row * stride;
    const filter = raw[inputOffset];
    for (let column = 0; column < stride; column += 1) {
      const value = raw[inputOffset + column + 1];
      const left = column >= 4 ? result[outputOffset + column - 4] : 0;
      const above = row > 0 ? result[outputOffset + column - stride] : 0;
      const upperLeft = row > 0 && column >= 4 ? result[outputOffset + column - stride - 4] : 0;
      result[outputOffset + column] =
        filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + above
              : filter === 3
                ? value + Math.floor((left + above) / 2)
                : value + paeth(left, above, upperLeft);
    }
  }
  return result;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
