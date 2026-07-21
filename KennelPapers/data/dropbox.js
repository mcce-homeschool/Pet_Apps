// dropbox.js — Dropbox integration for backup push/pull (guide §9). Chosen
// because it works from an iPhone. PKCE OAuth + REST via plain fetch —
// deliberately no SDK, no CDN script (the no-CDN architecture rule stays
// intact; Dropbox's API sends CORS headers so this works straight from the
// browser).
//
// ⚠️ SETUP REQUIRED: register a free Dropbox app at
// https://www.dropbox.com/developers/apps — "Scoped access", "App folder"
// access type (confines this app to /Apps/Kennel Papers), and grant the
// `files.content.write` + `files.content.read` scopes. Paste its App key
// below. No client secret is needed (PKCE is for public/static clients).
// Also register the exact origin(s) this app is served from (localhost for
// dev, your GitHub Pages URL for prod) as OAuth redirect URIs.
const APP_KEY = 'REPLACE_WITH_YOUR_DROPBOX_APP_KEY';

import {
  getAccessToken as getCachedAccessToken, setAccessToken, getAccessExpiry,
  getRefreshToken, setRefreshToken, getPkceVerifier, setPkceVerifier,
  clearDropboxLink, isDropboxConnected
} from './settings.js';

function redirectUri() {
  return window.location.origin + window.location.pathname;
}

function base64url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(64))); // ~86 chars, within the 43-128 spec range
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function isConnected() {
  return isDropboxConnected();
}

// Step 1 of PKCE: generate a verifier/challenge pair, stash the verifier, and
// redirect to Dropbox's authorize page. Smoothest from a plain Safari tab;
// installed-PWA redirect handling is fiddlier but rare once connected.
export async function connect() {
  if (APP_KEY.startsWith('REPLACE_')) {
    throw new Error('Dropbox isn’t configured yet — set APP_KEY in data/dropbox.js (see the comment at the top of that file).');
  }
  const verifier = randomVerifier();
  setPkceVerifier(verifier);
  const challenge = await pkceChallenge(verifier);
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri(),
    scope: 'files.content.write files.content.read'
  });
  window.location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
}

// Step 2 of PKCE — call once on app boot. If the URL carries Dropbox's
// `?code=...` redirect, completes the token exchange and scrubs the URL.
// Returns true if a connect just completed (so the caller can toast/refresh).
export async function handleRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;

  const verifier = getPkceVerifier();
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.toString());
  if (!verifier) return false; // stray/duplicate redirect, nothing to complete

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: APP_KEY,
      redirect_uri: redirectUri()
    })
  });
  setPkceVerifier('');
  if (!res.ok) throw new Error('Dropbox connect failed — the authorization code was rejected or expired.');
  const data = await res.json();
  setRefreshToken(data.refresh_token);
  setAccessToken(data.access_token, data.expires_in);
  return true;
}

export async function disconnect() {
  const token = getCachedAccessToken();
  clearDropboxLink();
  if (token) {
    try {
      await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch { /* best-effort; local link is already cleared either way */ }
  }
}

// Returns a valid access token, silently refreshing via the stored refresh
// token when the cached one is missing or expired. No user interaction.
export async function getAccessToken() {
  const cached = getCachedAccessToken();
  if (cached && getAccessExpiry() > Date.now()) return cached;

  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('Dropbox is not connected.');

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: APP_KEY })
  });
  if (!res.ok) throw new Error('Dropbox session expired — reconnect it in Settings.');
  const data = await res.json();
  setAccessToken(data.access_token, data.expires_in);
  return data.access_token;
}

// Uploads (overwriting) a file at the app-folder root. `name` is a bare
// filename, e.g. "kennel-papers-backup-2026-07-21-1420.zip".
export async function upload(name, blob) {
  const token = await getAccessToken();
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: `/${name}`, mode: 'overwrite' })
    },
    body: await blob.arrayBuffer()
  });
  if (!res.ok) throw new Error(`Dropbox upload failed (HTTP ${res.status}).`);
  return res.json();
}

// Lists every backup in the app folder, newest first (by server_modified).
export async function listBackups() {
  const token = await getAccessToken();
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '' })
  });
  if (!res.ok) throw new Error(`Dropbox list failed (HTTP ${res.status}).`);
  const data = await res.json();
  const entries = (data.entries || []).filter((e) => e['.tag'] === 'file');
  entries.sort((a, b) => (a.server_modified < b.server_modified ? 1 : -1));
  return entries;
}

// Downloads a file (by its Dropbox path) as a Blob.
export async function download(path) {
  const token = await getAccessToken();
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path })
    }
  });
  if (!res.ok) throw new Error(`Dropbox download failed (HTTP ${res.status}).`);
  return res.blob();
}
