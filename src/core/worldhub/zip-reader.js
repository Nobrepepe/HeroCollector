// Minimal ZIP extraction for World Hub packages (stored + deflate),
// with hostile-entry rejection. Node-only (main process and tests);
// package checksums are verified after extraction, so this reader only
// needs to be correct, not clever.
import { inflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

/** Parse the central directory: [{ name, compressed, method, offset, size }] */
export function listZipEntries(buffer) {
  let eocd = -1;
  const scanFrom = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= scanFrom; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new ZipError('The file is not a readable ZIP archive.');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new ZipError('The archive central directory is damaged.');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttr = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, externalAttr });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  const local = entry.localOffset;
  if (buffer.readUInt32LE(local) !== 0x04034b50) {
    throw new ZipError('A local file header is damaged.');
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new ZipError('The archive uses an unsupported compression method.');
}

/** Extract safely into destination; refuses hostile names outright. */
export function extractZipSafely(buffer, destination) {
  const entries = listZipEntries(buffer);
  const seen = new Set();
  const resolvedDestination = resolve(destination);
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (seen.has(entry.name)) {
      throw new ZipError('The archive contains duplicate entries and was rejected.');
    }
    seen.add(entry.name);
    const normalized = entry.name.replaceAll('\\', '/');
    const parts = normalized.split('/');
    if (normalized.startsWith('/') || parts.includes('..') || parts[0].includes(':')) {
      throw new ZipError('The archive contains unsafe file paths and was rejected.');
    }
    if (((entry.externalAttr >>> 16) & 0o170000) === 0o120000) {
      throw new ZipError('The archive contains symbolic links and was rejected.');
    }
    const target = resolve(join(destination, ...parts));
    if (target !== resolvedDestination && !target.startsWith(resolvedDestination + sep)) {
      throw new ZipError('The archive contains unsafe file paths and was rejected.');
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readEntry(buffer, entry));
  }
}
