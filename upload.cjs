const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const uploadOrigin = 'https://api.soundcloud.com';
const uploadResponseByteLimit = 2 * 1024 * 1024;

function uploadError(message, { code, statusCode, retryAfterMs } = {}) {
  const error = Error(message);
  if (code) error.code = code;
  if (Number.isInteger(statusCode)) error.statusCode = statusCode;
  if (Number.isFinite(retryAfterMs)) error.retryAfterMs = retryAfterMs;
  return error;
}

function retryAfterMs(response, now = Date.now()) {
  const header = response.headers['retry-after'];
  if (typeof header !== 'string') return undefined;
  let delay;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) delay = Number(header.trim()) * 1000;
  else {
    const date = Date.parse(header);
    if (Number.isFinite(date)) delay = Math.max(0, date - now);
  }
  return Number.isFinite(delay) ? Math.min(Math.max(0, delay), 24 * 60 * 60 * 1000) : undefined;
}

function fileSignature(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(':');
}

async function openStableFile(file, limit) {
  if (typeof file !== 'string' || !file) throw Error('Choose a valid audio or artwork file.');
  const before = await fs.promises.stat(file, { bigint: true });
  if (!before.isFile() || before.size <= 0n || before.size > BigInt(limit)) throw Error('Choose a non-empty file within the SoundCloud upload size limit.');
  const handle = await fs.promises.open(file, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || fileSignature(before) !== fileSignature(opened)) throw Error('The selected file changed before upload. Review it and try again.');
    return { path: file, handle, size: Number(opened.size), signature: fileSignature(opened) };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function validateArtworkSignature(entry) {
  const header = Buffer.alloc(12);
  const { bytesRead } = await entry.handle.read(header, 0, header.length, 0);
  const png = bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp = bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw Error('Choose a valid PNG, JPEG, or WebP artwork file.');
}

function validateReceipt(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw uploadError('SoundCloud returned an invalid upload receipt. Check your catalog before retrying.', { code: 'SC_UPLOAD_UNCERTAIN' });
  const id = data.id;
  const idText = Number.isSafeInteger(id) && id > 0 ? String(id) : typeof id === 'string' && /^\d{1,128}$/.test(id) && /[1-9]/.test(id) ? id : '';
  const urnPattern = /^soundcloud:tracks:[1-9]\d{0,127}$/;
  const urnValues = [data.urn, id].filter(value => typeof value === 'string' && value.length <= 160 && urnPattern.test(value));
  const urn = urnValues[0] || '';
  const urnId = urn.slice('soundcloud:tracks:'.length);
  const normalizeDigits = value => value.replace(/^0+/, '') || '0';
  if ((idText && urn && normalizeDigits(idText) !== normalizeDigits(urnId)) || (urnValues.length > 1 && urnValues.some(value => value !== urn))) {
    throw uploadError('SoundCloud returned an upload receipt with inconsistent track identifiers. Check your catalog before retrying.', { code: 'SC_UPLOAD_UNCERTAIN' });
  }
  if (!urn && !idText) {
    throw uploadError('SoundCloud accepted the request but returned no valid track ID. Check your SoundCloud catalog before retrying.', { code: 'SC_UPLOAD_UNCERTAIN' });
  }
  return data;
}

async function sendUpload(file, metadata, { token, url = `${uploadOrigin}/tracks`, onProgress = () => {}, onRateLimit = () => {}, signal, artwork, operationTimeoutMs = 15 * 60 * 1000 } = {}) {
  if (typeof token !== 'string' || !token || token.length > 65536) throw Error('Connect your SoundCloud account before uploading.');
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs < 1000 || operationTimeoutMs > 60 * 60 * 1000) throw Error('Upload time limit is invalid.');
  let target;
  try { target = new URL(url); } catch { throw Error('The SoundCloud upload address is invalid.'); }
  if (target.protocol !== 'https:' || target.origin !== uploadOrigin || target.username || target.password || target.port || target.hash || target.pathname !== '/tracks') {
    throw Error('The upload destination must be the official SoundCloud API.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw Error('Upload details are invalid.');

  const fields = [];
  for (const [key, raw] of Object.entries(metadata)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key) || typeof raw === 'object' || typeof raw === 'function' || raw === undefined || raw === null) {
      throw Error('Upload details are invalid.');
    }
    const value = String(raw);
    if (value.length > 10000) throw Error('Upload details are too long.');
    fields.push([key, value]);
  }

  const openedFiles = [];
  try {
    const audio = await openStableFile(file, 4 * 1024 ** 3);
    openedFiles.push(audio);
    const cover = artwork ? await openStableFile(artwork, 4 * 1024 ** 3) : null;
    if (cover) { openedFiles.push(cover); await validateArtworkSignature(cover); }
    const fileEntries = [['asset_data', audio], ...(cover ? [['artwork_data', cover]] : [])];

    const boundary = `----SoundcloudDesktop${crypto.randomBytes(16).toString('hex')}`;
    const chunks = [];
    for (const [key, value] of fields) {
      chunks.push({ buffer: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="track[${key}]"\r\n\r\n${value}\r\n`) });
    }
    for (const [key, entry] of fileEntries) {
      const name = path.basename(entry.path).replace(/["\r\n\\]/g, '_');
      chunks.push({ buffer: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="track[${key}]"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`) });
      chunks.push({ entry });
      chunks.push({ buffer: Buffer.from('\r\n') });
    }
    chunks.push({ buffer: Buffer.from(`--${boundary}--\r\n`) });
    const total = chunks.reduce((sum, chunk) => sum + (chunk.buffer?.length || chunk.entry.size), 0);
    if (!Number.isSafeInteger(total)) throw Error('The selected upload is too large.');

    return await new Promise((resolve, reject) => {
      let sent = 0;
      let stream;
      let done = false;
      let request;
      let deadlineTimer;
      const finish = (error, result) => {
        if (done) return;
        done = true;
        clearTimeout(deadlineTimer);
        stream?.destroy();
        signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(result);
      };
      const ambiguousError = (message, code = 'SC_UPLOAD_UNCERTAIN') => uploadError(`${message} Check your SoundCloud catalog before retrying; the server may have received the upload.`, { code });
      const cancel = () => request?.destroy(ambiguousError('Upload cancelled.'));

      request = https.request(target, {
        method: 'POST',
        headers: {
          Authorization: 'OAuth ' + token,
          Accept: 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': total
        }
      }, response => {
        const responseChunks = [];
        let responseBytes = 0;
        response.on('data', chunk => {
          responseBytes += chunk.length;
          if (responseBytes > uploadResponseByteLimit) {
            response.destroy();
            finish(ambiguousError('SoundCloud returned an unexpectedly large upload response.'));
          } else responseChunks.push(chunk);
        });
        response.on('error', () => finish(ambiguousError('The upload response was interrupted.')));
        response.on('end', () => {
          if (done || responseBytes > uploadResponseByteLimit) return;
          const status = response.statusCode || 0;
          if (status < 200 || status >= 300) {
            const retry = retryAfterMs(response);
            if (status === 429) { try { onRateLimit(retry); } catch { /* Rate limiting still surfaces if the observer fails. */ } }
            const retryText = Number.isFinite(retry) ? ` Wait about ${Math.ceil(retry / 1000)} seconds, then check your catalog before retrying.` : '';
            const uncertain = status >= 500;
            finish(uploadError(`SoundCloud rejected the upload (${status}).${status === 401 ? ' Reconnect your account.' : status === 413 ? ' The file exceeds the upload limit.' : status === 429 ? ' Rate limit reached.' : ' Check your account quota and audio format.'}${retryText}${uncertain ? ' The server may have received the upload; check your catalog before retrying.' : ''}`, {
              code: status === 429 ? 'SC_RATE_LIMITED' : uncertain ? 'SC_UPLOAD_UNCERTAIN' : 'SC_UPLOAD_REJECTED',
              statusCode: status,
              retryAfterMs: retry
            }));
            return;
          }
          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(responseChunks, responseBytes));
            const receipt = validateReceipt(JSON.parse(text));
            try { onProgress(100); } catch { /* UI progress reporting does not change a confirmed upload outcome. */ }
            finish(null, receipt);
          }
          catch (error) { finish(error.code ? error : ambiguousError('SoundCloud returned an unreadable upload receipt.')); }
        });
      });
      const onRequestError = () => finish(ambiguousError('The upload connection was interrupted.'));
      const waitForDrain = () => new Promise((resolveDrain, rejectDrain) => {
        const drain = () => { request.off('error', onError); resolveDrain(); };
        const onError = error => { request.off('drain', drain); rejectDrain(error); };
        request.once('drain', drain);
        request.once('error', onError);
      });
      request.on('error', onRequestError);
      request.setTimeout(operationTimeoutMs, () => request.destroy(ambiguousError('Upload timed out.')));
      deadlineTimer = setTimeout(() => request.destroy(ambiguousError('Upload exceeded its time limit.')), operationTimeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }

      (async () => {
        try {
          for (const chunk of chunks) {
            if (done) return;
            if (chunk.buffer) {
              if (!request.write(chunk.buffer)) await waitForDrain();
              sent += chunk.buffer.length;
              continue;
            }
            const entry = chunk.entry;
            stream = entry.handle.createReadStream({ autoClose: false, start: 0, end: entry.size - 1 });
            for await (const data of stream) {
              if (done) return;
              if (!request.write(data)) await waitForDrain();
              sent += data.length;
              onProgress(Math.min(99, Math.floor(sent / total * 100)));
            }
            const after = await entry.handle.stat({ bigint: true });
            if (fileSignature(after) !== entry.signature) throw ambiguousError('A selected file changed during upload.');
          }
          if (done) return;
          request.end();
        } catch (error) {
          request.destroy(error.code === 'SC_UPLOAD_UNCERTAIN' ? error : ambiguousError('The upload stream was interrupted.'));
        }
      })();
    });
  } finally {
    await Promise.all(openedFiles.map(entry => entry.handle.close().catch(() => {})));
  }
}

module.exports = { sendUpload };
