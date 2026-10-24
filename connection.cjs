const { safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const redirect = 'http://127.0.0.1:49832/callback';
const catalogDescriptionLimit = 2000;
const catalogTrackLimit = 10000;
const catalogMetricHistoryLimit = 366;
const catalogPageLimit = 200;
const catalogPageCountLimit = 50;
const activityPageLimit = 3;
const activityItemLimit = 150;
const catalogTombstoneLimit = 10000;
const apiResponseByteLimit = 16 * 1024 * 1024;
const catalogExtraFieldLimit = 16;
const catalogExtraValueLimit = 512;
const catalogExtraByteLimit = 256 * 1024;
const catalogFreshnessWindowMs = 24 * 60 * 60 * 1000;
const syncCheckpointByteLimit = 4096;
const accountCooldownByteLimit = 4096;
const oauthScopeLengthLimit = 2048;
const oauthScopeCountLimit = 32;
const oauthScopeTokenLengthLimit = 128;
const apiQuotaSnapshotLimit = 16;
const apiQuotaStaticPathSegments = new Set([
  'me', 'tracks', 'users', 'playlists', 'comments', 'favorites', 'likes', 'reposts', 'stream', 'download',
  'resolve', 'search', 'web-profiles', 'oauth', 'followings', 'followers', 'activities', 'connections'
]);
const apiCallTimeoutMs = 30000;
const catalogSyncDeadlineMs = 5 * 60 * 1000;
const apiCircuitFailureLimit = 3;
const apiCircuitCooldownMs = 30000;

const apiCircuitByAccount = new Map();
const catalogFieldPolicy = Object.freeze({
  id: { source: 'soundcloud-api', conflict: 'remote-identity' },
  urn: { source: 'soundcloud-api', conflict: 'remote-identity' },
  legacy_id: { source: 'soundcloud-api', conflict: 'remote-identity' },
  title: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  sharing: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  playback_count: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  likes_count: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  favoritings_count: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  description: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  permalink_url: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  streamable: { source: 'soundcloud-api', conflict: 'remote-snapshot-wins' },
  apiExtras: { source: 'soundcloud-api', conflict: 'preserve-bounded-unknown-primitives' }
});
const normalizedTrackFields = new Set([
  'id', 'urn', 'legacy_id', 'title', 'sharing', 'playback_count', 'likes_count',
  'favoritings_count', 'description', 'permalink_url', 'streamable'
]);

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

function sanitizeOAuthScope(value, secrets = []) {
  if (typeof value !== 'string' || value.length > oauthScopeLengthLimit || /[\r\n\t]/.test(value)) return null;
  const normalized = value.trim();
  if (!normalized) return '';
  const scopes = normalized.split(/ +/);
  const tokenPattern = /^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/;
  if (scopes.length > oauthScopeCountLimit || scopes.some(scope => scope.length > oauthScopeTokenLengthLimit || !tokenPattern.test(scope))) return null;
  const hidden = new Set(secrets.filter(secret => typeof secret === 'string' && secret));
  return [...new Set(scopes.filter(scope => !hidden.has(scope)))].join(' ');
}

function quotaHeader(headers, name) {
  let value;
  try {
    value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name.toLowerCase()];
  } catch { return ''; }
  return typeof value === 'string' ? value.trim() : '';
}

function parseQuotaInteger(value) {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function quotaRoute(url, method) {
  let target;
  try { target = url instanceof URL ? url : new URL(url); }
  catch { return ''; }
  if (target.origin !== 'https://api.soundcloud.com' || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) return '';
  const segments = target.pathname.split('/').map(segment => {
    if (!segment) return '';
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { return ':resource'; }
    if (/^soundcloud:(?:tracks|users|playlists):\d{1,128}$/i.test(decoded)) return ':urn';
    if (/^\d{1,128}$/.test(decoded)) return ':id';
    return apiQuotaStaticPathSegments.has(decoded.toLowerCase()) ? decoded.toLowerCase() : ':resource';
  }).join('/');
  const route = segments.startsWith('/') ? segments : `/${segments}`;
  return route.length <= 256 ? route : '';
}

function observedQuotaSnapshot(headers, url, method, now = Date.now()) {
  const limit = parseQuotaInteger(quotaHeader(headers, 'x-ratelimit-limit'));
  const remaining = parseQuotaInteger(quotaHeader(headers, 'x-ratelimit-remaining'));
  const resetSeconds = parseQuotaInteger(quotaHeader(headers, 'x-ratelimit-reset'));
  const route = quotaRoute(url, method);
  if (limit === null || remaining === null || resetSeconds === null || remaining > limit || !route) return null;
  const resetAtMs = resetSeconds * 1000;
  if (!Number.isSafeInteger(resetAtMs) || !Number.isFinite(new Date(resetAtMs).getTime()) || resetAtMs <= now) return null;
  return {
    method,
    route,
    limit,
    remaining,
    resetAt: new Date(resetAtMs).toISOString(),
    observedAt: new Date(now).toISOString()
  };
}

function boundedRetryMessage(status, wait) {
  const seconds = Number.isFinite(wait) ? Math.ceil(wait / 1000) : null;
  return `SoundCloud returned ${status}. ${status === 429 ? 'Rate limit reached.' : 'The service is temporarily unavailable.'}${seconds === null ? ' Please try again later.' : ` Try again in about ${seconds} seconds.`}`;
}

function classifyNetworkError(error, deadlineAt) {
  if (error?.code && String(error.code).startsWith('SC_')) return error;
  if (deadlineAt && Date.now() >= deadlineAt) {
    return apiError('SoundCloud operation exceeded its time limit. Your previous catalog snapshot was preserved.', { code: 'SC_DEADLINE_EXCEEDED' });
  }
  if (error?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(error?.cause?.code)) {
    return apiError('SoundCloud request timed out. Check your connection and try again.', { code: 'SC_NETWORK_TIMEOUT' });
  }
  if (error?.name === 'AbortError') return apiError('SoundCloud request was interrupted.', { code: 'SC_REQUEST_ABORTED' });
  const networkCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'];
  if (networkCodes.includes(error?.code) || networkCodes.includes(error?.cause?.code)) {
    return apiError('Could not reach SoundCloud. Check your internet connection and try again.', { code: 'SC_NETWORK_UNAVAILABLE' });
  }
  return apiError('SoundCloud request failed. Check your connection and try again.', { code: 'SC_NETWORK_ERROR' });
}

function requestSignal(deadlineAt) {
  const remaining = deadlineAt ? deadlineAt - Date.now() : apiCallTimeoutMs;
  if (remaining <= 0) throw classifyNetworkError(Error('deadline'), deadlineAt);
  return AbortSignal.timeout(Math.min(apiCallTimeoutMs, remaining));
}

function requestHeaderTimeout(deadlineAt) {
  const remaining = deadlineAt ? deadlineAt - Date.now() : apiCallTimeoutMs;
  if (remaining <= 0) throw classifyNetworkError(Error('deadline'), deadlineAt);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out.', 'TimeoutError')), Math.min(apiCallTimeoutMs, remaining));
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function apiCircuitFor(accountId) {
  let circuit = apiCircuitByAccount.get(accountId);
  if (!circuit) {
    circuit = { consecutiveFailures: 0, openedUntil: 0, probeInFlight: false };
    apiCircuitByAccount.set(accountId, circuit);
  }
  return circuit;
}

function enterApiCircuit(accountId) {
  const apiCircuit = apiCircuitFor(accountId);
  const now = Date.now();
  if (apiCircuit.openedUntil > now) {
    const wait = apiCircuit.openedUntil - now;
    throw apiError(`SoundCloud is temporarily unavailable after repeated failures. Try again in about ${Math.ceil(wait / 1000)} seconds.`, {
      code: 'SC_CIRCUIT_OPEN', retryAfterMs: wait
    });
  }
  if (apiCircuit.openedUntil && apiCircuit.probeInFlight) {
    throw apiError('SoundCloud is checking whether the service has recovered. Try again shortly.', { code: 'SC_CIRCUIT_PROBING', retryAfterMs: 1000 });
  }
  if (apiCircuit.openedUntil) apiCircuit.probeInFlight = true;
}

function recordApiSuccess(accountId, persistCircuitCooldowns) {
  const apiCircuit = apiCircuitFor(accountId);
  const wasOpen = apiCircuit.openedUntil > 0;
  apiCircuit.consecutiveFailures = 0;
  apiCircuit.openedUntil = 0;
  apiCircuit.probeInFlight = false;
  if (wasOpen) persistCircuitCooldowns?.();
}

function recordApiFailure(error, accountId, persistCircuitCooldowns) {
  const apiCircuit = apiCircuitFor(accountId);
  apiCircuit.probeInFlight = false;
  const counts = error?.statusCode >= 500 || ['SC_NETWORK_TIMEOUT', 'SC_NETWORK_UNAVAILABLE', 'SC_NETWORK_ERROR', 'SC_DEADLINE_EXCEEDED'].includes(error?.code);
  if (!counts) return;
  apiCircuit.consecutiveFailures++;
  if (apiCircuit.consecutiveFailures >= apiCircuitFailureLimit) {
    apiCircuit.openedUntil = Date.now() + apiCircuitCooldownMs;
    persistCircuitCooldowns?.();
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validTrackUrn(value) {
  if (typeof value !== 'string' || value.length > 160 || !/^soundcloud:tracks:\d{1,128}$/.test(value)) return '';
  const digits = value.slice('soundcloud:tracks:'.length).replace(/^0+/, '');
  return digits ? `soundcloud:tracks:${digits}` : '';
}

function validLegacyTrackId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d{1,128}$/.test(value) && /[1-9]/.test(value)) return value;
  return '';
}

function validSoundCloudUserUrn(value) {
  if (typeof value !== 'string' || value.length > 160 || !/^soundcloud:users:\d{1,128}$/.test(value)) return '';
  const digits = value.slice('soundcloud:users:'.length).replace(/^0+/, '');
  return digits ? `soundcloud:users:${digits}` : '';
}

function soundCloudUserUrn(profile) {
  const urns = [profile?.urn, profile?.id]
    .map(validSoundCloudUserUrn)
    .filter(Boolean);
  const uniqueUrns = [...new Set(urns)];
  const numericIds = [profile?.id, profile?.legacy_id]
    .map(validLegacyTrackId)
    .filter(Boolean);
  const normalizedIds = [...new Set(numericIds.map(value => value.replace(/^0+/, '') || '0'))];
  if (uniqueUrns.length > 1 || normalizedIds.length > 1 ||
      (uniqueUrns.length && normalizedIds.length && uniqueUrns[0].slice('soundcloud:users:'.length) !== normalizedIds[0])) {
    throw apiError('SoundCloud returned conflicting account identifiers. The previous catalog snapshot was preserved.', { code: 'SC_INVALID_PROFILE' });
  }
  return uniqueUrns[0] || (normalizedIds[0] ? `soundcloud:users:${normalizedIds[0]}` : '');
}

function trackKey(track) {
  const urn = validTrackUrn(track?.urn) || validTrackUrn(track?.id);
  if (urn) return urn;
  const legacyId = validLegacyTrackId(track?.id) || validLegacyTrackId(track?.legacy_id);
  return legacyId ? `soundcloud:tracks:${legacyId}` : '';
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

function validateActivityPaginationHref(href) {
  const value = validatePaginationHref(href);
  const target = new URL(value);
  if (!['/me/feed', '/me/activities'].includes(target.pathname)) {
    throw apiError('SoundCloud returned an unsupported activity pagination link.', { code: 'SC_INVALID_ACTIVITY_PAGINATION' });
  }
  for (const [key, item] of target.searchParams) {
    if (key === 'limit' && /^(?:[1-9]\d{0,2})$/.test(item) && Number(item) <= 200) continue;
    if (key === 'page_size' && /^(?:[1-9]\d{0,2})$/.test(item) && Number(item) <= 200) continue;
    if (key === 'cursor' && item.length > 0 && item.length <= 1024 && !/[\r\n]/.test(item)) continue;
    if (key === 'linked_partitioning' && item === 'true') continue;
    throw apiError('SoundCloud returned an unsupported activity pagination link.', { code: 'SC_INVALID_ACTIVITY_PAGINATION' });
  }
  return value;
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
  const urn = soundCloudUserUrn(profile);
  return {
    username: profile.username,
    followers_count: Number.isSafeInteger(profile.followers_count) ? profile.followers_count : 0,
    track_count: Number.isSafeInteger(profile.track_count) ? profile.track_count : 0,
    ...(urn ? { urn } : {})
  };
}

async function readJsonBounded(response, limit = apiResponseByteLimit, deadlineAt) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw apiError('SoundCloud returned a response that exceeded the safe size limit.', { code: 'SC_RESPONSE_TOO_LARGE' });
  }
  if (!response.body) throw apiError('SoundCloud returned an empty response.', { code: 'SC_INVALID_RESPONSE' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw apiError('SoundCloud returned a response that exceeded the safe size limit.', { code: 'SC_RESPONSE_TOO_LARGE' });
      }
      try { text += decoder.decode(value, { stream: true }); }
      catch { await reader.cancel().catch(() => {}); throw apiError('SoundCloud returned invalid UTF-8.', { code: 'SC_INVALID_RESPONSE' }); }
    }
    try { text += decoder.decode(); }
    catch { throw apiError('SoundCloud returned invalid UTF-8.', { code: 'SC_INVALID_RESPONSE' }); }
  } catch (error) {
    if (['SC_RESPONSE_TOO_LARGE', 'SC_INVALID_RESPONSE'].includes(error?.code)) throw error;
    throw classifyNetworkError(error, deadlineAt);
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text); }
  catch { throw apiError('SoundCloud returned invalid JSON.', { code: 'SC_INVALID_RESPONSE' }); }
}

function snapshotTrack(track, extraBudget) {
  const urn = validTrackUrn(track?.urn) || validTrackUrn(track?.id);
  const legacyId = validLegacyTrackId(track?.id) || validLegacyTrackId(track?.legacy_id);
  if (!isPlainObject(track) || (!urn && !legacyId) || (track.urn !== undefined && track.urn !== null && !validTrackUrn(track.urn)) || typeof track.title !== 'string' || track.title.length > 1000) {
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
  const apiExtras = Object.create(null);
  let extraFieldCount = 0;
  for (const [key, value] of Object.entries(track)) {
    if (normalizedTrackFields.has(key) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || /(?:token|secret|password|email|authorization|cookie)/i.test(key) || ['constructor', 'prototype'].includes(key)) continue;
    if (!(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= catalogExtraValueLimit))) continue;
    if (extraFieldCount >= catalogExtraFieldLimit) break;
    const bytes = Buffer.byteLength(JSON.stringify([key, value]), 'utf8');
    if (extraBudget.usedBytes + bytes > catalogExtraByteLimit) break;
    apiExtras[key] = value;
    extraBudget.usedBytes += bytes;
    extraFieldCount++;
  }
  return {
    id: urn || track.id,
    ...(urn ? { urn } : {}),
    ...(urn && legacyId ? { legacy_id: legacyId } : {}),
    title: track.title,
    sharing: typeof track.sharing === 'string' && track.sharing.length <= 32 ? track.sharing : '',
    playback_count: Number.isSafeInteger(track.playback_count) && track.playback_count >= 0 ? track.playback_count : 0,
    likes_count: Number.isSafeInteger(track.likes_count) && track.likes_count >= 0 ? track.likes_count : 0,
    favoritings_count: Number.isSafeInteger(track.favoritings_count) && track.favoritings_count >= 0 ? track.favoritings_count : 0,
    description: typeof track.description === 'string' ? track.description.slice(0, catalogDescriptionLimit) : '',
    permalink_url: safePermalink,
    streamable: track.streamable === true,
    ...(extraFieldCount ? { apiExtras } : {})
  };
}

function appendSnapshotPage(tracks, data, seenIds, extraBudget) {
  const { collection, nextHref } = parseCatalogPage(data);
  if (collection.length > catalogPageLimit || tracks.length + collection.length > catalogTrackLimit) {
    throw apiError('Catalog exceeds this build’s 10,000-track sync limit. The previous snapshot was preserved.', { code: 'SC_CATALOG_LIMIT' });
  }
  for (const source of collection) {
    const track = snapshotTrack(source, extraBudget);
    const id = trackKey(track);
    if (seenIds.has(id)) throw apiError('SoundCloud repeated a track across catalog pages. The previous snapshot was preserved.', { code: 'SC_DUPLICATE_TRACK' });
    seenIds.add(id);
    tracks.push(track);
  }
  return nextHref ? validatePaginationHref(nextHref) : null;
}

function tombstoneForTrack(track, state, absentSyncs, firstAbsentAt, lastSeenAt, confirmedAt = '') {
  const key = trackKey(track);
  if (!key) return null;
  const legacyId = validLegacyTrackId(track.legacy_id) || validLegacyTrackId(track.id);
  return {
    key,
    id: key,
    urn: key,
    ...(legacyId ? { legacy_id: legacyId } : {}),
    title: typeof track.title === 'string' ? track.title.slice(0, 1000) : '',
    state,
    absentSyncs,
    firstAbsentAt,
    lastSeenAt,
    ...(confirmedAt ? { confirmedAt } : {})
  };
}

function reconcileTombstones(previousSnapshot, tracks, syncedAt) {
  const currentKeys = new Set(tracks.map(trackKey));
  const tombstonesByKey = new Map();
  const priorTombstones = Array.isArray(previousSnapshot?.tombstones) ? previousSnapshot.tombstones : [];
  for (const prior of priorTombstones) {
    if (!isPlainObject(prior)) continue;
    const key = validTrackUrn(prior.key) || trackKey(prior);
    if (!key || currentKeys.has(key)) continue;
    const priorAbsentSyncs = Number.isSafeInteger(prior.absentSyncs) && prior.absentSyncs > 0 ? prior.absentSyncs : 1;
    const previouslyConfirmed = prior.state === 'confirmed_absent' || priorAbsentSyncs >= 2;
    const absentSyncs = previouslyConfirmed ? 2 : Math.min(2, priorAbsentSyncs + 1);
    const state = absentSyncs >= 2 ? 'confirmed_absent' : 'pending_absence';
    const tombstone = tombstoneForTrack(
      { ...prior, id: key, urn: key },
      state,
      absentSyncs,
      typeof prior.firstAbsentAt === 'string' ? prior.firstAbsentAt : syncedAt,
      typeof prior.lastSeenAt === 'string' ? prior.lastSeenAt : (previousSnapshot?.syncedAt || ''),
      state === 'confirmed_absent' ? (typeof prior.confirmedAt === 'string' ? prior.confirmedAt : syncedAt) : ''
    );
    if (tombstone) tombstonesByKey.set(key, tombstone);
  }

  const priorTracks = Array.isArray(previousSnapshot?.tracks) ? previousSnapshot.tracks : [];
  for (const track of priorTracks) {
    const key = trackKey(track);
    if (!key || currentKeys.has(key) || tombstonesByKey.has(key)) continue;
    const tombstone = tombstoneForTrack(track, 'pending_absence', 1, syncedAt, previousSnapshot?.syncedAt || '');
    if (tombstone) tombstonesByKey.set(key, tombstone);
  }

  return [...tombstonesByKey.values()]
    .sort((left, right) => {
      const leftDate = Date.parse(left.firstAbsentAt || '');
      const rightDate = Date.parse(right.firstAbsentAt || '');
      return (Number.isFinite(leftDate) ? leftDate : 0) - (Number.isFinite(rightDate) ? rightDate : 0);
    })
    .slice(-catalogTombstoneLimit);
}

function snapshotFreshness(record, now = Date.now()) {
  const snapshot = record?.snapshot;
  if (!snapshot) return { state: 'missing', ageMs: null, staleAfterMs: catalogFreshnessWindowMs };
  const syncedAt = Date.parse(snapshot.syncedAt || snapshot.syncWindow?.completedAt || '');
  if (!Number.isFinite(syncedAt) || syncedAt > now + 5 * 60 * 1000) {
    return { state: record.snapshotInvalidatedAt ? 'invalidated' : 'unknown', ageMs: null, staleAfterMs: catalogFreshnessWindowMs };
  }
  const ageMs = Math.max(0, now - syncedAt);
  return {
    state: record.snapshotInvalidatedAt ? 'invalidated' : ageMs > catalogFreshnessWindowMs ? 'stale' : 'fresh',
    ageMs,
    staleAfterMs: catalogFreshnessWindowMs,
    syncedAt: snapshot.syncedAt || snapshot.syncWindow?.completedAt || ''
  };
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
  const saved = structuredClone(snapshot);
  if (saved.profile.urn !== undefined && (!validSoundCloudUserUrn(saved.profile.urn) || validSoundCloudUserUrn(saved.profile.urn) !== saved.profile.urn)) {
    throw Error('Saved SoundCloud catalog has an invalid account identity.');
  }
  if (saved.metricHistory !== undefined) {
    const history = validateCatalogMetricHistory(saved.metricHistory);
    if (history) saved.metricHistory = history;
    else delete saved.metricHistory;
  }
  if (saved.performanceHistory !== undefined) {
    const history = validatePerformanceHistory(saved.performanceHistory);
    if (history) saved.performanceHistory = history;
    else delete saved.performanceHistory;
  }
  return saved;
}

function validatePerformanceHistory(history) {
  if (!Array.isArray(history) || history.length > 100) return null;
  const valid = history.every(item => isPlainObject(item) && typeof item.capturedAt === 'string' && item.capturedAt.length <= 40 &&
    Number.isFinite(Date.parse(item.capturedAt)) && new Date(Date.parse(item.capturedAt)).toISOString() === item.capturedAt &&
    ['followersCount', 'trackCount', 'catalogPlayCount', 'catalogLikeCount'].every(key => Number.isSafeInteger(item[key]) && item[key] >= 0));
  return valid ? structuredClone(history) : null;
}

function validateCatalogMetricHistory(history) {
  if (!Array.isArray(history) || history.length > catalogMetricHistoryLimit) return null;
  const valid = history.every(item => isPlainObject(item) && typeof item.capturedAt === 'string' && item.capturedAt.length <= 40 &&
    Number.isFinite(Date.parse(item.capturedAt)) && new Date(Date.parse(item.capturedAt)).toISOString() === item.capturedAt &&
    Number.isSafeInteger(item.followersCount) && item.followersCount >= 0 &&
    Number.isSafeInteger(item.trackCount) && item.trackCount >= 0);
  return valid ? structuredClone(history) : null;
}

function savedRemoteUserUrn(value) {
  if (value === undefined || value === '') return '';
  const urn = validSoundCloudUserUrn(value);
  if (!urn || urn !== value) throw Error('Saved SoundCloud account has an invalid remote identity.');
  return urn;
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
      if (item.scope !== undefined && sanitizeOAuthScope(item.scope, [item.clientId, item.clientSecret, item.accessToken, item.refreshToken]) === null) {
        throw Error('Saved SoundCloud account vault has an invalid OAuth scope.');
      }
      if (item.expires !== undefined && (!Number.isFinite(item.expires) || item.expires < 0)) {
        throw Error('Saved SoundCloud account vault has an invalid expiration time.');
      }
      const remoteUserUrn = savedRemoteUserUrn(item.remoteUserUrn);
      return {
        ...structuredClone(item),
        id: item.id,
        label: (item.label || '').slice(0, 80),
        clientId: item.clientId || '',
        clientSecret: item.clientSecret || '',
        accessToken: item.accessToken || '',
        refreshToken: item.refreshToken || '',
        scope: sanitizeOAuthScope(item.scope || '', [item.clientId, item.clientSecret, item.accessToken, item.refreshToken]) || '',
        expires: Number(item.expires || 0),
        remoteUserUrn,
        snapshot: validateSavedSnapshot(item.snapshot)
      };
    });
    const activeAccountId = stored.activeAccountId || '';
    return { vault: { version: 2, activeAccountId: ids.has(activeAccountId) ? activeAccountId : (accounts[0]?.id || ''), accounts }, migrated: false };
  }
  if (stored.version !== undefined) throw Error(`Saved SoundCloud account vault version ${String(stored.version)} is not supported by this app version.`);
  if (!['clientId', 'clientSecret', 'accessToken', 'refreshToken', 'expires', 'snapshot', 'label', 'id', 'scope'].some(key => Object.hasOwn(stored, key))) {
    throw Error('The previous SoundCloud account record has an invalid format.');
  }
  for (const key of ['clientId', 'clientSecret', 'accessToken', 'refreshToken']) {
    if (stored[key] !== undefined && (typeof stored[key] !== 'string' || stored[key].length > 65536)) {
      throw Error('The previous SoundCloud account record has an invalid format.');
    }
  }
  if (stored.scope !== undefined && sanitizeOAuthScope(stored.scope, [stored.clientId, stored.clientSecret, stored.accessToken, stored.refreshToken]) === null) {
    throw Error('The previous SoundCloud account record has an invalid OAuth scope.');
  }
  if (stored.expires !== undefined && (!Number.isFinite(stored.expires) || stored.expires < 0)) {
    throw Error('The previous SoundCloud account record has an invalid expiration time.');
  }
  const snapshot = validateSavedSnapshot(stored.snapshot);
  const remoteUserUrn = savedRemoteUserUrn(stored.remoteUserUrn);
  const account = {
    ...structuredClone(stored),
    id: typeof stored.id === 'string' && stored.id && stored.id.length <= 100 ? stored.id : crypto.randomUUID(),
    label: String(stored.label || snapshot?.profile?.username || 'SoundCloud account').slice(0, 80),
    clientId: stored.clientId || '',
    clientSecret: stored.clientSecret || '',
    accessToken: stored.accessToken || '',
    refreshToken: stored.refreshToken || '',
    scope: sanitizeOAuthScope(stored.scope || '', [stored.clientId, stored.clientSecret, stored.accessToken, stored.refreshToken]) || '',
    expires: Number(stored.expires || 0),
    remoteUserUrn,
    snapshot
  };
  return { vault: { version: 2, activeAccountId: account.id, accounts: [account] }, migrated: true };
}

function validateSyncCheckpoint(value) {
  const validTimestamp = timestamp => typeof timestamp === 'string' && timestamp.length <= 40 && Number.isFinite(Date.parse(timestamp)) && new Date(Date.parse(timestamp)).toISOString() === timestamp;
  if (!isPlainObject(value) || value.version !== 1 || typeof value.accountId !== 'string' || !value.accountId || value.accountId.length > 100 ||
      !['running', 'completed', 'interrupted'].includes(value.status) ||
      !Number.isSafeInteger(value.pageCount) || value.pageCount < 0 || value.pageCount > catalogPageCountLimit ||
      !Number.isSafeInteger(value.trackCount) || value.trackCount < 0 || value.trackCount > catalogTrackLimit ||
      !validTimestamp(value.startedAt) || !validTimestamp(value.lastUpdated) ||
      typeof value.errorCode !== 'string' || value.errorCode.length > 80 || (value.errorCode && !/^SC_[A-Z0-9_]{1,72}$/.test(value.errorCode)) ||
      (value.status !== 'interrupted' && !!value.errorCode) || (value.status === 'interrupted' && !value.errorCode)) {
    throw Error('Saved SoundCloud sync progress has an invalid format.');
  }
  return {
    version: 1,
    accountId: value.accountId,
    startedAt: value.startedAt,
    pageCount: value.pageCount,
    trackCount: value.trackCount,
    lastUpdated: value.lastUpdated,
    status: value.status,
    errorCode: value.errorCode
  };
}

function validateAccountCooldowns(value) {
  if (!isPlainObject(value) || ![1, 2].includes(value.version) || !Array.isArray(value.accounts) || value.accounts.length > 10) {
    throw Error('Saved SoundCloud cooldown state has an invalid format.');
  }
  if (value.version === 1 && value.accounts.some(item => !isPlainObject(item) || typeof item.accountId !== 'string' || !item.accountId || item.accountId.length > 100 ||
        !Number.isSafeInteger(item.until) || item.until < 0)) throw Error('Saved SoundCloud cooldown state has an invalid format.');
  if (value.version === 2 && value.accounts.some(item => !isPlainObject(item) || typeof item.accountId !== 'string' || !item.accountId || item.accountId.length > 100 ||
        !Number.isSafeInteger(item.rateUntil) || item.rateUntil < 0 || !Number.isSafeInteger(item.circuitUntil) || item.circuitUntil < 0)) {
    throw Error('Saved SoundCloud cooldown state has an invalid format.');
  }
  const ids = new Set();
  for (const item of value.accounts) {
    if (ids.has(item.accountId)) throw Error('Saved SoundCloud cooldown state has duplicate accounts.');
    ids.add(item.accountId);
  }
  return {
    version: 2,
    accounts: value.accounts.map(item => ({
      accountId: item.accountId,
      rateUntil: value.version === 1 ? item.until : item.rateUntil,
      circuitUntil: value.version === 1 ? 0 : item.circuitUntil
    }))
  };
}

function createConnection(dir) {
  const file = path.join(dir, 'soundcloud.secure');
  const checkpointFile = path.join(dir, 'soundcloud.sync-progress.secure');
  const cooldownFile = path.join(dir, 'soundcloud.rate-limits.secure');
  let vault = { version: 2, activeAccountId: '', accounts: [] };
  let syncCheckpoint = null;
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
    const first = { id: crypto.randomUUID(), label: 'SoundCloud account', clientId: '', clientSecret: '', accessToken: '', refreshToken: '', scope: '', expires: 0, snapshot: null };
    vault = { version: 2, activeAccountId: first.id, accounts: [first] };
  }
  const refreshingByAccount = new Map();
  const apiRequestsByAccount = new Map();
  const apiCooldownByAccount = new Map();
  const apiQuotaByAccount = new Map();

  function captureApiQuota(record, headers, url, method) {
    if (!record?.id) return;
    const observed = observedQuotaSnapshot(headers, url, method);
    if (!observed) return;
    let snapshots = apiQuotaByAccount.get(record.id);
    if (!snapshots) {
      snapshots = new Map();
      apiQuotaByAccount.set(record.id, snapshots);
    }
    const now = Date.now();
    for (const [key, snapshot] of snapshots) {
      if (Date.parse(snapshot.resetAt) <= now) snapshots.delete(key);
    }
    const key = `${observed.method} ${observed.route}`;
    snapshots.delete(key);
    snapshots.set(key, observed);
    while (snapshots.size > apiQuotaSnapshotLimit) snapshots.delete(snapshots.keys().next().value);
  }

  function currentApiQuota(accountId) {
    const snapshots = apiQuotaByAccount.get(accountId);
    if (!snapshots) return [];
    const now = Date.now();
    for (const [key, snapshot] of snapshots) {
      if (Date.parse(snapshot.resetAt) <= now) snapshots.delete(key);
    }
    if (!snapshots.size) {
      apiQuotaByAccount.delete(accountId);
      return [];
    }
    return [...snapshots.values()].map(snapshot => structuredClone(snapshot));
  }

  function persistAccountCooldowns() {
    const temp = `${cooldownFile}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      const knownAccounts = new Set(vault.accounts.map(item => item.id));
      const activeIds = new Set([
        ...apiCooldownByAccount.keys(),
        ...[...apiCircuitByAccount.entries()].filter(([, circuit]) => circuit.openedUntil > Date.now()).map(([accountId]) => accountId)
      ]);
      const value = {
        version: 2,
        accounts: [...activeIds]
          .filter(accountId => knownAccounts.has(accountId))
          .map(accountId => ({
            accountId,
            rateUntil: apiCooldownByAccount.get(accountId) || 0,
            circuitUntil: apiCircuitByAccount.get(accountId)?.openedUntil || 0
          }))
          .filter(item => item.rateUntil > Date.now() || item.circuitUntil > Date.now())
          .sort((left, right) => Math.max(right.rateUntil, right.circuitUntil) - Math.max(left.rateUntil, left.circuitUntil))
          .slice(0, 10)
      };
      const encrypted = safeStorage.encryptString(JSON.stringify(validateAccountCooldowns(value)));
      if (encrypted.byteLength > accountCooldownByteLimit) return false;
      descriptor = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(descriptor, encrypted);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temp, cooldownFile);
      return true;
    } catch {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Preserve the previous cooldown file. */ } }
      try { fs.rmSync(temp, { force: true }); } catch { /* Preserve the previous cooldown file. */ }
      return false;
    }
  }

  function loadAccountCooldowns() {
    try {
      const info = fs.lstatSync(cooldownFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > accountCooldownByteLimit || !safeStorage.isEncryptionAvailable()) return;
      const saved = validateAccountCooldowns(JSON.parse(safeStorage.decryptString(fs.readFileSync(cooldownFile))));
      const knownAccounts = new Set(vault.accounts.map(item => item.id));
      const now = Date.now();
      for (const item of saved.accounts) {
        if (!knownAccounts.has(item.accountId)) continue;
        if (item.rateUntil > now) apiCooldownByAccount.set(item.accountId, Math.min(item.rateUntil, now + 24 * 60 * 60 * 1000));
        if (item.circuitUntil > now) {
          const circuit = apiCircuitFor(item.accountId);
          circuit.consecutiveFailures = apiCircuitFailureLimit;
          circuit.openedUntil = Math.min(item.circuitUntil, now + apiCircuitCooldownMs);
          circuit.probeInFlight = false;
        }
      }
    } catch { /* A damaged optional cooldown file never blocks account recovery. */ }
  }

  function enforceAccountCooldown(record) {
    const until = apiCooldownByAccount.get(record.id) || 0;
    if (until <= Date.now()) {
      if (apiCooldownByAccount.delete(record.id)) persistAccountCooldowns();
      return;
    }
    const wait = until - Date.now();
    throw apiError(`SoundCloud asked this account to slow down. Try again in about ${Math.ceil(wait / 1000)} seconds.`, {
      code: 'SC_RATE_LIMITED', statusCode: 429, retryAfterMs: wait
    });
  }

  function applyAccountCooldown(record, wait) {
    const delay = Number.isFinite(wait) ? wait : 1000;
    const until = Math.max(apiCooldownByAccount.get(record.id) || 0, Date.now() + Math.max(0, delay));
    apiCooldownByAccount.set(record.id, until);
    persistAccountCooldowns();
  }

  function clearAccountTokens(record) {
    const candidate = structuredClone(vault);
    const target = candidate.accounts.find(item => item.id === record.id);
    if (!target) return;
    target.accessToken = '';
    target.refreshToken = '';
    target.scope = '';
    target.expires = 0;
    target.snapshotInvalidatedAt = new Date().toISOString();
    persist(candidate);
  }

  function verifyAndBindRemoteIdentity(record, profile) {
    const remoteUserUrn = soundCloudUserUrn(profile);
    const savedUserUrn = record.remoteUserUrn || '';
    if (savedUserUrn && remoteUserUrn !== savedUserUrn) {
      throw apiError('The connected SoundCloud login does not match this saved account. Reconnect the intended account or add another saved account.', {
        code: 'SC_ACCOUNT_IDENTITY_MISMATCH'
      });
    }
    if (!savedUserUrn && remoteUserUrn) {
      const candidate = structuredClone(vault);
      const target = candidate.accounts.find(item => item.id === record.id);
      if (!target) throw Error('The connected SoundCloud account is no longer available.');
      target.remoteUserUrn = remoteUserUrn;
      persist(candidate);
    }
    return remoteUserUrn || savedUserUrn;
  }

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

  function persistSyncCheckpoint(value) {
    if (!safeStorage.isEncryptionAvailable()) throw apiError('Windows credential encryption is unavailable.', { code: 'SC_SYNC_CHECKPOINT_FAILED' });
    const checkpoint = validateSyncCheckpoint(value);
    const temp = `${checkpointFile}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(checkpoint));
      if (encrypted.byteLength > syncCheckpointByteLimit) throw Error('SoundCloud sync progress exceeded its safe size limit.');
      descriptor = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(descriptor, encrypted);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temp, checkpointFile);
      syncCheckpoint = checkpoint;
      return checkpoint;
    } catch {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Keep the previous checkpoint intact. */ } }
      try { fs.rmSync(temp, { force: true }); } catch { /* Keep the previous checkpoint intact. */ }
      throw apiError('Could not save SoundCloud sync progress safely.', { code: 'SC_SYNC_CHECKPOINT_FAILED' });
    }
  }

  function loadSyncCheckpoint() {
    try {
      const info = fs.lstatSync(checkpointFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > syncCheckpointByteLimit) return null;
      const encrypted = fs.readFileSync(checkpointFile);
      const checkpoint = validateSyncCheckpoint(JSON.parse(safeStorage.decryptString(encrypted)));
      const record = vault.accounts.find(item => item.id === checkpoint.accountId);
      const snapshotMatches = record?.snapshot?.syncWindow?.startedAt === checkpoint.startedAt;
      if (snapshotMatches && checkpoint.status !== 'completed') {
        const completed = { ...checkpoint, status: 'completed', errorCode: '', lastUpdated: record.snapshot.syncedAt || checkpoint.lastUpdated };
        try { return persistSyncCheckpoint(completed); }
        catch { syncCheckpoint = completed; return completed; }
      }
      if (checkpoint.status === 'running') {
        const interrupted = { ...checkpoint, status: 'interrupted', errorCode: 'SC_PROCESS_INTERRUPTED', lastUpdated: new Date().toISOString() };
        try { return persistSyncCheckpoint(interrupted); }
        catch { syncCheckpoint = interrupted; return interrupted; }
      }
      return checkpoint;
    } catch { return null; }
  }

  if (needsMigration) persist();
  syncCheckpoint = loadSyncCheckpoint();
  loadAccountCooldowns();

  function active() {
    return vault.accounts.find(item => item.id === vault.activeAccountId) || null;
  }

  function accountStatus(record) {
    const username = record.snapshot?.profile?.username || '';
    return {
      id: record.id,
      label: record.label || username || 'SoundCloud account',
      username,
      remoteUserUrn: record.remoteUserUrn || '',
      scope: record.scope || '',
      quotaSnapshots: currentApiQuota(record.id),
      configured: !!record.clientId,
      connected: !!record.accessToken
    };
  }

  function status() {
    const record = active();
    return {
      configured: !!record?.clientId,
      connected: !!record?.accessToken,
      scope: record?.scope || '',
      quotaSnapshots: currentApiQuota(record?.id),
      snapshot: record?.snapshot || null,
      snapshotFreshness: snapshotFreshness(record),
      syncCheckpoint: syncCheckpoint?.accountId === record?.id ? structuredClone(syncCheckpoint) : null,
      activeAccountId: record?.id || '',
      accounts: vault.accounts.map(accountStatus)
    };
  }

  function health() {
    let encryptionAvailable = false;
    let vaultReadable = true;
    let vaultWritable = true;
    try { encryptionAvailable = safeStorage.isEncryptionAvailable(); } catch { /* The health payload stays free of OS error details. */ }
    try { if (fs.existsSync(file)) fs.accessSync(file, fs.constants.R_OK); }
    catch { vaultReadable = false; }
    try { fs.accessSync(fs.existsSync(file) ? file : dir, fs.constants.W_OK); }
    catch { vaultWritable = false; }
    const record = active();
    const accountCooldownMs = Math.max(0, (apiCooldownByAccount.get(record?.id) || 0) - Date.now());
    const circuitCooldownMs = Math.max(0, (apiCircuitByAccount.get(record?.id)?.openedUntil || 0) - Date.now());
    return {
      ok: encryptionAvailable && vaultReadable && vaultWritable,
      checks: {
        osEncryptionAvailable: encryptionAvailable,
        credentialVaultReadable: vaultReadable,
        credentialVaultWritable: vaultWritable,
        activeAccountConfigured: !!record?.clientId,
        activeAccountConnected: !!record?.accessToken,
        accountCooldownMs,
        apiCircuitCooldownMs: circuitCooldownMs
      },
      accountCount: vault.accounts.length,
      quotaSnapshots: currentApiQuota(record?.id)
    };
  }

  async function token(record, params, deadlineAt) {
    if (params.grant_type === 'refresh_token') enforceAccountCooldown(record);
    let response;
    try {
      response = await fetch('https://secure.soundcloud.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: record.clientId, client_secret: record.clientSecret, ...params }),
        redirect: 'manual',
        signal: requestSignal(deadlineAt)
      });
    } catch (error) { throw classifyNetworkError(error, deadlineAt); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      throw apiError('SoundCloud redirected the authorization request unexpectedly.', { code: 'SC_UNEXPECTED_REDIRECT', statusCode: response.status });
    }
    if (!response.ok) {
      const wait = retryAfterMs(response);
      let details = null;
      if (params.grant_type === 'refresh_token' && [400, 401].includes(response.status)) {
        details = await readJsonBounded(response, 64 * 1024, deadlineAt).catch(() => null);
      } else await response.body?.cancel();
      if (response.status === 429) applyAccountCooldown(record, wait);
      if (params.grant_type === 'refresh_token' && ['invalid_grant', 'invalid_token'].includes(details?.error)) {
        clearAccountTokens(record);
        throw apiError('The saved SoundCloud authorization was revoked. Reconnect this account to continue.', { code: 'SC_TOKEN_REVOKED', statusCode: response.status });
      }
      throw apiError(response.status === 429 || response.status === 503
        ? boundedRetryMessage(response.status, wait)
        : `SoundCloud authorization failed (${response.status}). Check your app credentials and redirect address.`,
      { code: response.status === 429 ? 'SC_RATE_LIMITED' : 'SC_AUTH_FAILED', statusCode: response.status, retryAfterMs: wait });
    }
    const data = await readJsonBounded(response, 512 * 1024, deadlineAt);
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
    if (Object.hasOwn(data, 'scope')) {
      const scope = sanitizeOAuthScope(data.scope, [candidateRecord.clientId, candidateRecord.clientSecret, data.access_token, data.refresh_token]);
      if (scope !== null) candidateRecord.scope = scope;
    }
    candidateRecord.expires = Date.now() + expiresIn * 1000;
    persist(candidate);
  }

  async function refreshIfNeeded(record, deadlineAt) {
    if (Date.now() <= record.expires - 60000) return;
    let refreshing = refreshingByAccount.get(record.id);
    if (!refreshing) {
      refreshing = token(record, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, deadlineAt)
        .finally(() => refreshingByAccount.delete(record.id));
      refreshingByAccount.set(record.id, refreshing);
    }
    await refreshing;
  }

  function request(url, record = active(), options = {}) {
    const target = new URL(url, 'https://api.soundcloud.com');
    if (target.protocol !== 'https:' || target.origin !== 'https://api.soundcloud.com' || target.username || target.password || target.port || target.hash) throw Error('Unexpected API pagination address.');
    if (!record?.accessToken) throw Error('Connect your SoundCloud account first.');
    let requests = apiRequestsByAccount.get(record.id);
    const existing = requests?.get(target.href);
    if (existing) return existing;
    if (!requests) {
      requests = new Map();
      apiRequestsByAccount.set(record.id, requests);
    }
    let pendingRequest;
    pendingRequest = requestOnce(target, record, options).finally(() => {
      if (requests.get(target.href) === pendingRequest) requests.delete(target.href);
      if (!requests.size && apiRequestsByAccount.get(record.id) === requests) apiRequestsByAccount.delete(record.id);
    });
    requests.set(target.href, pendingRequest);
    return pendingRequest;
  }

  async function requestOnce(target, record, { deadlineAt, retriedAuth = false } = {}) {
    enforceAccountCooldown(record);
    await refreshIfNeeded(record, deadlineAt);
    enterApiCircuit(record.id);
    let current = target;
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      try {
        response = await fetch(current, {
          headers: { Authorization: 'OAuth ' + record.accessToken, Accept: 'application/json' },
          redirect: 'manual',
          signal: requestSignal(deadlineAt)
        });
      } catch (error) {
        const classified = classifyNetworkError(error, deadlineAt);
        recordApiFailure(classified, record.id, persistAccountCooldowns);
        throw classified;
      }
      captureApiQuota(record, response.headers, current, 'GET');
      if (response.status >= 500) {
        const wait = retryAfterMs(response);
        await response.body?.cancel();
        const failure = apiError(response.status === 503 ? boundedRetryMessage(response.status, wait) : `SoundCloud returned ${response.status}. Check the service status and try again.`, {
          code: response.status === 503 ? 'SC_TEMPORARILY_UNAVAILABLE' : 'SC_SERVER_ERROR', statusCode: response.status, retryAfterMs: wait
        });
        recordApiFailure(failure, record.id, persistAccountCooldowns);
        throw failure;
      }
      recordApiSuccess(record.id, persistAccountCooldowns);
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
    if (response.status === 401) {
      await response.body?.cancel();
      if (!retriedAuth && record.refreshToken) {
        await token(record, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, deadlineAt);
        return requestOnce(target, record, { deadlineAt, retriedAuth: true });
      }
      clearAccountTokens(record);
      throw apiError('The saved SoundCloud authorization is no longer valid. Reconnect this account to continue.', { code: 'SC_TOKEN_REVOKED', statusCode: 401 });
    }
    if (!response.ok) {
      const wait = retryAfterMs(response);
      await response.body?.cancel();
      if (response.status === 429) applyAccountCooldown(record, wait);
      throw apiError(response.status === 429 ? boundedRetryMessage(response.status, wait) : `SoundCloud returned ${response.status}. Check the account permissions and try again.`, {
        code: response.status === 429 ? 'SC_RATE_LIMITED' : 'SC_API_ERROR',
        statusCode: response.status,
        retryAfterMs: wait
      });
    }
    try { return await readJsonBounded(response, apiResponseByteLimit, deadlineAt); }
    catch (error) {
      if (['SC_NETWORK_TIMEOUT', 'SC_NETWORK_UNAVAILABLE', 'SC_NETWORK_ERROR', 'SC_DEADLINE_EXCEEDED'].includes(error?.code)) recordApiFailure(error, record.id, persistAccountCooldowns);
      throw error;
    }
  }

  async function sync() {
    if (syncing) throw Error('A SoundCloud catalog sync is already running.');
    syncing = true;
    const record = active();
    const syncStartedAtMs = Date.now();
    const syncStartedAt = new Date(syncStartedAtMs).toISOString();
    const deadlineAt = Date.now() + catalogSyncDeadlineMs;
    let checkpoint = {
      version: 1,
      accountId: record.id,
      startedAt: syncStartedAt,
      pageCount: 0,
      trackCount: 0,
      lastUpdated: syncStartedAt,
      status: 'running',
      errorCode: ''
    };
    try {
      syncCheckpoint = checkpoint;
      persistSyncCheckpoint(checkpoint);
      const profileResponse = await request('/me', record, { deadlineAt });
      const profile = validateProfile(profileResponse);
      const remoteUserUrn = verifyAndBindRemoteIdentity(record, profileResponse);
      const reportedTrackCount = Number.isSafeInteger(profileResponse?.track_count) && profileResponse.track_count >= 0 ? profileResponse.track_count : null;
      const tracks = [];
      const extraBudget = { usedBytes: 0 };
      let next = '/me/tracks?linked_partitioning=true&limit=200';
      let pages = 0;
      const seenIds = new Set();
      const seenPages = new Set();
      while (next && pages < catalogPageCountLimit) {
        next = validatePaginationHref(next);
        if (seenPages.has(next)) throw apiError('SoundCloud repeated a catalog page. The previous snapshot was preserved.', { code: 'SC_PAGINATION_LOOP' });
        seenPages.add(next);
        const data = await request(next, record, { deadlineAt });
        next = appendSnapshotPage(tracks, data, seenIds, extraBudget);
        pages++;
        checkpoint = { ...checkpoint, pageCount: pages, trackCount: tracks.length, lastUpdated: new Date().toISOString() };
        persistSyncCheckpoint(checkpoint);
      }
      if (Date.now() >= deadlineAt) throw classifyNetworkError(Error('deadline'), deadlineAt);
      if (next) throw apiError('Catalog exceeds this build’s 10,000-track sync limit. Previous snapshot preserved.', { code: 'SC_CATALOG_LIMIT' });
      const candidate = structuredClone(vault);
      const candidateRecord = candidate.accounts.find(item => item.id === record.id);
      if (!candidateRecord) throw Error('The connected SoundCloud account is no longer available.');
      const completedAtMs = Date.now();
      const syncedAt = new Date(completedAtMs).toISOString();
      const metricHistory = validateCatalogMetricHistory(record.snapshot?.metricHistory) || [];
      const hasMetricCounts = Number.isSafeInteger(profileResponse?.followers_count) && profileResponse.followers_count >= 0 &&
        Number.isSafeInteger(profileResponse?.track_count) && profileResponse.track_count >= 0;
      if (hasMetricCounts) {
        const latestMetric = metricHistory[metricHistory.length - 1];
        const currentMetric = { capturedAt: syncedAt, followersCount: profileResponse.followers_count, trackCount: profileResponse.track_count };
        if (!latestMetric || latestMetric.capturedAt.slice(0, 10) !== syncedAt.slice(0, 10)) metricHistory.push(currentMetric);
        else if (latestMetric.followersCount !== currentMetric.followersCount || latestMetric.trackCount !== currentMetric.trackCount) metricHistory[metricHistory.length - 1] = currentMetric;
      }
      const priorPerformance = validatePerformanceHistory(record.snapshot?.performanceHistory) || [];
      const sumMetric = (key, fallback) => tracks.reduce((sum, track) => Math.min(Number.MAX_SAFE_INTEGER, sum + (Number.isSafeInteger(track[key]) ? track[key] : fallback(track))), 0);
      const performanceSnapshot = hasMetricCounts ? {
        capturedAt: syncedAt,
        followersCount: profileResponse.followers_count,
        trackCount: profileResponse.track_count,
        catalogPlayCount: sumMetric('playback_count', () => 0),
        catalogLikeCount: tracks.reduce((sum, track) => Math.min(Number.MAX_SAFE_INTEGER, sum + (track.likes_count || track.favoritings_count || 0)), 0)
      } : null;
      candidateRecord.snapshot = {
        modelVersion: 1,
        fieldPolicy: structuredClone(catalogFieldPolicy),
        profile,
        tracks,
        metricHistory: metricHistory.slice(-catalogMetricHistoryLimit),
        performanceHistory: (performanceSnapshot ? [...priorPerformance, performanceSnapshot] : priorPerformance).slice(-100),
        tombstones: reconcileTombstones(record.snapshot, tracks, syncedAt),
        syncWindow: {
          startedAt: syncStartedAt,
          completedAt: syncedAt,
          durationMs: Math.max(0, completedAtMs - syncStartedAtMs),
          pageCount: pages,
          trackCount: tracks.length,
          reportedTrackCount,
          reportedTrackCountDelta: reportedTrackCount === null ? null : reportedTrackCount - tracks.length
        },
        syncedAt
      };
      if (!candidateRecord.remoteUserUrn && remoteUserUrn) candidateRecord.remoteUserUrn = remoteUserUrn;
      delete candidateRecord.snapshotInvalidatedAt;
      if (!candidateRecord.label || candidateRecord.label === 'SoundCloud account') candidateRecord.label = profile.username || candidateRecord.label;
      persist(candidate);
      checkpoint = { ...checkpoint, status: 'completed', errorCode: '', lastUpdated: syncedAt };
      try { persistSyncCheckpoint(checkpoint); }
      catch { syncCheckpoint = checkpoint; /* The committed snapshot's syncWindow repairs a stale running checkpoint on next launch. */ }
      return status();
    } catch (error) {
      const errorCode = typeof error?.code === 'string' && /^SC_[A-Z0-9_]{1,72}$/.test(error.code) ? error.code : 'SC_SYNC_FAILED';
      const interrupted = { ...checkpoint, status: 'interrupted', errorCode, lastUpdated: new Date().toISOString() };
      try { persistSyncCheckpoint(interrupted); }
      catch { syncCheckpoint = interrupted; }
      throw error;
    } finally {
      syncing = false;
    }
  }

  async function activityFeed() {
    const record = active();
    if (!record?.accessToken) throw Error('Connect your SoundCloud account first.');
    const deadlineAt = Date.now() + 90000;
    let next = '/me/feed?limit=50';
    let pages = 0;
    const seenPages = new Set();
    const seenItems = new Set();
    const items = [];
    while (next && pages < activityPageLimit && items.length < activityItemLimit) {
      next = validateActivityPaginationHref(next);
      if (seenPages.has(next)) throw apiError('SoundCloud repeated an activity page. Try refreshing later.', { code: 'SC_ACTIVITY_PAGINATION_LOOP' });
      seenPages.add(next);
      const data = await request(next, record, { deadlineAt });
      if (!isPlainObject(data) || !Array.isArray(data.collection) || data.collection.length > 200 ||
          (data.next_href != null && (typeof data.next_href !== 'string' || !data.next_href.trim()))) {
        throw apiError('SoundCloud returned an invalid activity feed.', { code: 'SC_INVALID_ACTIVITY_FEED' });
      }
      for (const entry of data.collection) {
        if (!isPlainObject(entry) || typeof entry.type !== 'string' || entry.type.length > 80 ||
            typeof entry.created_at !== 'string' || entry.created_at.length > 80 || !isPlainObject(entry.origin)) continue;
        const origin = entry.origin;
        const id = typeof origin.urn === 'string' ? origin.urn : String(origin.id ?? '');
        const key = `${entry.type}:${id}:${entry.created_at}`;
        if (seenItems.has(key)) continue;
        seenItems.add(key);
        items.push({
          type: entry.type,
          createdAt: entry.created_at,
          kind: typeof origin.kind === 'string' && origin.kind.length <= 40 ? origin.kind : '',
          title: typeof origin.title === 'string' ? origin.title.slice(0, 300) : '',
          permalinkUrl: typeof origin.permalink_url === 'string' ? origin.permalink_url.slice(0, 1000) : '',
          originUrn: id.slice(0, 160),
          reposter: typeof entry.reposter === 'string' ? entry.reposter.slice(0, 160) : ''
        });
        if (items.length >= activityItemLimit) break;
      }
      next = data.next_href || null;
      pages++;
    }
    return {
      accountId: record.id,
      fetchedAt: new Date().toISOString(),
      source: 'SoundCloud Public API: GET /me/feed',
      pagesRead: pages,
      hasMore: !!next,
      items
    };
  }

  async function comments(trackIdentifier) {
    const record = active();
    if (!record?.snapshot || !Array.isArray(record.snapshot.tracks)) throw Error('Sync your SoundCloud catalog before reviewing comments.');
    if (typeof trackIdentifier !== 'string' || trackIdentifier.length > 160) throw Error('Choose a track from your synced SoundCloud catalog.');
    const track = record.snapshot.tracks.find(item => String(item.id) === trackIdentifier || String(item.urn || '') === trackIdentifier || String(item.legacy_id || '') === trackIdentifier);
    const urn = trackKey(track);
    if (!track || !urn) throw Error('That track is not in the active account’s synced catalog. Sync the catalog and try again.');
    const deadlineAt = Date.now() + 60000;
    const target = `/tracks/${encodeURIComponent(urn)}/comments?linked_partitioning=true&limit=100`;
    const data = await request(target, record, { deadlineAt });
    const { collection, nextHref } = parseCatalogPage(data);
    if (collection.length > 100) throw apiError('SoundCloud returned more comments than the requested page limit.', { code: 'SC_COMMENTS_PAGE_TOO_LARGE' });
    const comments = collection.map(item => {
      if (!isPlainObject(item) || typeof item.body !== 'string' || item.body.length > 5000) return null;
      const createdAt = typeof item.created_at === 'string' && item.created_at.length <= 64 && Number.isFinite(Date.parse(item.created_at)) ? new Date(item.created_at).toISOString() : '';
      const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp >= 0 ? item.timestamp :
        typeof item.timestamp === 'string' && /^\d{1,12}(?:\.\d{1,3})?$/.test(item.timestamp) ? Number(item.timestamp) : null;
      const userName = typeof item.user?.username === 'string' ? item.user.username.slice(0, 256) : 'SoundCloud listener';
      const id = typeof item.id === 'string' && item.id.length <= 128 ? item.id : Number.isSafeInteger(item.id) && item.id >= 0 ? String(item.id) : '';
      return { id, body: item.body, createdAt, timestamp: Number.isFinite(timestamp) ? timestamp : null, userName };
    }).filter(Boolean);
    return {
      accountId: record.id,
      track: { id: String(track.id), title: track.title, url: track.permalink_url || '' },
      comments,
      fetchedAt: new Date().toISOString(),
      moreAvailable: !!nextHref
    };
  }

  async function preview(trackId, range = '', authRetried = false, deadlineAt = Date.now() + 60000) {
    const record = active();
    if (!record?.accessToken) throw Error('Connect your SoundCloud account to preview this track.');
    enforceAccountCooldown(record);
    await refreshIfNeeded(record, deadlineAt);
    const profileResponse = await request('/me', record, { deadlineAt });
    validateProfile(profileResponse);
    verifyAndBindRemoteIdentity(record, profileResponse);
    enterApiCircuit(record.id);
    const track = record.snapshot?.tracks?.find(item => String(item.id) === String(trackId) || String(item.urn || '') === String(trackId) || String(item.legacy_id || '') === String(trackId));
    if (!track || track.streamable !== true) throw Error('This track is not available for preview through the SoundCloud API.');
    const canonicalTrackUrn = validTrackUrn(track.urn) || validTrackUrn(track.id) || (validLegacyTrackId(track.legacy_id || track.id) ? `soundcloud:tracks:${validLegacyTrackId(track.legacy_id || track.id)}` : '');
    if (!canonicalTrackUrn) throw Error('This track is not available for preview through the SoundCloud API.');
    let target = new URL(`https://api.soundcloud.com/tracks/${encodeURIComponent(canonicalTrackUrn)}/stream`);
    const requestHeaders = {};
    if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) requestHeaders.Range = range;
    let response;
    let authenticated = true;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const headers = { Accept: 'audio/*', ...requestHeaders };
      if (authenticated) headers.Authorization = 'OAuth ' + record.accessToken;
      let timeout;
      try {
        timeout = requestHeaderTimeout(deadlineAt);
        response = await fetch(target, { headers, redirect: 'manual', signal: timeout.signal });
      }
      catch (error) {
        const classified = classifyNetworkError(error, deadlineAt);
        if (target.origin === 'https://api.soundcloud.com') recordApiFailure(classified, record.id, persistAccountCooldowns);
        throw classified;
      } finally { timeout?.clear(); }
      if (target.origin === 'https://api.soundcloud.com') captureApiQuota(record, response.headers, target, 'GET');
      if (target.origin === 'https://api.soundcloud.com' && response.status >= 500) {
        const failure = apiError('SoundCloud preview service is temporarily unavailable.', { code: 'SC_TEMPORARILY_UNAVAILABLE', statusCode: response.status, retryAfterMs: retryAfterMs(response) });
        recordApiFailure(failure, record.id, persistAccountCooldowns);
        await response.body?.cancel();
        throw failure;
      }
      if (target.origin === 'https://api.soundcloud.com') {
        recordApiSuccess(record.id, persistAccountCooldowns);
        if (response.status === 429) applyAccountCooldown(record, retryAfterMs(response));
      }
      if (target.origin === 'https://api.soundcloud.com' && response.status === 401) {
        await response.body?.cancel();
        if (!authRetried && record.refreshToken) {
          await token(record, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, deadlineAt);
          return preview(trackId, range, true, deadlineAt);
        }
        clearAccountTokens(record);
        throw apiError('The saved SoundCloud authorization is no longer valid. Reconnect this account to continue.', { code: 'SC_TOKEN_REVOKED', statusCode: 401 });
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3) throw apiError('SoundCloud returned an unsupported preview redirect.', { code: 'SC_UNEXPECTED_REDIRECT', statusCode: response.status });
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
      throw apiError('SoundCloud could not stream this track preview.', { code: response.status === 429 ? 'SC_RATE_LIMITED' : 'SC_PREVIEW_UNAVAILABLE', statusCode: response.status, retryAfterMs: retryAfterMs(response) });
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
    target.scope = '';
    target.expires = 0;
    target.snapshot = null;
    target.remoteUserUrn = '';
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
    const record = { id: crypto.randomUUID(), label: name || 'New SoundCloud account', clientId: source.clientId, clientSecret: source.clientSecret, accessToken: '', refreshToken: '', scope: '', expires: 0, snapshot: null };
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
    const removedId = candidate.accounts[index].id;
    candidate.accounts.splice(index, 1);
    if (candidate.activeAccountId === id) candidate.activeAccountId = candidate.accounts[0].id;
    persist(candidate);
    apiCooldownByAccount.delete(removedId);
    apiCircuitByAccount.delete(removedId);
    apiQuotaByAccount.delete(removedId);
    persistAccountCooldowns();
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
          if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return; }
          const remoteAddress = req.socket.remoteAddress;
          if (req.headers.host?.toLowerCase() !== '127.0.0.1:49832' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(remoteAddress)) {
            res.writeHead(400).end('Invalid authorization callback address.');
            return;
          }
          let url;
          try { url = new URL(req.url, redirect); }
          catch { res.writeHead(400).end('Invalid authorization callback.'); return; }
          if (url.origin !== new URL(redirect).origin) { res.writeHead(400).end('Invalid authorization callback.'); return; }
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
        server.on('error', error => finish(Error(error.code === 'EADDRINUSE' ? 'The connection port is in use. Close the other connection attempt and try again.' : 'The local authorization callback could not be opened.')));
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
          shell.openExternal(url.toString()).catch(() => finish(Error('Could not open SoundCloud authorization in your browser.')));
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
    health,
    sync,
    activityFeed,
    comments,
    credentials,
    add,
    switchTo,
    remove,
    async upload(file, metadata, options) {
      const record = active();
      const profile = await request('/me', record);
      validateProfile(profile);
      verifyAndBindRemoteIdentity(record, profile);
      return require('./upload.cjs').sendUpload(file, metadata, {
        ...options,
        token: record.accessToken,
        onRateLimit: wait => applyAccountCooldown(record, wait),
        onQuotaHeaders: headers => captureApiQuota(record, headers, 'https://api.soundcloud.com/tracks', 'POST')
      });
    },
    disconnect() {
      if (pending) throw Error('Finish the current connection attempt first.');
      const record = active();
      if (record) {
        const candidate = structuredClone(vault);
        const target = candidate.accounts.find(item => item.id === record.id);
        target.accessToken = '';
        target.refreshToken = '';
        target.scope = '';
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
