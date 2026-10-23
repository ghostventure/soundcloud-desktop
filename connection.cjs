const { safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const redirect = 'http://127.0.0.1:49832/callback';

function createConnection(dir) {
  const file = path.join(dir, 'soundcloud.secure');
  let vault = { version: 2, activeAccountId: '', accounts: [] };
  let pending = false;
  let syncing = false;

  const makeAccount = (values = {}) => ({
    id: values.id || crypto.randomUUID(),
    label: String(values.label || '').slice(0, 80),
    clientId: values.clientId || '',
    clientSecret: values.clientSecret || '',
    accessToken: values.accessToken || '',
    refreshToken: values.refreshToken || '',
    expires: Number(values.expires || 0),
    snapshot: values.snapshot || null
  });

  if (fs.existsSync(file)) {
    try {
      const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      if (stored?.version === 2 && Array.isArray(stored.accounts)) {
        vault = {
          version: 2,
          activeAccountId: String(stored.activeAccountId || ''),
          accounts: stored.accounts.filter(item => item && typeof item === 'object').map(makeAccount)
        };
        if (!vault.accounts.some(item => item.id === vault.activeAccountId)) vault.activeAccountId = vault.accounts[0]?.id || '';
      } else if (stored && typeof stored === 'object') {
        // Migrate the original single-account encrypted record without moving or exposing secrets.
        const legacy = makeAccount({ ...stored, label: stored.snapshot?.profile?.username || 'SoundCloud account' });
        vault = { version: 2, activeAccountId: legacy.id, accounts: [legacy] };
      }
    } catch {
      throw Error('Saved SoundCloud credentials could not be decrypted by this Windows account.');
    }
  }
  if (!vault.accounts.length) {
    const first = makeAccount({ label: 'SoundCloud account' });
    vault = { version: 2, activeAccountId: first.id, accounts: [first] };
  }
  const refreshingByAccount = new Map();

  function persist() {
    if (!safeStorage.isEncryptionAvailable()) throw Error('Windows credential encryption is unavailable.');
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(vault));
      fs.writeFileSync(temp, encrypted, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch { /* Keep the original credential store intact. */ }
      throw error;
    }
  }

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
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Error(`SoundCloud authorization failed (${response.status}). Check your app credentials and redirect address.`);
    const data = await response.json();
    if (!data.access_token || !data.refresh_token) throw Error('SoundCloud did not return a complete authorization.');
    record.accessToken = data.access_token;
    record.refreshToken = data.refresh_token;
    record.expires = Date.now() + (data.expires_in || 3600) * 1000;
    persist();
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
    if (target.origin !== 'https://api.soundcloud.com') throw Error('Unexpected API pagination address.');
    if (!record?.accessToken) throw Error('Connect your SoundCloud account first.');
    await refreshIfNeeded(record);
    const response = await fetch(target, {
      headers: { Authorization: 'OAuth ' + record.accessToken, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Error(`SoundCloud returned ${response.status}. ${response.status === 429 ? 'Rate limit reached. Please try again later.' : 'Try reconnecting your account.'}`);
    return response.json();
  }

  async function sync() {
    if (syncing) throw Error('A SoundCloud catalog sync is already running.');
    syncing = true;
    const record = active();
    try {
      const profile = await request('/me', record);
      let tracks = [];
      let next = '/me/tracks?linked_partitioning=true&limit=200';
      let pages = 0;
      while (next && pages++ < 50) {
        const data = await request(next, record);
        tracks.push(...(Array.isArray(data) ? data : data.collection || []));
        next = Array.isArray(data) ? null : data.next_href;
      }
      if (next) throw Error('Catalog exceeds this build’s 10,000-track sync limit. Previous snapshot preserved.');
      record.snapshot = {
        profile: { username: profile.username, followers_count: profile.followers_count, track_count: profile.track_count },
        tracks: tracks.map(track => ({
          id: track.id,
          title: track.title,
          sharing: track.sharing,
          playback_count: track.playback_count,
          likes_count: track.likes_count,
          favoritings_count: track.favoritings_count,
          description: typeof track.description === 'string' ? track.description.slice(0, 12000) : '',
          permalink_url: typeof track.permalink_url === 'string' ? track.permalink_url : '',
          streamable: track.streamable === true
        })),
        syncedAt: new Date().toISOString()
      };
      if (!record.label || record.label === 'SoundCloud account') record.label = profile.username || record.label;
      persist();
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
    record.clientId = id;
    record.clientSecret = secret;
    record.accessToken = '';
    record.refreshToken = '';
    record.expires = 0;
    record.snapshot = null;
    persist();
    return status();
  }

  function add(label) {
    if (pending || syncing) throw Error('Finish the current SoundCloud operation first.');
    const source = active();
    if (!source?.clientId || !source?.clientSecret) throw Error('Save your SoundCloud app credentials before adding another account.');
    if (vault.accounts.length >= 10) throw Error('You can save up to 10 SoundCloud accounts on this PC.');
    const name = typeof label === 'string' ? label.trim().slice(0, 80) : '';
    const record = makeAccount({ label: name || 'New SoundCloud account', clientId: source.clientId, clientSecret: source.clientSecret });
    vault.accounts.push(record);
    vault.activeAccountId = record.id;
    persist();
    return status();
  }

  function switchTo(id) {
    if (pending || syncing) throw Error('Finish the current SoundCloud operation before switching accounts.');
    if (!vault.accounts.some(item => item.id === id)) throw Error('That saved SoundCloud account could not be found.');
    vault.activeAccountId = id;
    persist();
    return status();
  }

  function remove(id) {
    if (pending || syncing) throw Error('Finish the current SoundCloud operation before removing an account.');
    if (vault.accounts.length < 2) throw Error('The last saved account cannot be removed.');
    const index = vault.accounts.findIndex(item => item.id === id);
    if (index < 0) throw Error('That saved SoundCloud account could not be found.');
    vault.accounts.splice(index, 1);
    if (vault.activeAccountId === id) vault.activeAccountId = vault.accounts[0].id;
    persist();
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
        record.accessToken = '';
        record.refreshToken = '';
        record.expires = 0;
        record.snapshot = null;
        persist();
      }
      return status();
    },
    authorize,
    preview
  };
}

module.exports = { createConnection };
