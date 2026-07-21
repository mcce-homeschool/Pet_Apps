// dropbox.js — minimal Dropbox client for the zero-cost sync features (the
// Import/Export page's push/pull and the KennelAssistant feed/outbox). Talks
// straight to the Dropbox HTTP API with fetch — no SDK, nothing vendored.
//
// Auth is OAuth2 + PKCE, which runs entirely client-side (no app secret, no
// backend), against a Dropbox app the OWNER creates once at
// https://www.dropbox.com/developers/apps with:
//   - Access type: "App folder" — tokens can only ever see /Apps/<app name>/,
//     never the rest of the Dropbox account;
//   - Redirect URIs: every page that calls beginDropboxAuth(), i.e. the
//     Import/Export page URL and the assistant.html URL (both the deployed
//     https://… addresses and http://localhost:8000/… for local dev).
// The app key is pasted into the connect UI and stored in settings; the flow
// stores a long-lived refresh token (token_access_type=offline) and mints
// short-lived access tokens from it as needed.
//
// These are cross-origin calls, so the service worker's cache-first fetch
// handler ignores them entirely — every sync action is live network, by design
// (the sync features are online-only; the rest of the app still works offline).
import { getDropboxSettings, setDropboxSettings, clearDropboxSettings } from './settings.js';

// The three files of the sync scheme, all relative to the app folder. Each has
// exactly one writer (see data/assistantSync.js for the full contract).
export const DROPBOX_PATHS = {
  backup: '/kennelos-backup.json',
  feed: '/assistant-feed.json',
  outbox: '/assistant-outbox.json'
};

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const CONTENT_URL = 'https://content.dropboxapi.com/2/files';

// Base64url without padding — the PKCE alphabet.
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The redirect URI is the calling page's own URL (no query/hash) — each page
// that offers "Connect" round-trips back to itself. Shown in the connect UI so
// it can be copy-pasted into the Dropbox app console's Redirect URIs list.
export function dropboxRedirectUri() {
  return location.origin + location.pathname;
}

export function isDropboxConnected() {
  const s = getDropboxSettings();
  return Boolean(s.appKey && s.refreshToken);
}

export function getDropboxAppKey() {
  return getDropboxSettings().appKey || '';
}

// Kick off the PKCE authorization redirect. Stores the app key + verifier
// (localStorage, so they survive the round-trip through dropbox.com), then
// navigates away; completeDropboxAuth() finishes the job when Dropbox sends
// the browser back with ?code=.
export async function beginDropboxAuth(appKey) {
  const key = String(appKey || '').trim();
  if (!key) throw new Error('Enter your Dropbox app key first.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  setDropboxSettings({ appKey: key, pkceVerifier: verifier });
  const params = new URLSearchParams({
    client_id: key,
    response_type: 'code',
    code_challenge: b64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    redirect_uri: dropboxRedirectUri(),
    token_access_type: 'offline'
  });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

// Call on page load from any page that offers Connect. If the URL carries the
// OAuth ?code= from Dropbox, exchange it for tokens and return true (the page
// should re-render its connection status); otherwise do nothing. The code is
// scrubbed from the URL either way so a reload never replays a spent code.
export async function completeDropboxAuth() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  history.replaceState(null, '', url.toString());

  const s = getDropboxSettings();
  if (!s.appKey || !s.pkceVerifier) {
    throw new Error('Dropbox sent back an authorization code, but no connection attempt is in progress. Try Connect again.');
  }
  const tokens = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    code_verifier: s.pkceVerifier,
    client_id: s.appKey,
    redirect_uri: dropboxRedirectUri()
  });
  setDropboxSettings({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
    pkceVerifier: null
  });
  return true;
}

// Forget the tokens (and cached access token). The app key is kept so
// reconnecting doesn't mean digging it out of the Dropbox console again.
export function disconnectDropbox() {
  const { appKey } = getDropboxSettings();
  clearDropboxSettings();
  if (appKey) setDropboxSettings({ appKey });
}

async function tokenRequest(fields) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
  } catch {
    throw new Error('Could not reach Dropbox — check your internet connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(`Dropbox sign-in failed: ${detail}`);
  }
  return body;
}

// A valid short-lived access token, minting a fresh one from the refresh token
// when the cached one is missing/expired.
async function getAccessToken({ force = false } = {}) {
  const s = getDropboxSettings();
  if (!s.appKey || !s.refreshToken) {
    throw new Error('Not connected to Dropbox — use Connect first.');
  }
  if (!force && s.accessToken && s.accessTokenExpiresAt && Date.now() < s.accessTokenExpiresAt) {
    return s.accessToken;
  }
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
    client_id: s.appKey
  });
  setDropboxSettings({
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000
  });
  return tokens.access_token;
}

// One content-endpoint call, retried once with a forced token refresh on 401
// (an access token can be revoked/expired ahead of its cached expiry).
async function contentCall(endpoint, apiArg, body) {
  const attempt = async (force) => {
    const token = await getAccessToken({ force });
    try {
      return await fetch(`${CONTENT_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          // Fixed ASCII paths only, so plain JSON.stringify is header-safe here.
          'Dropbox-API-Arg': JSON.stringify(apiArg),
          ...(body != null ? { 'Content-Type': 'application/octet-stream' } : {})
        },
        ...(body != null ? { body } : {})
      });
    } catch {
      throw new Error('Could not reach Dropbox — check your internet connection.');
    }
  };
  let res = await attempt(false);
  if (res.status === 401) res = await attempt(true);
  return res;
}

// Store `obj` as pretty-printed JSON at `path` (relative to the app folder,
// e.g. '/kennelos-backup.json'), overwriting whatever is there.
export async function dropboxUploadJson(path, obj) {
  const res = await contentCall('upload',
    { path, mode: 'overwrite', mute: true },
    JSON.stringify(obj, null, 2));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox upload of ${path} failed: ${summarize(res, text)}`);
  }
  return res.json();
}

// Fetch and parse the JSON file at `path`. Returns null when the file simply
// doesn't exist yet (nothing has been pushed) — every other failure throws.
export async function dropboxDownloadJson(path) {
  const res = await contentCall('download', { path });
  if (res.status === 409) {
    const text = await res.text().catch(() => '');
    if (text.includes('not_found')) return null;
    throw new Error(`Dropbox download of ${path} failed: ${summarize(res, text)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox download of ${path} failed: ${summarize(res, text)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The file at ${path} in Dropbox is not valid JSON.`);
  }
}

function summarize(res, text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.error_summary) return parsed.error_summary;
  } catch { /* fall through to the raw status */ }
  return `HTTP ${res.status}`;
}
