// settings.js — small localStorage-backed preferences. The single owner of
// localStorage in this app (everything else goes through a repo), mirroring
// KennelOS/Receipts's discipline. Guide §12.
//
// Keys (under `kennelPapers.*`):
//  - dropbox.refreshToken / accessToken / accessExpiry / pkceVerifier
//      the Dropbox link state (§9). pkceVerifier is transient — only needed
//      between "Connect" and the OAuth redirect back.
//  - lastBackupDate   ISO — for the "Last backup: N ago" label.
//  - autoPush         bool — whether auto-push-on-add/open is enabled
//                     (default on once connected).
const KEYS = {
  refreshToken: 'kennelPapers.dropbox.refreshToken',
  accessToken: 'kennelPapers.dropbox.accessToken',
  accessExpiry: 'kennelPapers.dropbox.accessExpiry',
  pkceVerifier: 'kennelPapers.dropbox.pkceVerifier',
  lastBackupDate: 'kennelPapers.lastBackupDate',
  autoPush: 'kennelPapers.autoPush'
};

// --- Dropbox link state ----------------------------------------------------
export function getRefreshToken() { return localStorage.getItem(KEYS.refreshToken) || ''; }
export function setRefreshToken(v) {
  if (v) localStorage.setItem(KEYS.refreshToken, v);
  else localStorage.removeItem(KEYS.refreshToken);
}

export function getAccessToken() { return localStorage.getItem(KEYS.accessToken) || ''; }
export function getAccessExpiry() {
  const n = Number(localStorage.getItem(KEYS.accessExpiry) || '0');
  return Number.isFinite(n) ? n : 0;
}
export function setAccessToken(token, expiresInSeconds) {
  localStorage.setItem(KEYS.accessToken, token || '');
  // Store as an epoch-ms expiry, a minute early to leave refresh headroom.
  const expiry = token ? Date.now() + (Math.max(0, expiresInSeconds - 60) * 1000) : 0;
  localStorage.setItem(KEYS.accessExpiry, String(expiry));
}

export function getPkceVerifier() { return localStorage.getItem(KEYS.pkceVerifier) || ''; }
export function setPkceVerifier(v) {
  if (v) localStorage.setItem(KEYS.pkceVerifier, v);
  else localStorage.removeItem(KEYS.pkceVerifier);
}

export function clearDropboxLink() {
  localStorage.removeItem(KEYS.refreshToken);
  localStorage.removeItem(KEYS.accessToken);
  localStorage.removeItem(KEYS.accessExpiry);
  localStorage.removeItem(KEYS.pkceVerifier);
}

export function isDropboxConnected() {
  return !!getRefreshToken();
}

// --- Auto-push ---------------------------------------------------------------
export function getAutoPush() {
  const v = localStorage.getItem(KEYS.autoPush);
  return v === null ? true : v === '1'; // default on once connected
}
export function setAutoPush(v) {
  localStorage.setItem(KEYS.autoPush, v ? '1' : '0');
}

// --- Backup ------------------------------------------------------------------
// When a full backup was last completed (local download or Dropbox push), so
// Settings can show "Last backup: N ago" next to the button.
export function getLastBackupDate() {
  return localStorage.getItem(KEYS.lastBackupDate); // ISO string or null
}
export function setLastBackupDate(iso = new Date().toISOString()) {
  localStorage.setItem(KEYS.lastBackupDate, iso);
}
