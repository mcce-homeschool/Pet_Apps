// backup.js — full data-loss-protection export/import: every dog, document,
// AND file's original PDF bytes, bundled into one .zip (guide §10). This is
// the only real data-loss protection — the files are the whole value of the
// app. Mirrors Receipts/data/backup.js structure.
//
// Archive layout:
//   manifest.json    { app, version, created_at, dog_count, document_count, file_count }
//   dogs.json        every dogs row (incl. archived)
//   documents.json   every documents row (incl. archived)
//   files.json       file metadata (id, mime, filename, size, thumbnail, created_at)
//   settings.json    small localStorage prefs (Dropbox link state, auto-push, last backup)
//   files/<id>.pdf   the actual bytes, one per file
//
// Restore is additive: dogs/documents/files are upserted by id (never deletes
// anything not in the archive), so it's safe to restore onto a fresh device
// OR re-run onto an existing one without duplicating anything.
//
// ⚠️ settings.json carries the Dropbox refresh token so a "restore from file"
// onto the same Dropbox-linked device round-trips cleanly. That token is
// scoped to this app's own Dropbox app-folder (limited blast radius), but
// it's still a live credential — don't hand a full backup .zip to anyone you
// wouldn't hand Dropbox app-folder access to. (A per-dog document pack, built
// separately in app.js, never includes settings.json.)
import { dogRepo } from './dogRepo.js';
import { documentRepo } from './documentRepo.js';
import { fileRepo } from './fileRepo.js';
import { createZip, readZip } from './zip.js';
import { upload as dropboxUpload } from './dropbox.js';
import {
  getRefreshToken, setRefreshToken, getAutoPush, setAutoPush,
  setLastBackupDate, getLastBackupDate
} from './settings.js';

const APP_TAG = 'kennel-papers-backup';
const FORMAT_VERSION = 1;

function settingsSnapshot() {
  return {
    dropboxRefreshToken: getRefreshToken(),
    autoPush: getAutoPush()
  };
}

// Builds the archive and returns { blob, counts }. Does not trigger a
// download or Dropbox push itself — see downloadBackup()/pushToDropbox().
export async function buildBackup() {
  const dogs = await dogRepo.getAll({ includeArchived: true });
  const documents = await documentRepo.getAll({ includeArchived: true });
  const files = await fileRepo.getAll();
  const encoder = new TextEncoder();

  const manifest = {
    app: APP_TAG,
    version: FORMAT_VERSION,
    created_at: new Date().toISOString(),
    dog_count: dogs.length,
    document_count: documents.length,
    file_count: files.length
  };

  const fileMeta = [];
  const zipFiles = [
    { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'dogs.json', data: encoder.encode(JSON.stringify(dogs, null, 2)) },
    { name: 'documents.json', data: encoder.encode(JSON.stringify(documents, null, 2)) },
    { name: 'settings.json', data: encoder.encode(JSON.stringify(settingsSnapshot(), null, 2)) }
  ];

  for (const f of files) {
    fileMeta.push({ id: f.id, mime: f.mime, filename: f.filename, size: f.size, thumbnail: f.thumbnail || '', created_at: f.created_at });
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    zipFiles.push({ name: `files/${f.id}.pdf`, data: bytes });
  }
  zipFiles.splice(4, 0, { name: 'files.json', data: encoder.encode(JSON.stringify(fileMeta, null, 2)) });

  const blob = createZip(zipFiles);
  return { blob, counts: { dogCount: dogs.length, documentCount: documents.length, fileCount: files.length } };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// Builds, downloads, and records the backup timestamp.
export async function downloadBackup() {
  const { blob, counts } = await buildBackup();
  downloadBlob(`kennel-papers-backup-${stamp()}.zip`, blob);
  setLastBackupDate();
  return counts;
}

// Builds and uploads to the connected Dropbox app folder (overwrite by
// filename would only collide within the same minute; the stamp includes
// hours/minutes so this simply adds a new dated backup each push).
export async function pushToDropbox() {
  const { blob, counts } = await buildBackup();
  await dropboxUpload(`kennel-papers-backup-${stamp()}.zip`, blob);
  setLastBackupDate();
  return counts;
}

// Parses a backup file without writing anything, so the caller can confirm
// with the user before committing. Throws with a user-legible message on any
// malformed / unrecognized file.
export async function inspectBackup(file) {
  const parts = await readZip(file);
  const byName = new Map(parts.map((p) => [p.name, p]));
  const manifestPart = byName.get('manifest.json');
  const dogsPart = byName.get('dogs.json');
  const documentsPart = byName.get('documents.json');
  if (!manifestPart || !dogsPart || !documentsPart) throw new Error('That file isn’t a Kennel Papers backup.');

  const decoder = new TextDecoder();
  let manifest;
  try { manifest = JSON.parse(decoder.decode(manifestPart.data)); } catch { throw new Error('That file isn’t a Kennel Papers backup.'); }
  if (manifest.app !== APP_TAG) throw new Error('That file isn’t a Kennel Papers backup.');

  const dogs = JSON.parse(decoder.decode(dogsPart.data));
  const documents = JSON.parse(decoder.decode(documentsPart.data));
  const fileMetaPart = byName.get('files.json');
  const fileMeta = fileMetaPart ? JSON.parse(decoder.decode(fileMetaPart.data)) : [];
  const settingsPart = byName.get('settings.json');
  const settings = settingsPart ? JSON.parse(decoder.decode(settingsPart.data)) : null;

  return { manifest, dogs, documents, fileMeta, settings, parts: byName };
}

// Writes an inspected backup into the DB (upsert by id) and merges settings.
// Returns counts actually written.
export async function restoreBackup({ dogs, documents, fileMeta, settings, parts }) {
  for (const row of dogs) await dogRepo.putRaw(row);
  for (const row of documents) await documentRepo.putRaw(row);

  let filesWritten = 0;
  for (const meta of fileMeta) {
    const part = parts.get(`files/${meta.id}.pdf`);
    if (!part) continue;
    const blob = new Blob([part.data], { type: meta.mime || 'application/pdf' });
    await fileRepo.putRaw({
      id: meta.id, blob, mime: meta.mime || 'application/pdf',
      filename: meta.filename || `${meta.id}.pdf`, size: meta.size ?? blob.size,
      thumbnail: meta.thumbnail || '', created_at: meta.created_at
    });
    filesWritten++;
  }

  if (settings) {
    // Never clobber an existing Dropbox link/preference already set on this
    // device with a stale one from the archive.
    if (settings.dropboxRefreshToken && !getRefreshToken()) setRefreshToken(settings.dropboxRefreshToken);
    if (typeof settings.autoPush === 'boolean') setAutoPush(settings.autoPush);
  }

  return { dogCount: dogs.length, documentCount: documents.length, fileCount: filesWritten };
}

// "3 days ago" / "today" / "never" — for the label next to the backup button.
export function lastBackupLabel() {
  const iso = getLastBackupDate();
  if (!iso) return 'Never backed up';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Last backup: today';
  if (days === 1) return 'Last backup: yesterday';
  return `Last backup: ${days} days ago`;
}
