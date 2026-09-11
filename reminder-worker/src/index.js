// reminder-worker — the backend half of LIFEMan.EXE's Web Push reminders (see
// docs/ROADMAP.md "Web Push reminders" and CLAUDE.md's "Reminder push notifications" section in
// the main app repo). Stores each browser's push subscription + reminder list in KV, and once a
// minute (Cron Trigger) checks for anything due and sends it as a real Web Push message.
//
// *** THE ONE PART OF THIS FILE THAT NEEDS A REAL DEVICE TO VERIFY ***
// sendWebPush() implements RFC 8291 (message encryption, "aes128gcm") and RFC 8292 (VAPID JWT
// auth) by hand with WebCrypto, because the standard `web-push` npm package shells out to
// Node's `https`/`crypto` modules in ways that don't run on Workers. It's written carefully and
// directly from those RFCs, but it has never been run against a real push service (Apple's
// web.push.apple.com, Google's fcm.googleapis.com/wp, or Mozilla's) from this dev environment —
// there is no way to create a real PushSubscription without an actual browser + device. The
// first real test is: deploy this, ENABLE REMINDER NOTIFICATIONS on a real installed iOS PWA,
// add a near-future reminder, and see whether the notification arrives. If it doesn't, the most
// likely bug is in ece_aes128gcm_encrypt() or buildVapidJwt() below — everything else (routing,
// KV, the due-reminder check) is ordinary and easy to reason about.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // single-user personal app — no cookies/credentials involved, so a wildcard is fine
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

/* ============================ base64url helpers ============================ */
function b64urlToBytes(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/* ============================ VAPID JWT (RFC 8292) ============================ */
// Signs a compact JWT {typ:'JWT',alg:'ES256'} with the VAPID private key. WebCrypto's ECDSA
// `sign()` output is already the raw (r || s) JOSE format ES256 wants — no DER conversion needed.
async function buildVapidJwt(audience, subjectMailto, vapidPrivateKeyB64url, vapidPublicKeyB64url) {
  const pub = b64urlToBytes(vapidPublicKeyB64url); // 65 bytes: 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: vapidPrivateKeyB64url,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud: audience, sub: subjectMailto, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  })));
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToB64url(sig)}`;
}

/* ============================ Message encryption (RFC 8291, aes128gcm) ============================ */
async function hkdf(saltBytes, ikmBytes, infoBytes, lengthBytes) {
  const key = await crypto.subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes }, key, lengthBytes * 8);
  return new Uint8Array(bits);
}
// Encrypts `plaintext` for one subscriber per RFC 8291, returning the full aes128gcm body
// (RFC 8188 §2.1 header + ciphertext) ready to POST as-is to the push endpoint.
async function ece_aes128gcm_encrypt(plaintextBytes, subscriptionKeys) {
  const uaPublic = b64urlToBytes(subscriptionKeys.p256dh); // subscriber's public key, 65 bytes
  const authSecret = b64urlToBytes(subscriptionKeys.auth); // subscriber's auth secret, 16 bytes

  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey)); // our ephemeral public key, 65 bytes

  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256));

  const te = new TextEncoder();
  // RFC 8291 §3.4: combine the ECDH secret with the subscriber's auth secret first.
  const keyInfo = concatBytes(te.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  // RFC 8188 §2.2: derive the content-encryption key and nonce from a per-message random salt.
  const cek = await hkdf(salt, ikm, concatBytes(te.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concatBytes(te.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // RFC 8188 §2: a single (final) record ends with delimiter 0x02, then AES-128-GCM (tag appended by WebCrypto).
  const recordPlaintext = concatBytes(plaintextBytes, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, recordPlaintext));

  // RFC 8188 §2.1 header: salt(16) || record_size(4, big-endian) || keyid_length(1) || keyid(our public key, 65)
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublic.length]), asPublic);

  return concatBytes(header, ciphertext);
}

async function sendWebPush(subscription, payloadObj, env) {
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
  const body = await ece_aes128gcm_encrypt(plaintext, subscription.keys);
  const audience = new URL(subscription.endpoint).origin; // RFC 8292: aud must be the push service's origin
  const jwt = await buildVapidJwt(audience, `mailto:${env.VAPID_SUBJECT_EMAIL}`, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });
}

/* ============================ Storage ============================ */
// KV key is a hash of the endpoint rather than the endpoint itself — push endpoint URLs are long
// and can contain characters KV would rather not deal with as a key, and a fixed-length key is
// slightly nicer to reason about.
async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A single KV entry holding every subscriber's key, so the once-a-minute cron never has to call
// list() to discover them (see checkDueReminders()). This exists because of a real production
// incident (2026-09-12): KV's free tier caps *list* operations at 1,000/day, separately from the
// 100,000/day read cap — a per-minute list() is 1,440 calls/day on its own, blowing the list
// budget by 44% before a single subscriber ever gets checked, and once that budget's exhausted
// for the day list() starts erroring, silently breaking reminder delivery until the UTC-midnight
// reset. The index below is read with a plain get() (100k/day budget) instead, and only written
// on subscribe/unsubscribe — for a personal app that's rare enough that even the read-modify-write
// race between two near-simultaneous subscribes (KV has no atomic list-append) is an acceptable,
// unlikely-to-matter risk, not worth a more complex scheme.
const INDEX_KEY = '__subscriber_index__';
async function getIndex(env) {
  const raw = await env.REMINDERS_KV.get(INDEX_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function addToIndex(env, key) {
  const index = await getIndex(env);
  if (index.includes(key)) return;
  index.push(key);
  await env.REMINDERS_KV.put(INDEX_KEY, JSON.stringify(index));
}
async function removeFromIndex(env, key) {
  const index = await getIndex(env);
  if (!index.includes(key)) return;
  await env.REMINDERS_KV.put(INDEX_KEY, JSON.stringify(index.filter((k) => k !== key)));
}

/* ============================ HTTP endpoints ============================ */
async function handleSubscribe(request, env) {
  const { subscription, reminders, timezone } = await request.json();
  if (!subscription || !subscription.endpoint || !subscription.keys) return json({ error: 'Missing subscription' }, 400);
  const key = await keyFor(subscription.endpoint);
  await env.REMINDERS_KV.put(key, JSON.stringify({
    subscription, reminders: reminders || [], timezone: timezone || 'UTC', sentIds: [],
  }));
  await addToIndex(env, key);
  return json({ ok: true });
}
async function handleReminders(request, env) {
  const { endpoint, reminders, timezone } = await request.json();
  if (!endpoint) return json({ error: 'Missing endpoint' }, 400);
  const key = await keyFor(endpoint);
  const existingRaw = await env.REMINDERS_KV.get(key);
  if (!existingRaw) return json({ error: 'Not subscribed' }, 404);
  const existing = JSON.parse(existingRaw);
  const newIds = new Set((reminders || []).map((r) => r.id));
  await env.REMINDERS_KV.put(key, JSON.stringify({
    ...existing,
    reminders: reminders || [],
    timezone: timezone || existing.timezone,
    sentIds: (existing.sentIds || []).filter((id) => newIds.has(id)), // drop sent-state for reminders that no longer exist
  }));
  await addToIndex(env, key); // defensive no-op for any subscriber written before the index existed
  return json({ ok: true });
}
async function handleUnsubscribe(request, env) {
  const { endpoint } = await request.json();
  if (!endpoint) return json({ error: 'Missing endpoint' }, 400);
  const key = await keyFor(endpoint);
  await env.REMINDERS_KV.delete(key);
  await removeFromIndex(env, key);
  return json({ ok: true });
}

/* ============================ Cron: find + send due reminders ============================ */
// "Local" date/time for a reminder, formatted in the subscriber's own timezone, via Intl (which
// Workers fully support) — avoids doing manual UTC-offset/DST arithmetic by hand.
function nowInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
const GRACE_MINUTES = 10; // covers a missed cron tick or a subscription synced right after the due time
function minutesSinceMidnight(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
async function checkDueReminders(env) {
  const index = await getIndex(env); // one cheap get() — see the INDEX_KEY comment for why this isn't list()
  for (const key of index) {
    await processSubscriber(key, env);
  }
}
async function processSubscriber(key, env) {
  const raw = await env.REMINDERS_KV.get(key);
  if (!raw) return;
  const record = JSON.parse(raw);
  const { date: today, time: nowTime } = nowInTimezone(record.timezone || 'UTC');
  const nowMin = minutesSinceMidnight(nowTime);
  const sentIds = new Set(record.sentIds || []);
  // Same-day reminders only (r.date === today), so there's no midnight wraparound to worry about
  // here — comparing minutes-since-midnight as plain integers (not "HH:MM" strings, which break
  // near 00:00 when the grace window's lower bound wraps past 23:59) is enough.
  const due = (record.reminders || []).filter((r) => {
    if (r.date !== today || !r.time || sentIds.has(r.id)) return false;
    const diff = nowMin - minutesSinceMidnight(r.time);
    return diff >= 0 && diff <= GRACE_MINUTES;
  });
  if (due.length === 0) return;

  let subscriptionGone = false;
  for (const reminder of due) {
    try {
      const res = await sendWebPush(record.subscription, {
        title: reminder.title, body: reminder.notes || '', reminderId: reminder.id, url: './',
      }, env);
      if (res.status === 404 || res.status === 410) { subscriptionGone = true; break; } // push service says this subscription is dead
      if (res.ok) sentIds.add(reminder.id);
      else console.error(`Push send failed for ${reminder.id}: ${res.status} ${await res.text()}`);
    } catch (e) {
      console.error(`Push send threw for ${reminder.id}:`, e.message);
    }
  }
  if (subscriptionGone) { await env.REMINDERS_KV.delete(key); await removeFromIndex(env, key); return; }
  await env.REMINDERS_KV.put(key, JSON.stringify({ ...record, sentIds: [...sentIds] }));
}

/* ============================ Entry points ============================ */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/subscribe') return await handleSubscribe(request, env);
      if (request.method === 'POST' && url.pathname === '/reminders') return await handleReminders(request, env);
      if (request.method === 'POST' && url.pathname === '/unsubscribe') return await handleUnsubscribe(request, env);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkDueReminders(env));
  },
};
