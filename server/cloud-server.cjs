const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8787);
const dataDirectory = path.resolve(process.env.MYBILLS_DATA_DIR || path.join(__dirname, 'data'));
const storeFile = path.join(dataDirectory, 'store.json');
const temporaryFile = path.join(dataDirectory, 'store.tmp.json');
const secret = process.env.MYBILLS_JWT_SECRET || 'mybills-development-secret-change-before-publishing';
const encryptionKey = crypto.createHash('sha256').update(`${secret}:financial-state`).digest();
const allowedOrigins = new Set((process.env.MYBILLS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
const authAttempts = new Map();
let writeQueue = Promise.resolve();

fs.mkdirSync(dataDirectory, { recursive: true });

function blankStore() { return { version: 1, users: {} }; }
function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    return parsed?.version === 1 && parsed.users && typeof parsed.users === 'object' ? parsed : blankStore();
  } catch { return blankStore(); }
}
let store = loadStore();

function saveStore() {
  writeQueue = writeQueue.then(async () => {
    const body = JSON.stringify(store, null, 2);
    await fs.promises.writeFile(temporaryFile, body, { encoding: 'utf8', mode: 0o600 });
    const descriptor = await fs.promises.open(temporaryFile, 'r+');
    await descriptor.sync();
    await descriptor.close();
    try { await fs.promises.rename(temporaryFile, storeFile); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await fs.promises.copyFile(temporaryFile, storeFile);
      await fs.promises.unlink(temporaryFile).catch(() => {});
    }
  });
  return writeQueue;
}

function json(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders
  });
  response.end(JSON.stringify(value));
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || origin === 'null' || allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
    return { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS' };
  }
  return null;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('payload_too_large')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
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
function cpfKey(cpf) { return crypto.createHmac('sha256', secret).update(normalizeCpf(cpf)).digest('hex'); }
function maskCpf(cpf) { const value = normalizeCpf(cpf); return `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**`; }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function passwordMatches(password, user) {
  const candidate = Buffer.from(passwordHash(password, user.passwordSalt).hash, 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
function encryptState(state) {
  const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final()]);
  return { iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:encrypted.toString('base64') };
}
function decryptState(user) {
  if(user.state&&validState(user.state))return user.state;
  try{const value=user.encryptedState;const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8'));}catch{return null;}
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function createToken(user) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function readToken(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.sub || payload.exp < Date.now() / 1000) return null;
    return Object.values(store.users).find(user => user.id === payload.sub) || null;
  } catch { return null; }
}

function publicUser(user) { return { id: user.id, cpf: user.cpfMasked, name: user.name || 'Usuário' }; }
function validEntry(entry) {
  return Boolean(entry && typeof entry.id === 'string' && entry.id.trim() && ['income', 'expense'].includes(entry.type) && typeof entry.description === 'string' && entry.description.trim() && Number.isFinite(Number(entry.value)) && Number(entry.value) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') && typeof entry.category === 'string' && entry.category.trim() && ['once', 'monthly', 'installments'].includes(entry.recurrence));
}
function validState(value) {
  return Boolean(value?.version === 1 && Array.isArray(value.entries) && value.entries.length <= 10000 && value.entries.every(validEntry) && new Set(value.entries.map(entry => entry.id)).size === value.entries.length);
}
function authRateLimited(request) {
  const key = request.headers['cf-connecting-ip'] || request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter(time => now - time < 10 * 60 * 1000);
  recent.push(now);
  authAttempts.set(key, recent);
  return recent.length > 20;
}

const server = http.createServer(async (request, response) => {
  const cors = corsHeaders(request);
  if (!cors) return json(response, 403, { error: 'origin_not_allowed' });
  if (request.method === 'OPTIONS') { response.writeHead(204, cors); response.end(); return; }
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (requestUrl.pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, service: 'mybills-cloud', time: new Date().toISOString() }, cors);
  if (requestUrl.pathname === '/api/ready' && request.method === 'GET') {
    try {
      fs.accessSync(dataDirectory, fs.constants.R_OK | fs.constants.W_OK);
      if (store?.version !== 1 || !store.users || typeof store.users !== 'object') throw new Error('invalid_store');
      return json(response, 200, { ok: true, service: 'mybills-cloud', storage: 'ready', uptimeSeconds: Math.floor(process.uptime()), time: new Date().toISOString() }, cors);
    } catch {
      return json(response, 503, { ok: false, service: 'mybills-cloud', storage: 'unavailable' }, cors);
    }
  }

  if (requestUrl.pathname === '/api/auth/register' && request.method === 'POST') {
    if (authRateLimited(request)) return json(response, 429, { error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' }, cors);
    try {
      const body = await readBody(request);
      const cpf = normalizeCpf(body.cpf);
      const password = String(body.password || '');
      const name = String(body.name || '').trim().slice(0, 50);
      if (!validCpf(cpf)) return json(response, 400, { error: 'invalid_cpf', message: 'Informe um CPF válido.' }, cors);
      if (password.length < 8 || password.length > 72) return json(response, 400, { error: 'invalid_password', message: 'A senha deve ter entre 8 e 72 caracteres.' }, cors);
      const lookup = cpfKey(cpf);
      if (store.users[lookup]) return json(response, 409, { error: 'account_exists', message: 'Já existe uma conta com este CPF.' }, cors);
      const protectedPassword = passwordHash(password);
      const user = {
        id: crypto.randomUUID(), cpfMasked: maskCpf(cpf), name: name || 'Usuário', passwordSalt: protectedPassword.salt, passwordHash: protectedPassword.hash,
        createdAt: new Date().toISOString(), cloudRevision: 0,
        encryptedState: encryptState({ version: 1, revision: 0, updatedAt: new Date().toISOString(), emptyStateConfirmed: true, entries: [], uiState: {} })
      };
      store.users[lookup] = user;
      await saveStore();
      return json(response, 201, { token: createToken(user), user: publicUser(user) }, cors);
    } catch (error) { return json(response, error.message === 'payload_too_large' ? 413 : 400, { error: error.message }, cors); }
  }

  if (requestUrl.pathname === '/api/auth/login' && request.method === 'POST') {
    if (authRateLimited(request)) return json(response, 429, { error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' }, cors);
    try {
      const body = await readBody(request);
      const cpf = normalizeCpf(body.cpf);
      const user = validCpf(cpf) ? store.users[cpfKey(cpf)] : null;
      if (!user || !passwordMatches(String(body.password || ''), user)) return json(response, 401, { error: 'invalid_credentials', message: 'CPF ou senha incorretos.' }, cors);
      return json(response, 200, { token: createToken(user), user: publicUser(user) }, cors);
    } catch (error) { return json(response, 400, { error: error.message }, cors); }
  }

  const user = readToken(request);
  if (!user) return json(response, 401, { error: 'unauthorized', message: 'Entre novamente para continuar.' }, cors);

  if (requestUrl.pathname === '/api/me' && request.method === 'GET') return json(response, 200, { user: publicUser(user) }, cors);
  if (requestUrl.pathname === '/api/state' && request.method === 'GET') {
    const state=decryptState(user);if(!validState(state))return json(response,500,{error:'state_unavailable',message:'Não foi possível abrir os dados desta conta.'},cors);
    return json(response, 200, { cloudRevision: user.cloudRevision || 0, state }, cors);
  }
  if (requestUrl.pathname === '/api/state' && request.method === 'PUT') {
    try {
      const body = await readBody(request);
      if (!validState(body.state) || (!body.state.entries.length && !body.state.emptyStateConfirmed)) return json(response, 400, { error: 'invalid_state', message: 'Os dados enviados são inválidos.' }, cors);
      user.cloudRevision = Number(user.cloudRevision || 0) + 1;
      const state={ ...body.state, updatedAt: new Date().toISOString(), revision: Math.max(Number(body.state.revision) || 0, user.cloudRevision) };
      user.encryptedState=encryptState(state);delete user.state;
      await saveStore();
      return json(response, 200, { cloudRevision: user.cloudRevision, state }, cors);
    } catch (error) { return json(response, error.message === 'payload_too_large' ? 413 : 400, { error: error.message }, cors); }
  }

  return json(response, 404, { error: 'not_found' }, cors);
});

server.listen(port, host, () => {
  console.log(`MyBills Cloud ouvindo em http://${host}:${port}`);
  if (secret.includes('development-secret')) console.warn('AVISO: defina MYBILLS_JWT_SECRET antes de publicar o servidor.');
});

