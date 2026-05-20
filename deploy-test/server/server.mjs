/**
 * Production server for Azure App Service.
 * Serves the Vite-built static frontend AND the SSL scanner API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = process.env.PORT || 8080;

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

// Dynamically import the scanner handlers
const scannerModule = await import('./scanner.mjs');
// The scanner.mjs starts its own server on port 3456 — we need to
// extract the logic instead. We'll import the functions and handle
// API routes here.

// Since scanner.mjs starts its own http server, we need to
// re-export the request handler. We'll proxy API requests to it.
// But a cleaner approach: serve static files here, and proxy /scan
// and /subdomains to the scanner running on 3456.

// Start the scanner on its own port (it auto-starts on import)
// We just need to proxy API calls to it.

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

const server = http.createServer((req, res) => {
  // Route API calls to the scanner
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
