const http = require('http');
const fs = require('fs');
const path = require('path');

const host = '127.0.0.1';
const port = 4173;
const appRoot = __dirname;
const dataDirectory = path.join(process.env.LOCALAPPDATA || appRoot, 'MyBills', 'Data');
const stateFile = path.join(dataDirectory, 'state.json');
let lastActivity = Date.now();

fs.mkdirSync(dataDirectory, { recursive: true });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) request.destroy();
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  lastActivity = Date.now();
  const requestUrl = new URL(request.url, `http://${host}:${port}`);

  if (requestUrl.pathname === '/api/ping') return send(response, 200, 'ok');

  if (requestUrl.pathname === '/api/state' && request.method === 'GET') {
    try {
      const content = await fs.promises.readFile(stateFile, 'utf8');
      return send(response, 200, content, mimeTypes['.json']);
    } catch (error) {
      if (error.code === 'ENOENT') return send(response, 404, '{}', mimeTypes['.json']);
      return send(response, 500, '{"error":"read_failed"}', mimeTypes['.json']);
    }
  }

  if (requestUrl.pathname === '/api/state' && request.method === 'POST') {
    await readRequest(request).catch(()=>{});
    return send(response, 410, '{"error":"browser_version_retired","message":"Use o aplicativo MyBills para computador."}', mimeTypes['.json']);
  }

  if (request.method !== 'GET') return send(response, 405, 'Método não permitido');
  const relativePath = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname.slice(1));
  const filePath = path.resolve(appRoot, relativePath);
  if (!filePath.startsWith(path.resolve(appRoot) + path.sep)) return send(response, 403, 'Acesso negado');
  try {
    const content = await fs.promises.readFile(filePath);
    send(response, 200, content, mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  } catch (error) {
    send(response, error.code === 'ENOENT' ? 404 : 500, 'Arquivo não encontrado');
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') process.exit(0);
  process.exit(1);
});

server.listen(port, host);

setInterval(() => {
  if (Date.now() - lastActivity > 90000) server.close(() => process.exit(0));
}, 15000).unref();
