// fileRepo.js — the file archive. One row per stored PDF (guide §4.3), analog
// of Receipts' photoRepo. Every file's mime is 'application/pdf' in normal use
// — photos are converted to PDF by pdfBuild.js before they ever reach here, so
// view / dog-pack / backup treat every document identically.
import { db } from './db.js';

export const fileRepo = {
  // blob: the PDF bytes. opts.thumbnail: a data-URL, present for photo-sourced
  // docs (blank for uploaded PDFs, which show a doc-type icon instead).
  async create(blob, { filename = '', thumbnail = '' } = {}) {
    const id = crypto.randomUUID();
    await db.files.put({
      id,
      blob,
      mime: blob.type || 'application/pdf',
      filename: filename || `${id}.pdf`,
      size: blob.size || 0,
      thumbnail: thumbnail || '',
      created_at: new Date().toISOString()
    });
    return id;
  },

  async get(id) {
    if (!id) return null;
    return (await db.files.get(id)) || null;
  },

  async getThumbnail(id) {
    const f = await fileRepo.get(id);
    return f?.thumbnail || '';
  },

  // A fresh object URL for the full PDF. Caller must revokeObjectURL when done.
  async getObjectUrl(id) {
    const f = await fileRepo.get(id);
    if (!f?.blob) return '';
    return URL.createObjectURL(f.blob);
  },

  async remove(id) {
    if (id) await db.files.delete(id);
  },

  // Every file row, for backup export. Includes the Blob — caller streams it
  // into the archive rather than holding many in memory at once where it can.
  async getAll() {
    return db.files.toArray();
  },

  // Metadata only (no blob) — for the document list, which needs a file's
  // thumbnail/filename for many rows at once without holding every PDF blob.
  async getAllMeta() {
    const rows = await db.files.toArray();
    return rows.map(({ blob, ...meta }) => meta);
  },

  // Restore only — upserts a full row as-is (id, blob, mime, filename, size,
  // thumbnail, created_at).
  async putRaw(record) {
    await db.files.put(record);
  }
};
