// zip.js — a minimal, dependency-free ZIP reader/writer (STORE method only, no
// compression). Used by backup.js (full app backup) and app.js (per-dog
// document pack). Copied verbatim from Receipts/data/zip.js — PDFs are already
// compressed, so DEFLATE would buy nothing; storing raw keeps this file small
// and auditable instead of vendoring a third-party zip library.
//
// Format reference: PKZIP APPNOTE — local file header, central directory,
// end-of-central-directory record. Only what's needed for store-only archives.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
  const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
  return { time, day };
}

// files: [{ name: string, data: Uint8Array }]. Returns a Blob (application/zip).
export function createZip(files) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // version needed
    local.setUint16(6, 0, true);        // flags
    local.setUint16(8, 0, true);        // method: 0 = store
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);    // compressed size
    local.setUint32(22, size, true);    // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);       // extra field length

    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);          // version made by
    cd.setUint16(6, 20, true);          // version needed
    cd.setUint16(8, 0, true);           // flags
    cd.setUint16(10, 0, true);          // method
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);          // extra length
    cd.setUint16(32, 0, true);          // comment length
    cd.setUint16(34, 0, true);          // disk number start
    cd.setUint16(36, 0, true);          // internal attrs
    cd.setUint32(38, 0, true);          // external attrs
    cd.setUint32(42, offset, true);     // local header offset

    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += local.byteLength + nameBytes.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

// Reads a store-only (or mixed, store entries only supported) ZIP ArrayBuffer.
// Returns [{ name, data: Uint8Array }]. Throws if no valid end-of-central-
// directory record is found, or an entry uses an unsupported compression method.
export async function readZip(blobOrBuffer) {
  const buf = blobOrBuffer instanceof Blob ? await blobOrBuffer.arrayBuffer() : blobOrBuffer;
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // Find EOCD by scanning backward for its signature (no comment support needed).
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('Not a valid backup file (no ZIP directory found).');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralStart = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder();
  const out = [];
  let p = centralStart;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Backup file is corrupt (bad central directory entry).');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (method !== 0) throw new Error(`Backup entry "${name}" uses unsupported compression.`);

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out.push({ name, data: bytes.slice(dataStart, dataStart + size) });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
