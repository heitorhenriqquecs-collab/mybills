const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_DURATION_SECONDS = 60 * 60 * 24 * 30;
const AUTH_WINDOW_SECONDS = 10 * 60;
const AUTH_ATTEMPTS_PER_WINDOW = 20;
const PASSWORD_ITERATIONS = 100000;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return respond(request, env, error.status, { error: error.code, message: error.message });
      }
      console.error('MyBills Cloud:', error);
      return respond(request, env, 500, {
        error: 'internal_error',
        message: 'O servidor não conseguiu concluir esta operação.'
      });
    }
  }
};

async function route(request, env) {
  if (!env.DB) return respond(request, env, 503, { error: 'database_unavailable' });
  if (!env.MYBILLS_SECRET || env.MYBILLS_SECRET.length < 32) {
    return respond(request, env, 503, { error: 'server_not_configured' });
  }

  const cors = corsHeaders(request, env);
  if (!cors) return json(403, { error: 'origin_not_allowed' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const { pathname } = new URL(request.url);
  if (pathname === '/api/health' && request.method === 'GET') {
    return json(200, { ok: true, service: 'mybills-cloudflare', time: new Date().toISOString() }, cors);
  }

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    if (await authRateLimited(request, env)) {
      return json(429, { error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' }, cors);
    }
    const body = await readBody(request);
    const cpf = normalizeCpf(body.cpf);
    const password = String(body.password || '');
    const name = String(body.name || '').trim().slice(0, 50);
    if (!validCpf(cpf)) return json(400, { error: 'invalid_cpf', message: 'Informe um CPF válido.' }, cors);
    if (password.length < 8 || password.length > 72) {
      return json(400, { error: 'invalid_password', message: 'A senha deve ter entre 8 e 72 caracteres.' }, cors);
    }

    const lookup = await cpfKey(cpf, env.MYBILLS_SECRET);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE cpf_key = ?').bind(lookup).first();
    if (existing) return json(409, { error: 'account_exists', message: 'Já existe uma conta com este CPF.' }, cors);

    const user = {
      id: crypto.randomUUID(),
      cpfMasked: maskCpf(cpf),
      name: name || 'Usuário',
      createdAt: new Date().toISOString(),
      cloudRevision: 0
    };
    const protectedPassword = await passwordHash(password);
    const initialState = {
      version: 1,
      revision: 0,
      updatedAt: user.createdAt,
      emptyStateConfirmed: true,
      entries: [],
      uiState: {}
    };
    const protectedState = await encryptState(initialState, env.MYBILLS_SECRET);

    try {
      await env.DB.prepare(`
        INSERT INTO users (
          cpf_key, id, cpf_masked, name, password_salt, password_hash,
          created_at, cloud_revision, state_iv, state_cipher
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).bind(
        lookup, user.id, user.cpfMasked, user.name,
        protectedPassword.salt, protectedPassword.hash, user.createdAt,
        protectedState.iv, protectedState.cipher
      ).run();
    } catch (error) {
      if (String(error?.message || error).toLowerCase().includes('unique')) {
        return json(409, { error: 'account_exists', message: 'Já existe uma conta com este CPF.' }, cors);
      }
      throw error;
    }

    return json(201, { token: await createToken(user, env.MYBILLS_SECRET), user: publicUser(user) }, cors);
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    if (await authRateLimited(request, env)) {
      return json(429, { error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' }, cors);
    }
    const body = await readBody(request);
    const cpf = normalizeCpf(body.cpf);
    const user = validCpf(cpf)
      ? await env.DB.prepare('SELECT * FROM users WHERE cpf_key = ?').bind(await cpfKey(cpf, env.MYBILLS_SECRET)).first()
      : null;
    if (!user || !(await passwordMatches(String(body.password || ''), user))) {
      return json(401, { error: 'invalid_credentials', message: 'CPF ou senha incorretos.' }, cors);
    }
    return json(200, { token: await createToken(user, env.MYBILLS_SECRET), user: publicUser(user) }, cors);
  }

  const user = await readToken(request, env);
  if (!user) return json(401, { error: 'unauthorized', message: 'Entre novamente para continuar.' }, cors);

  if (pathname === '/api/me' && request.method === 'GET') {
    return json(200, { user: publicUser(user) }, cors);
  }

  if (pathname === '/api/state' && request.method === 'GET') {
    const state = await decryptState(user, env.MYBILLS_SECRET);
    if (!validState(state)) {
      return json(500, { error: 'state_unavailable', message: 'Não foi possível abrir os dados desta conta.' }, cors);
    }
    return json(200, { cloudRevision: Number(user.cloud_revision || 0), state }, cors);
  }

  if (pathname === '/api/state' && request.method === 'PUT') {
    const body = await readBody(request);
    if (!validState(body.state) || (!body.state.entries.length && !body.state.emptyStateConfirmed)) {
      return json(400, { error: 'invalid_state', message: 'Os dados enviados são inválidos.' }, cors);
    }
    const nextRevision = Number(user.cloud_revision || 0) + 1;
    const state = {
      ...body.state,
      updatedAt: new Date().toISOString(),
      revision: Math.max(Number(body.state.revision) || 0, nextRevision)
    };
    const protectedState = await encryptState(state, env.MYBILLS_SECRET);
    await env.DB.prepare(`
      UPDATE users
      SET cloud_revision = ?, state_iv = ?, state_cipher = ?
      WHERE id = ?
    `).bind(nextRevision, protectedState.iv, protectedState.cipher, user.id).run();
    return json(200, { cloudRevision: nextRevision, state }, cors);
  }

  return json(404, { error: 'not_found' }, cors);
}

function json(status, value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}

function respond(request, env, status, value) {
  return json(status, value, corsHeaders(request, env) || {});
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
  if (origin && origin !== 'null' && allowed.size > 0 && !allowed.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS'
  };
}

async function readBody(request) {
  const statedSize = Number(request.headers.get('Content-Length') || 0);
  if (statedSize > 2 * 1024 * 1024) throw new HttpError(413, 'payload_too_large');
  const text = await request.text();
  if (encoder.encode(text).byteLength > 2 * 1024 * 1024) throw new HttpError(413, 'payload_too_large');
  try { return JSON.parse(text || '{}'); }
  catch { throw new HttpError(400, 'invalid_json'); }
}

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function normalizeCpf(value) { return String(value || '').replace(/\D/g, ''); }

function validCpf(value) {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = length => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function maskCpf(value) {
  const cpf = normalizeCpf(value);
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

async function cpfKey(cpf, secret) {
  return keyedHash(normalizeCpf(cpf), secret);
}

async function keyedHash(value, secret) {
  return bytesToHex(await hmac(encoder.encode(secret), encoder.encode(String(value))));
}

async function passwordHash(password, saltBytes = crypto.getRandomValues(new Uint8Array(16))) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PASSWORD_ITERATIONS },
    material,
    256
  );
  return { salt: bytesToBase64(saltBytes), hash: bytesToBase64(new Uint8Array(bits)) };
}

async function passwordMatches(password, user) {
  const candidate = await passwordHash(password, base64ToBytes(user.password_salt));
  return constantTimeEqual(base64ToBytes(candidate.hash), base64ToBytes(user.password_hash));
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}:financial-state`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptState(state, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(state))
  );
  return { iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)) };
}

async function decryptState(user, secret) {
  try {
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(user.state_iv) },
      await encryptionKey(secret),
      base64ToBytes(user.state_cipher)
    );
    return JSON.parse(decoder.decode(clear));
  } catch { return null; }
}

async function createToken(user, secret) {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    sub: user.id,
    exp: Math.floor(Date.now() / 1000) + TOKEN_DURATION_SECONDS
  })));
  const signature = base64UrlEncode(await hmac(encoder.encode(secret), encoder.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${signature}`;
}

async function readToken(request, env) {
  const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let supplied;
  try { supplied = base64UrlDecode(parts[2]); }
  catch { return null; }
  const expected = await hmac(encoder.encode(env.MYBILLS_SECRET), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!constantTimeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (!payload.sub || payload.exp < Date.now() / 1000) return null;
    return await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
  } catch { return null; }
}

async function hmac(keyBytes, valueBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, valueBytes));
}

function publicUser(user) {
  return {
    id: user.id,
    cpf: user.cpfMasked || user.cpf_masked,
    name: user.name || 'Usuário'
  };
}

function validEntry(entry) {
  return Boolean(
    entry && typeof entry.id === 'string' && entry.id.trim() &&
    ['income', 'expense'].includes(entry.type) &&
    typeof entry.description === 'string' && entry.description.trim() &&
    Number.isFinite(Number(entry.value)) && Number(entry.value) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') &&
    typeof entry.category === 'string' && entry.category.trim() &&
    ['once', 'monthly', 'installments'].includes(entry.recurrence)
  );
}

function validState(value) {
  return Boolean(
    value?.version === 1 && Array.isArray(value.entries) && value.entries.length <= 10000 &&
    value.entries.every(validEntry) &&
    new Set(value.entries.map(entry => entry.id)).size === value.entries.length
  );
}

async function authRateLimited(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await keyedHash(ip, env.MYBILLS_SECRET);
  const bucket = Math.floor(Date.now() / 1000 / AUTH_WINDOW_SECONDS) * AUTH_WINDOW_SECONDS;
  await env.DB.prepare(`
    INSERT INTO auth_limits (key, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN auth_limits.window_start < excluded.window_start THEN 1 ELSE auth_limits.attempts + 1 END,
      window_start = CASE WHEN auth_limits.window_start < excluded.window_start THEN excluded.window_start ELSE auth_limits.window_start END
  `).bind(key, bucket).run();
  const current = await env.DB.prepare('SELECT attempts FROM auth_limits WHERE key = ?').bind(key).first();
  return Number(current?.attempts || 0) > AUTH_ATTEMPTS_PER_WINDOW;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64UrlEncode(bytes) {
  return bytesToBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return base64ToBytes(padded);
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
