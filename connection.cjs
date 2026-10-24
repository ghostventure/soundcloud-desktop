const { safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const redirect = 'http://127.0.0.1:49832/callback';
const catalogDescriptionLimit = 2000;
const catalogTrackLimit = 10000;
const catalogPageLimit = 200;
const catalogPageCountLimit = 50;
const apiResponseByteLimit = 16 * 1024 * 1024;

function apiError(message, { code, statusCode, retryAfterMs } = {}) {
  const error = Error(message);
  if (code) error.code = code;
  if (Number.isInteger(statusCode)) error.statusCode = statusCode;
  if (Number.isFinite(retryAfterMs)) error.retryAfterMs = retryAfterMs;
  return error;
}

function retryAfterMs(response, now = Date.now()) {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  let delay;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) delay = Number(header.trim()) * 1000;
  else {
    const when = Date.parse(header);
    if (Number.isFinite(when)) delay = Math.max(0, when - now);
  }
  return Number.isFinite(delay) ? Math.min(Math.max(0, delay), 24 * 60 * 60 * 1000) : undefined;
}

function boundedRetryMessage(status, wait) {
  const seconds = Number.isFinite(wait) ? Math.ceil(wait / 1000) : null;
  return `SoundCloud returned ${status}. ${status === 429 ? 'Rate limit reached.' : 'The service is temporarily unavailable.'}${seconds === null ? ' Please try again later.' : ` Try again in about ${seconds} seconds.`}`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validTrackId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d{1,20}$/.test(value) && /[1-9]/.test(value)) return value;
  return '';
}

function parseCatalogPage(data) {
  if (Array.isArray(data)) return { collection: data, nextHref: null };
  if (!isPlainObject(data) || !Array.isArray(data.collection)) {
    throw apiError('SoundCloud returned an invalid catalog page. The previous snapshot was preserved.', { code: 'SC_INVALID_PAGE' });
  }
  if (data.collection.length > catalogPageLimit) {
    throw apiError('SoundCloud returned an oversized catalog page. The previous snapshot was preserved.', { code: 'SC_PAGE_TOO_LARGE' });
  }
  if (data.next_href !== undefined && data.next_href !== null && (typeof data.next_href !== 'string' || !data.next_href.trim())) {
    throw apiError('SoundCloud returned an invalid pagination link. The previous snapshot was preserved.', { code: 'SC_INVALID_PAGINATION' });
  }
  return { collection: data.collection, nextHref: data.next_href || null };
}

function validatePaginationHref(href) {
  if (typeof href !== 'string' || !href.trim() || href.length > 4096 || /[\r\n]/.test(href)) {
    throw apiError('SoundCloud returned an invalid pagination link. The previous snapshot was preserved.', { code: 'SC_INVALID_PAGINATION' });
  }
  let target;
  try { target = new URL(href, 'https://api.soundcloud.com'); }
  catch { throw apiError('SoundCloud returned an invalid pagination link. The previous snapshot was preserved.', { code: 'SC_INVALID_PAGINATION' }); }
  if (target.protocol !== 'https:' || target.origin !== 'https://api.soundcloud.com' || target.username || target.password || target.port || target.hash) {
    throw apiError('SoundCloud returned an unsupported pagination address. The previous snapshot was preserved.', { code: 'SC_INVALID_PAGINATION' });
  }
  return target.toString();
}

function validateProfile(profile) {
  if (!isPlainObject(profile) || typeof profile.username !== 'string' || profile.username.length > 256) {
    throw apiError('SoundCloud returned an invalid account profile. The previous snapshot was preserved.', { code: 'SC_INVALID_PROFILE' });
  }
  for (const field of ['followers_count', 'track_count']) {
    if (profile[field] !== undefined && profile[field] !== null && (!Number.isSafeInteger(profile[field]) || profile[field] < 0)) {
      throw apiError('SoundCloud returned invalid account metrics. The previous snapshot was preserved.', { code: 'SC_INVALID_PROFILE' });
    }
  }
  return {
    username: profile.username,
    followers_count: Number.isSafeInteger(profile.followers_count) ? profile.followers_count : 0,
    track_count: Number.isSafeInteger(profile.track_count) ? profile.track_count : 0
  };
}

async function readJsonBounded(response, limit = apiResponseByteLimit) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw apiError('SoundCloud returned a response that exceeded the safe size limit.', { code: 'SC_RESPONSE_TOO_LARGE' });
  }
  if (!response.body) throw apiError('SoundCloud returned an empty response.', { code: 'SC_INVALID_RESPONSE' });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw apiError('SoundCloud returned a response that exceeded the safe size limit.', { code: 'SC_RESPONSE_TOO_LARGE' });
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw apiError('SoundCloud returned invalid JSON.', { code: 'SC_INVALID_RESPONSE' }); }
}

function snapshotTrack(track) {
  if (!isPlainObject(track) || !validTrackId(track.id) || typeof track.title !== 'string' || track.title.length > 1000) {
    throw apiError('SoundCloud returned an invalid track record. The previous snapshot was preserved.', { code: 'SC_INVALID_TRACK' });
  }
  for (const field of ['playback_count', 'likes_count', 'favoritings_count']) {
    if (track[field] !== undefined && track[field] !== null && (!Number.isSafeInteger(track[field]) || track[field] < 0)) {
      throw apiError('SoundCloud returned invalid track metrics. The previous snapshot was preserved.', { code: 'SC_INVALID_TRACK' });
    }
  }
  const permalink = typeof track.permalink_url === 'string' ? track.permalink_url : '';
  let safePermalink = '';
  if (permalink.length <= 2048) {
    try {
      const url = new URL(permalink);
      if (url.protocol === 'https:' && ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname) && !url.username && !url.password && !url.port) safePermalink = url.toString();
    } catch { /* The catalogue remains usable without a malformed permalink. */ }
  }
  return {
    id: track.id,
    title: track.title,
    sharing: typeof track.sharing === 'string' && track.sharing.length <= 32 ? track.sharing : '',
    playback_count: Number.isSafeInteger(track.playback_count) && track.playback_count >= 0 ? track.playback_count : 0,
    likes_count: Number.isSafeInteger(track.likes_count) && track.likes_count >= 0 ? track.likes_count : 0,
    favoritings_count: Number.isSafeInteger(track.favoritings_count) && track.favoritings_count >= 0 ? track.favoritings_count : 0,
    description: typeof track.description === 'string' ? track.description.slice(0, catalogDescriptionLimit) : '',
    permalink_url: safePermalink,
    streamable: track.streamable === true
  };
}

function appendSnapshotPage(tracks, data, seenIds) {
  const { collection, nextHref } = parseCatalogPage(data);
  if (collection.length > catalogPageLimit || tracks.length + collection.length > catalogTrackLimit) {
    throw apiError('Catalog exceeds this build’s 10,000-track sync limit. The previous snapshot was preserved.', { code: 'SC_CATALOG_LIMIT' });
  }
  for (const source of collection) {
    const track = snapshotTrack(source);
    const id = String(track.id);
    if (seenIds.has(id)) throw apiError('SoundCloud repeated a track across catalog pages. The previous snapshot was preserved.', { code: 'SC_DUPLICATE_TRACK' });
    seenIds.add(id);
    tracks.push(track);
  }
  return nextHref ? validatePaginationHref(nextHref) : null;
}

function validateSavedSnapshot(snapshot) {
  if (snapshot === null || snapshot === undefined) return null;
  if (!isPlainObject(snapshot) || !Array.isArray(snapshot.tracks) || snapshot.tracks.length > catalogTrackLimit) {
    throw Error('Saved SoundCloud catalog has an invalid format.');
  }
  if (!isPlainObject(snapshot.profile)) throw Error('Saved SoundCloud catalog has an invalid profile.');
  if (snapshot.profile.username !== undefined && (typeof snapshot.profile.username !== 'string' || snapshot.profile.username.length > 256)) throw Error('Saved SoundCloud catalog has an invalid profile.');
  for (const field of ['followers_count', 'track_count']) {
    const value = snapshot.profile[field];
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) throw Error('Saved SoundCloud catalog has invalid account metrics.');
  }
  if (snapshot.syncedAt !== undefined && typeof snapshot.syncedAt !== 'string') throw Error('Saved SoundCloud catalog has an invalid timestamp.');
  return structuredClone(snapshot);
}

function validateStoredVault(stored) {
  if (!isPlainObject(stored)) throw Error('Saved SoundCloud credentials have an invalid format.');
  if (stored.version === 2) {
    if (!Array.isArray(stored.accounts) || stored.accounts.length > 10 || (stored.activeAccountId !== undefined && typeof stored.activeAccountId !== 'string')) {
      throw Error('Saved SoundCloud account vault has an invalid format.');
    }
    const ids = new Set();
    const accounts = stored.accounts.map(item => {
      if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id)) {
        throw Error('Saved SoundCloud account vault has an invalid account record.');
      }
      ids.add(item.id);
      for (const key of ['label', 'clientId', 'clientSecret', 'accessToken', 'refreshToken']) {
        if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 65536)) {
          throw Error('Saved SoundCloud account vault has an invalid account record.');
        }
      }
      if (item.expires !== undefined && (!Number.isFinite(item.expires) || item.expires < 0)) {
        throw Error('Saved SoundCloud account vault has an invalid expiration time.');
      }
      return {
        ...structuredClone(item),
        id: item.id,
        label: (item.label || '').slice(0, 80),
        clientId: item.clientId || '',
        clientSecret: item.clientSecret || '',
        accessToken: item.accessToken || '',
        refreshToken: item.refreshToken || '',
        expires: Number(item.expires || 0),
        snapshot: validateSavedSnapshot(item.snapshot)
      };
    });
    const activeAccountId = stored.activeAccountId || '';
    return { vault: { version: 2, activeAccountId: ids.has(activeAccountId) ? activeAccountId : (accounts[0]?.id || ''), accounts }, migrated: false };
  }
  if (stored.version !== undefined) throw Error(`Saved SoundCloud account vault version ${String(stored.version)} is not supported by this app version.`);
  if (!['clientId', 'clientSecret', 'accessToken', 'refreshToken', 'expires', 'snapshot', 'label', 'id'].some(key => Object.hasOwn(stored, key))) {
    throw Error('The previous SoundCloud account record has an invalid format.');
  }
  for (const key of ['clientId', 'clientSecret', 'accessToken', 'refreshToken']) {
    if (stored[key] !== undefined && (typeof stored[key] !== 'string' || stored[key].length > 65536)) {
      throw Error('The previous SoundCloud account record has an invalid format.');
    }
  }
  if (stored.expires !== undefined && (!Number.isFinite(stored.expires) || stored.expires < 0)) {
    throw Error('The previous SoundCloud account record has an invalid expiration time.');
  }
  const snapshot = validateSavedSnapshot(stored.snapshot);
  const account = {
    ...structuredClone(stored),
    id: typeof stored.id === 'string' && stored.id && stored.id.length <= 100 ? stored.id : crypto.randomUUID(),
    label: String(stored.label || snapshot?.profile?.username || 'SoundCloud account').slice(0, 80),
    clientId: stored.clientId || '',
    clientSecret: stored.clientSecret || '',
    accessToken: stored.accessToken || '',
    refreshToken: stored.refreshToken || '',
    expires: Number(stored.expires || 0),
    snapshot
  };
  return { vault: { version: 2, activeAccountId: account.id, accounts: [account] }, migrated: true };
}

function createConnection(dir) {
  const file = path.join(dir, 'soundcloud.secure');
  let vault = { version: 2, activeAccountId: '', accounts: [] };
  let pending = false;
  let syncing = false;
  let needsMigration = false;
  if (fs.existsSync(file)) {
    let stored;
    try {
      if (!safeStorage.isEncryptionAvailable()) throw Error('Windows credential encryption is unavailable.');
      stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    } catch {
      throw Error('Saved SoundCloud credentials could not be decrypted by this Windows account.');
    }
    const parsed = validateStoredVault(stored);
    vault = parsed.vault;
    needsMigration = parsed.migrated;
  }
  if (!vault.accounts.length) {
    const first = { id: crypto.randomUUID(), label: 'SoundCloud account', clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expires: 0, snapshot: null };
    vault = { version: 2, activeAccountId: first.id, accounts: [first] };
  }
  const refreshingByAccount = new Map();

  function persist(nextVault = vault) {
    if (!safeStorage.isEncryptionAvailable()) throw Error('Windows credential encryption is unavailable.');
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(nextVault));
      descriptor = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(descriptor, encrypted);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temp, file);
      if (nextVault !== vault) {
        const previous = new Map(vault.accounts.map(item => [item.id, item]));
        const accounts = nextVault.accounts.map(item => {
          const existing = previous.get(item.id);
          if (!existing) return item;
          for (const key of Object.keys(existing)) if (!Object.hasOwn(item, key)) delete existing[key];
          Object.assign(existing, item);
          return existing;
        });
        vault.version = nextVault.version;
        vault.activeAccountId = nextVault.activeAccountId;
        vault.accounts = accounts;
      }
    } catch (error) {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Keep the original credential store intact. */ } }
      try { fs.rmSync(temp, { force: true }); } catch { /* Keep the original credential store intact. */ }
      throw error;
    }
  }

  if (needsMigration) persist();

  function active() {
    return vault.accounts.find(item => item.id === vault.activeAccountId) || null;
  }

  function accountStatus(record) {
    const username = record.snapshot?.profile?.username || '';
    return {
      id: record.id,
      label: record.label || username || 'SoundCloud account',
      username,
      configured: !!record.clientId,
      connected: !!record.accessToken
    };
  }

  function status() {
    const record = active();
    return {
      configured: !!record?.clientId,
      connected: !!record?.accessToken,
      snapshot: record?.snapshot || null,
      activeAccountId: record?.id || '',
      accounts: vault.accounts.map(accountStatus)
    };
  }

  async function token(record, params) {
    const response = await fetch('https://secure.soundcloud.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: record.clientId, client_secret: record.clientSecret, ...params }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      throw apiError('SoundCloud redirected the authorization request unexpectedly.', { code: 'SC_UNEXPECTED_REDIRECT', statusCode: response.status });
    }
    if (!response.ok) {
      const wait = retryAfterMs(response);
      await response.body?.cancel();
      throw apiError(response.status === 429 || response.status === 503
        ? boundedRetryMessage(response.status, wait)
        : `SoundCloud authorization failed (${response.status}). Check your app credentials and redirect address.`,
      { code: response.status === 429 ? 'SC_RATE_LIMITED' : 'SC_AUTH_FAILED', statusCode: response.status, retryAfterMs: wait });
    }
    const data = await readJsonBounded(response, 512 * 1024);
    if (!isPlainObject(data) || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 65536 ||
        typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 65536) {
      throw apiError('SoundCloud did not return a complete authorization.', { code: 'SC_INVALID_TOKEN_RESPONSE' });
    }
    const expiresIn = data.expires_in === undefined ? 3600 : data.expires_in;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 365 * 24 * 60 * 60) {
      throw apiError('SoundCloud returned an invalid token expiration.', { code: 'SC_INVALID_TOKEN_RESPONSE' });
    }
    const candidate = structuredClone(vault);
    const candidateRecord = candidate.accounts.find(item => item.id === record.id);
    if (!candidateRecord) throw Error('The connected SoundCloud account is no longer available.');
    candidateRecord.accessToken = data.access_token;
    candidateRecord.refreshToken = data.refresh_token;
    candidateRecord.expires = Date.now() + expiresIn * 1000;
    persist(candidate);
  }

  async function refreshIfNeeded(record) {
    if (Date.now() <= record.expires - 60000) return;
    let refreshing = refreshingByAccount.get(record.id);
    if (!refreshing) {
      refreshing = token(record, { grant_type: 'refresh_token', refresh_token: record.refreshToken })
        .finally(() => refreshingByAccount.delete(record.id));
      refreshingByAccount.set(record.id, refreshing);
    }
    await refreshing;
  }

  async function request(url, record = active()) {
    const target = new URL(url, 'https://api.soundcloud.com');
    if (target.protocol !== 'https:' || target.origin !== 'https://api.soundcloud.com' || target.username || target.password || target.port || target.hash) throw Error('Unexpected API pagination address.');
    if (!record?.accessToken) throw Error('Connect your SoundCloud account first.');
    await refreshIfNeeded(record);
    let current = target;
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(current, {
        headers: { Authorization: 'OAuth ' + record.accessToken, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(30000)
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3) throw apiError('SoundCloud returned an unsupported API redirect.', { code: 'SC_UNEXPECTED_REDIRECT', statusCode: response.status });
      let next;
      try { next = new URL(location, current); }
      catch { throw apiError('SoundCloud returned an invalid API redirect.', { code: 'SC_UNEXPECTED_REDIRECT', statusCode: response.status }); }
      if (next.protocol !== 'https:' || next.origin !== 'https://api.soundcloud.com' || next.username || next.password || next.port || next.hash) {
        throw apiError('SoundCloud returned an unsupported API redirect.', { code: 'SC_UNEXPECTED_REDIRECT', statusCode: response.status });
      }
      current = next;
    }
    if (!response.ok) {
      const wait = retryAfterMs(response);
      await response.body?.cancel();
      const rateLimited = response.status === 429 || response.status === 503;
      throw apiError(rateLimited ? boundedRetryMessage(response.status, wait) : `SoundCloud returned ${response.status}. Try reconnecting your account.`, {
        code: response.status === 429 ? 'SC_RATE_LIMITED' : response.status === 503 ? 'SC_TEMPORARILY_UNAVAILABLE' : 'SC_API_ERROR',
        statusCode: response.status,
        retryAfterMs: wait
      });
    }
    return readJsonBounded(response);
  }

  async function sync() {
    if (syncing) throw Error('A SoundCloud catalog sync is already running.');
    syncing = true;
    const record = active();
    try {
      const profile = validateProfile(await request('/me', record));
      const tracks = [];
      let next = '/me/tracks?linked_partitioning=true&limit=200';
      let pages = 0;
      const seenIds = new Set();
      const seenPages = new Set();
      while (next && pages++ < catalogPageCountLimit) {
        next = validatePaginationHref(next);
        if (seenPages.has(next)) throw apiError('SoundCloud repeated a catalog page. The previous snapshot was preserved.', { code: 'SC_PAGINATION_LOOP' });
        seenPages.add(next);
        const data = await request(next, record);
        next = appendSnapshotPage(tracks, data, seenIds);
      }
      if (next) throw Error('Catalog exceeds this build’s 10,000-track sync limit. Previous snapshot preserved.');
      const candidate = structuredClone(vault);
      const candidateRecord = candidate.accounts.find(item => item.id === record.id);
      if (!candidateRecord) throw Error('The connected SoundCloud account is no longer available.');
      candidateRecord.snapshot = {
        profile,
        tracks,
        syncedAt: new Date().toISOString()
      };
      if (!candidateRecord.label || candidateRecord.label === 'SoundCloud account') candidateRecord.label = profile.username || candidateRecord.label;
      persist(candidate);
      return status();
    } finally {
      syncing = false;
    }
  }

  async function preview(trackId, range = '') {
    const record = active();
    if (!record?.accessToken) throw Error('Connect your SoundCloud account to preview this track.');
    await refreshIfNeeded(record);
    const track = record.snapshot?.tracks?.find(item => String(item.id) === String(trackId));
    if (!track || track.streamable !== true || !/^\d+$/.test(String(track.id))) throw Error('This track is not available for preview through the SoundCloud API.');
    let target = new URL(`https://api.soundcloud.com/tracks/${track.id}/stream`);
    const requestHeaders = {};
    if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) requestHeaders.Range = range;
    let response;
    let authenticated = true;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const headers = { Accept: 'audio/*', ...requestHeaders };
      if (authenticated) headers.Authorization = 'OAuth ' + record.accessToken;
      response = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3) throw Error('SoundCloud returned an unsupported preview redirect.');
      target = new URL(location, target);
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !target.hostname.endsWith('.sndcdn.com')) {
        throw Error('SoundCloud returned an unsupported preview address.');
      }
      authenticated = false;
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:' || !(finalUrl.origin === 'https://api.soundcloud.com' || finalUrl.hostname.endsWith('.sndcdn.com'))) {
      await response.body?.cancel();
      throw Error('SoundCloud returned an unsupported preview address.');
    }
    if (![200, 206, 416].includes(response.status)) {
      await response.body?.cancel();
      throw Error('SoundCloud could not stream this track preview.');
    }
    const responseHeaders = new Headers();
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers.get(name);
      if (value && (name !== 'content-type' || /^(audio\/|application\/octet-stream)/i.test(value))) responseHeaders.set(name, value);
    }
    if (!responseHeaders.has('content-type')) responseHeaders.set('content-type', 'audio/mpeg');
    responseHeaders.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  }

  function credentials(id, secret) {
    const record = active();
    if (!record) throw Error('Add or configure a SoundCloud account first.');
    if (pending || syncing) throw Error('Finish the current SoundCloud operation first.');
    if (typeof id !== 'string' || typeof secret !== 'string' || !id || !secret || id.length > 4096 || secret.length > 4096) {
      throw Error('Enter both your Client ID and client secret.');
    }
    const candidate = structuredClone(vault);
    const target = candidate.accounts.find(item => item.id === record.id);
    target.clientId = id;
    target.clientSecret = secret;
    target.accessToken = '';
    target.refreshToken = '';
    target.expires = 0;
    target.snapshot = null;
    persist(candidate);
    return status();
  }

  function add(label) {
    if (pending || syncing) throw Error('Finish the current SoundCloud operation first.');
    const source = active();
    if (!source?.clientId || !source?.clientSecret) throw Error('Save your SoundCloud app credentials before adding another account.');
    if (vault.accounts.length >= 10) throw Error('You can save up to 10 SoundCloud accounts on this PC.');
    const name = typeof label === 'string' ? label.trim().slice(0, 80) : '';
    const candidate = structuredClone(vault);
    const record = { id: crypto.randomUUID(), label: name || 'New SoundCloud account', clientId: source.clientId, clientSecret: source.clientSecret, accessToken: '', refreshToken: '', expires: 0, snapshot: null };
    candidate.accounts.push(record);
    candidate.activeAccountId = record.id;
    persist(candidate);
    return status();
  }

  function switchTo(id) {
    if (pending || syncing) throw Error('Finish the current SoundCloud operation before switching accounts.');
    if (!vault.accounts.some(item => item.id === id)) throw Error('That saved SoundCloud account could not be found.');
    const candidate = structuredClone(vault);
    candidate.activeAccountId = id;
    persist(candidate);
    return status();
  }

  function remove(id) {
    if (pending || syncing) throw Error('Finish the current SoundCloud operation before removing an account.');
    if (vault.accounts.length < 2) throw Error('The last saved account cannot be removed.');
    const candidate = structuredClone(vault);
    const index = candidate.accounts.findIndex(item => item.id === id);
    if (index < 0) throw Error('That saved SoundCloud account could not be found.');
    candidate.accounts.splice(index, 1);
    if (candidate.activeAccountId === id) candidate.activeAccountId = candidate.accounts[0].id;
    persist(candidate);
    return status();
  }

  async function authorize() {
    const record = active();
    if (!record?.clientId) throw Error('Save your registered app credentials below first.');
    if (pending) throw Error('An authorization request is already open. Finish it in your browser.');
    pending = true;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    try {
      await new Promise((resolve, reject) => {
        let timer;
        let handled = false;
        const server = http.createServer(async (req, res) => {
          const url = new URL(req.url, redirect);
          if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
          if (handled || url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid authorization state.'); return; }
          handled = true;
          if (!url.searchParams.get('code')) {
            res.writeHead(400).end('Authorization was cancelled. Return to Soundcloud Desktop.');
            finish(Error('SoundCloud authorization was cancelled.'));
            return;
          }
          try {
            await token(record, { grant_type: 'authorization_code', redirect_uri: redirect, code_verifier: verifier, code: url.searchParams.get('code') });
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
              .end('<html><body style="background:#191a1d;color:#fafafa;font:18px Segoe UI;padding:60px"><h1>SoundCloud connected.</h1><p>You can close this tab and return to Soundcloud Desktop.</p></body></html>');
            finish();
          } catch (error) {
            res.writeHead(400).end('Connection failed. Return to the desktop app for details.');
            finish(error);
          }
        });
        let finished = false;
        const finish = error => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (server.listening) server.close();
          error ? reject(error) : resolve();
        };
        server.on('error', error => finish(Error(error.code === 'EADDRINUSE' ? 'The connection port is in use. Close the other connection attempt and try again.' : error.message)));
        server.listen(49832, '127.0.0.1', () => {
          const url = new URL('https://secure.soundcloud.com/authorize');
          url.search = new URLSearchParams({
            client_id: record.clientId,
            redirect_uri: redirect,
            response_type: 'code',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state
          }).toString();
          shell.openExternal(url.toString()).catch(finish);
        });
        timer = setTimeout(() => finish(Error('Connection timed out after five minutes. Try connecting again.')), 300000);
      });
      return await sync();
    } finally {
      pending = false;
    }
  }

  return {
    status,
    sync,
    credentials,
    add,
    switchTo,
    remove,
    async upload(file, metadata, options) {
      const record = active();
      await request('/me', record);
      return require('./upload.cjs').sendUpload(file, metadata, { ...options, token: record.accessToken });
    },
    disconnect() {
      if (pending) throw Error('Finish the current connection attempt first.');
      const record = active();
      if (record) {
        const candidate = structuredClone(vault);
        const target = candidate.accounts.find(item => item.id === record.id);
        target.accessToken = '';
        target.refreshToken = '';
        target.expires = 0;
        target.snapshot = null;
        persist(candidate);
      }
      return status();
    },
    authorize,
    preview
  };
}

module.exports = { createConnection };
