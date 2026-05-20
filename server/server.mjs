/**
 * Production server for Azure App Service.
 * Serves the Vite-built static frontend, SSL scanner API, and certificate CRUD API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, getAllCerts, upsertCert, bulkUpsert, deleteCert, getAllSubdomains, bulkUpsertSubdomains, deleteSubdomainsByDomain } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = process.env.PORT || 8080;

// Initialize database on startup
try {
  await initDB();
} catch (err) {
  console.error('⚠️ Database init failed (app will run without persistence):', err.message);
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

// Dynamically import the scanner (starts on port 3456)
const scannerModule = await import('./scanner.mjs');

/**
 * Serve a static file from the dist directory.
 */
function serveStatic(req, res) {
  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent path traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(DIST_DIR))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // If file doesn't exist, serve index.html for SPA routing
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

/**
 * Proxy an API request to the scanner running on port 3456.
 */
function proxyToScanner(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: 3456,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:3456` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Scanner API unavailable' }));
  });

  req.pipe(proxyReq, { end: true });
}

/**
 * Read the full JSON body from a request.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 */
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Handle /api/certificates routes.
 */
async function handleCertsAPI(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split('/').filter(Boolean); // ['api','certificates', maybe id]

  try {
    // GET /api/certificates — list all
    if (req.method === 'GET' && segments.length === 2) {
      const certs = await getAllCerts();
      return sendJSON(res, 200, certs);
    }

    // POST /api/certificates — create or bulk-create
    if (req.method === 'POST' && segments.length === 2) {
      const body = await readBody(req);
      if (!body) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      if (Array.isArray(body)) {
        await bulkUpsert(body);
        return sendJSON(res, 200, { ok: true, count: body.length });
      }
      await upsertCert(body);
      return sendJSON(res, 200, { ok: true });
    }

    // PUT /api/certificates/:id — update one
    if (req.method === 'PUT' && segments.length === 3) {
      const body = await readBody(req);
      if (!body) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      body.id = segments[2];
      await upsertCert(body);
      return sendJSON(res, 200, { ok: true });
    }

    // DELETE /api/certificates/:id — delete one
    if (req.method === 'DELETE' && segments.length === 3) {
      await deleteCert(segments[2]);
      return sendJSON(res, 200, { ok: true });
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('API error:', err);
    sendJSON(res, 500, { error: err.message });
  }
}

/**
 * Handle /api/subdomains routes.
 */
async function handleSubdomainsAPI(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // GET /api/subdomains — list all
    if (req.method === 'GET') {
      const subs = await getAllSubdomains();
      return sendJSON(res, 200, subs);
    }

    // POST /api/subdomains — bulk upsert
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !Array.isArray(body)) return sendJSON(res, 400, { error: 'Expected array of subdomain entries' });
      await bulkUpsertSubdomains(body);
      return sendJSON(res, 200, { ok: true, count: body.length });
    }

    // DELETE /api/subdomains?domain=example.com — delete by parent domain
    if (req.method === 'DELETE') {
      const domain = url.searchParams.get('domain');
      if (!domain) return sendJSON(res, 400, { error: 'Missing domain parameter' });
      await deleteSubdomainsByDomain(domain);
      return sendJSON(res, 200, { ok: true });
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Subdomains API error:', err);
    sendJSON(res, 500, { error: err.message });
  }
}

const server = http.createServer((req, res) => {
  // Certificate CRUD API
  if (req.url?.startsWith('/api/certificates')) {
    return handleCertsAPI(req, res);
  }

  // Subdomain persistence API
  if (req.url?.startsWith('/api/subdomains')) {
    return handleSubdomainsAPI(req, res);
  }

  // Route scanner API calls
  if (req.url?.startsWith('/scan') || req.url?.startsWith('/subdomains')) {
    return proxyToScanner(req, res);
  }

  // Everything else is static
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`🚀 SSL Tracker running on http://localhost:${PORT}`);
  console.log(`   Static files: ${DIST_DIR}`);
  console.log(`   API proxy → http://127.0.0.1:3456`);
});
