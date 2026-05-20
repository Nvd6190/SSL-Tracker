import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dns from 'node:dns';
import net from 'node:net';
import { URL } from 'node:url';

const PORT = 3456;

/**
 * Connect to a host on port 443, retrieve the peer certificate,
 * and return structured SSL metadata.
 */
function scanCertificate(hostname) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized: false, // We want to inspect even expired certs
        timeout: 8000,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          if (!cert || !cert.subject) {
            socket.destroy();
            return reject(new Error('No certificate returned'));
          }

          const cn = cert.subject.CN || '';
          const issuer = cert.issuer
            ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(' — ')
            : '';

          // Subject Alternative Names
          const sanRaw = cert.subjectaltname || '';
          const sanList = sanRaw
            .split(',')
            .map((s) => s.trim().replace(/^DNS:/i, ''))
            .filter(Boolean);

          // Determine certificate type
          const hasWildcard = sanList.some((s) => s.startsWith('*.')) || cn.startsWith('*.');
          let certType = 'Single Domain';
          if (hasWildcard) {
            certType = 'Wildcard';
          }

          const validFrom = cert.valid_from ? new Date(cert.valid_from).toISOString().slice(0, 10) : null;
          const validTo = cert.valid_to ? new Date(cert.valid_to).toISOString().slice(0, 10) : null;
          const serialNumber = cert.serialNumber || '';
          const fingerprint = cert.fingerprint256 || cert.fingerprint || '';

          const result = {
            hostname,
            commonName: cn,
            issuer,
            validFrom,
            validTo,
            certType,
            sanList,
            serialNumber,
            fingerprint,
          };

          socket.destroy();
          resolve(result);
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      },
    );

    socket.on('error', (err) => {
      reject(new Error(`TLS connection to ${hostname}:443 failed — ${err.message}`));
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${hostname}:443 timed out`));
    });
  });
}

/**
 * Fetch JSON or text from an HTTPS URL.
 */
function httpsGet(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      let data = '';
      // Set a deadline for the entire response (connection + download)
      const deadline = setTimeout(() => {
        request.destroy();
        reject(new Error('timeout'));
      }, timeout);
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => { clearTimeout(deadline); resolve(data); });
      response.on('error', (err) => { clearTimeout(deadline); reject(err); });
    });
    request.on('error', (err) => reject(err));
    request.on('timeout', () => { request.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Source 1: crt.sh — Certificate Transparency logs
 */
async function fetchCrtSh(domain) {
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
  const data = await httpsGet(url, 30000);
  const entries = JSON.parse(data);
  const names = new Set();
  for (const entry of entries) {
    for (const name of (entry.name_value || '').split(/\n/)) {
      const clean = name.trim().toLowerCase();
      if (clean && clean.endsWith(domain) && !clean.startsWith('*')) {
        names.add(clean);
      }
    }
  }
  return names;
}

/**
 * Source 2: HackerTarget — host search (free, no API key)
 */
async function fetchHackerTarget(domain) {
  const url = `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`;
  const data = await httpsGet(url, 15000);
  const names = new Set();
  if (data.startsWith('error') || data.includes('API count exceeded')) return names;
  for (const line of data.split('\n')) {
    const host = line.split(',')[0]?.trim().toLowerCase();
    if (host && host.endsWith(domain) && !host.startsWith('*')) {
      names.add(host);
    }
  }
  return names;
}

/**
 * Source 3: DNS brute-force — resolve common subdomain prefixes
 */
const COMMON_SUBDOMAINS = [
  'www', 'mail', 'ftp', 'webmail', 'smtp', 'pop', 'ns1', 'ns2', 'ns3', 'ns4',
  'dns', 'dns1', 'dns2', 'mx', 'mx1', 'mx2', 'remote', 'blog', 'server',
  'cpanel', 'whm', 'autodiscover', 'autoconfig', 'shop', 'store', 'portal',
  'admin', 'forum', 'vpn', 'api', 'dev', 'staging', 'test', 'sandbox', 'demo',
  'beta', 'app', 'apps', 'web', 'old', 'new', 'backup', 'cdn', 'cloud',
  'git', 'docs', 'wiki', 'help', 'support', 'status', 'monitor',
  'jenkins', 'ci', 'build', 'prod', 'stage', 'uat', 'qa',
  'db', 'mysql', 'postgres', 'redis', 'elastic', 'search',
  'proxy', 'gateway', 'lb', 'node1', 'node2', 'worker',
  'email', 'imap', 'exchange', 'owa', 'outlook',
  'sso', 'login', 'auth', 'id', 'account',
  'pay', 'billing', 'crm', 'erp', 'hr', 'intranet', 'internal',
  'assets', 'static', 'media', 'img', 'images', 'files', 'download',
  'secure', 'ssl', 'vpn2', 'citrix', 'rdp',
  'sip', 'voip', 'meet', 'jira', 'confluence',
  'm', 'mobile', 'www2', 'www3', 'web1', 'web2',
  'host', 'host1', 'srv', 'srv1', 'vps',
  'dc', 'dc1', 'ad', 'ldap', 'ntp', 'log', 'logs',
  'analytics', 'tracking', 'stats', 'dashboard', 'panel', 'console',
  'service', 'services', 'api2', 'rest', 'ws',
  'mail2', 'marketing', 'info', 'events', 'ticket',
];

async function dnsResolveHost(hostname) {
  return new Promise((resolve) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (!err && addresses && addresses.length > 0) resolve(hostname);
      else resolve(null);
    });
  });
}

async function dnsBruteForce(domain, dnsServer) {
  const resolver = new dns.Resolver();
  if (dnsServer) resolver.setServers([dnsServer]);
  if (resolver.setLocalAddress) try { resolver.cancel; } catch {}
  // 2-second timeout per DNS query
  try { resolver.setTimeout && resolver.setTimeout(2000); } catch {}

  const names = new Set();
  const batchSize = 50;
  for (let i = 0; i < COMMON_SUBDOMAINS.length; i += batchSize) {
    const batch = COMMON_SUBDOMAINS.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((prefix) => {
        const host = `${prefix}.${domain}`;
        return Promise.race([
          new Promise((resolve) => {
            resolver.resolve4(host, (err, addresses) => {
              if (!err && addresses && addresses.length > 0) resolve(host);
              else resolve(null);
            });
          }),
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        names.add(r.value.toLowerCase());
      }
    }
  }
  return names;
}

/**
 * Source 4: DNS Records resolver — queries MX, NS, SOA, SRV, TXT, CNAME
 * to discover hostnames embedded in DNS records. Also attempts zone transfer.
 * Supports custom/private DNS server.
 */
async function dnsRecordsLookup(domain, dnsServer) {
  const resolver = new dns.Resolver();
  if (dnsServer) resolver.setServers([dnsServer]);
  try { resolver.setTimeout && resolver.setTimeout(3000); } catch {}

  const names = new Set();

  // Helper: resolve with custom resolver + 4s per-query timeout
  function resolveType(host, type) {
    return Promise.race([
      new Promise((resolve) => {
        resolver.resolve(host, type, (err, records) => {
          if (err) resolve([]);
          else resolve(records || []);
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve([]), 4000)),
    ]);
  }

  // Get NS records — authoritative nameservers
  const nsRecords = await resolveType(domain, 'NS');
  for (const ns of nsRecords) {
    const clean = ns.replace(/\.$/, '').toLowerCase();
    if (clean.endsWith(domain)) names.add(clean);
  }

  // Get MX records — mail servers
  const mxRecords = await resolveType(domain, 'MX');
  for (const mx of mxRecords) {
    const exchange = (mx.exchange || '').replace(/\.$/, '').toLowerCase();
    if (exchange.endsWith(domain)) names.add(exchange);
  }

  // Get SOA record
  const soaRecords = await resolveType(domain, 'SOA');
  for (const soa of soaRecords) {
    const nsname = (soa.nsname || '').replace(/\.$/, '').toLowerCase();
    if (nsname.endsWith(domain)) names.add(nsname);
    const rname = (soa.hostmaster || '').replace(/\.$/, '').toLowerCase().replace(/^[^.]+\./, '');
    // rname is an email encoded as DNS name — less useful, skip
  }

  // Get TXT records — look for hostnames in SPF, DKIM, DMARC, etc.
  const txtRecords = await resolveType(domain, 'TXT');
  for (const txt of txtRecords) {
    const joined = Array.isArray(txt) ? txt.join('') : String(txt);
    // Extract hostnames that match the domain from TXT values
    const regex = new RegExp(`([a-z0-9]([a-z0-9-]*\\.)*${domain.replace(/\./g, '\\.')})`, 'gi');
    let match;
    while ((match = regex.exec(joined)) !== null) {
      names.add(match[1].toLowerCase());
    }
  }

  // SRV records — common service prefixes
  const srvPrefixes = [
    '_sip._tcp', '_sip._udp', '_sips._tcp',
    '_xmpp-server._tcp', '_xmpp-client._tcp',
    '_http._tcp', '_https._tcp',
    '_caldav._tcp', '_carddav._tcp',
    '_imap._tcp', '_imaps._tcp',
    '_submission._tcp',
    '_autodiscover._tcp',
    '_ldap._tcp', '_kerberos._tcp',
    '_kpasswd._tcp', '_gc._tcp',
  ];

  const srvResults = await Promise.allSettled(
    srvPrefixes.map((prefix) => resolveType(`${prefix}.${domain}`, 'SRV'))
  );

  for (const r of srvResults) {
    if (r.status === 'fulfilled') {
      for (const srv of r.value) {
        const target = (srv.name || '').replace(/\.$/, '').toLowerCase();
        if (target.endsWith(domain)) names.add(target);
      }
    }
  }

  // Try zone transfer (AXFR) via the nameservers we found
  // This usually fails for public domains (blocked by most DNS servers)
  // but can work for private/internal DNS servers
  const nsHosts = nsRecords.map((ns) => ns.replace(/\.$/, ''));
  if (dnsServer) nsHosts.unshift(dnsServer);

  for (const nsHost of nsHosts.slice(0, 2)) {
    try {
      const axfrNames = await attemptZoneTransfer(domain, nsHost);
      for (const name of axfrNames) names.add(name);
    } catch {
      // AXFR blocked — expected for most public domains
    }
  }

  return names;
}

/**
 * Attempt DNS zone transfer (AXFR) — connects via TCP to nameserver.
 * Works on private/internal DNS; usually blocked on public DNS.
 */
function attemptZoneTransfer(domain, nsHost) {
  return new Promise((resolve) => {
    const names = new Set();
    let settled = false;
    function done() {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      clearTimeout(deadline);
      resolve(names);
    }

    // Hard 5-second deadline for entire AXFR attempt
    const deadline = setTimeout(done, 5000);

    let socket;
    try {
      socket = net.connect({ host: nsHost, port: 53, timeout: 3000 });
    } catch {
      clearTimeout(deadline);
      return resolve(names);
    }

    // Build AXFR query packet
    const labels = domain.split('.');
    let qnameLen = 1; // trailing 0 byte
    for (const l of labels) qnameLen += 1 + l.length;

    const packetLen = 12 + qnameLen + 4; // header + qname + qtype + qclass
    const buf = Buffer.alloc(2 + packetLen); // 2-byte TCP length prefix

    // TCP length prefix
    buf.writeUInt16BE(packetLen, 0);
    // Transaction ID
    buf.writeUInt16BE(0x1234, 2);
    // Flags: standard query
    buf.writeUInt16BE(0x0000, 4);
    // Questions: 1
    buf.writeUInt16BE(1, 6);
    // Answer/Auth/Additional: 0
    buf.writeUInt16BE(0, 8);
    buf.writeUInt16BE(0, 10);
    buf.writeUInt16BE(0, 12);

    // QNAME
    let offset = 14;
    for (const label of labels) {
      buf.writeUInt8(label.length, offset++);
      buf.write(label, offset, label.length, 'ascii');
      offset += label.length;
    }
    buf.writeUInt8(0, offset++);
    // QTYPE: AXFR (252)
    buf.writeUInt16BE(252, offset);
    offset += 2;
    // QCLASS: IN (1)
    buf.writeUInt16BE(1, offset);

    let response = Buffer.alloc(0);

    socket.on('data', (data) => {
      response = Buffer.concat([response, data]);
    });

    socket.on('end', () => {
      // Parse response for domain names (simplified — look for domain suffix in ASCII)
      const text = response.toString('ascii');
      const regex = new RegExp(`[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.${domain.replace(/\./g, '\\.')}`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        const name = match[0].toLowerCase();
        if (!name.startsWith('*')) names.add(name);
      }
      done();
    });

    socket.on('error', () => done());
    socket.on('timeout', () => done());

    socket.write(buf);
  });
}

/**
 * Discover subdomains by combining multiple sources:
 *   1. crt.sh (Certificate Transparency)
 *   2. HackerTarget (host search)
 *   3. DNS brute-force (~200 common prefixes)
 *   4. DNS Records (MX, NS, SOA, SRV, TXT + AXFR attempt)
 * Accepts optional dnsServer for private/internal DNS resolution.
 */
async function discoverSubdomains(domain, dnsServer) {
  const sourcesMap = new Map();

  function addFromSource(names, sourceName) {
    for (const name of names) {
      if (!sourcesMap.has(name)) sourcesMap.set(name, new Set());
      sourcesMap.get(name).add(sourceName);
    }
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  const [crtResult, htResult, dnsResult, dnsRecResult] = await Promise.allSettled([
    withTimeout(fetchCrtSh(domain), 35000),
    withTimeout(fetchHackerTarget(domain), 15000),
    withTimeout(dnsBruteForce(domain, dnsServer), 20000),
    withTimeout(dnsRecordsLookup(domain, dnsServer), 15000),
  ]);

  const sourceStatus = {};

  if (crtResult.status === 'fulfilled') {
    addFromSource(crtResult.value, 'crt.sh');
    sourceStatus['crt.sh'] = { found: crtResult.value.size };
  } else {
    sourceStatus['crt.sh'] = { error: crtResult.reason?.message || 'failed' };
  }

  if (htResult.status === 'fulfilled') {
    addFromSource(htResult.value, 'HackerTarget');
    sourceStatus['HackerTarget'] = { found: htResult.value.size };
  } else {
    sourceStatus['HackerTarget'] = { error: htResult.reason?.message || 'failed' };
  }

  if (dnsResult.status === 'fulfilled') {
    addFromSource(dnsResult.value, 'DNS Brute-force');
    sourceStatus['DNS Brute-force'] = { found: dnsResult.value.size };
  } else {
    sourceStatus['DNS Brute-force'] = { error: dnsResult.reason?.message || 'failed' };
  }

  if (dnsRecResult.status === 'fulfilled') {
    addFromSource(dnsRecResult.value, 'DNS Records');
    sourceStatus['DNS Records'] = { found: dnsRecResult.value.size };
  } else {
    sourceStatus['DNS Records'] = { error: dnsRecResult.reason?.message || 'failed' };
  }

  // Build sorted result with sources
  const entries = [...sourcesMap.entries()].map(([name, srcs]) => ({
    name,
    sources: [...srcs],
  }));

  // Sort: root domain first, then alphabetically
  entries.sort((a, b) => {
    if (a.name === domain) return -1;
    if (b.name === domain) return 1;
    return a.name.localeCompare(b.name);
  });

  return { entries, sourceStatus };
}

const server = http.createServer(async (req, res) => {
  // CORS headers — allow the Vite dev server origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // POST /scan   { domains: ["example.com", "other.io"] }
  if (req.method === 'POST' && req.url === '/scan') {
    let body = '';
    for await (const chunk of req) body += chunk;

    let domains;
    try {
      const parsed = JSON.parse(body);
      domains = parsed.domains;
      if (!Array.isArray(domains) || domains.length === 0) throw new Error();
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Body must be { "domains": ["example.com"] }' }));
    }

    // Validate domains — basic allowlist pattern
    const domainPattern = /^[a-zA-Z0-9*]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;
    const sanitised = domains
      .map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter((d) => domainPattern.test(d));

    const results = await Promise.allSettled(sanitised.map((d) => scanCertificate(d)));

    const output = results.map((r, i) =>
      r.status === 'fulfilled'
        ? { ...r.value, error: null }
        : { hostname: sanitised[i], error: r.reason?.message || 'Unknown error' },
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(output));
  }

  // GET /scan?domain=example.com  (single domain convenience)
  if (req.method === 'GET' && req.url?.startsWith('/scan')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();

    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?domain= parameter' }));
    }

    try {
      const result = await scanCertificate(domain);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ hostname: domain, error: err.message }));
    }
  }

  // GET /subdomains?domain=example.com&dns=10.0.0.1  — discover subdomains
  if (req.method === 'GET' && req.url?.startsWith('/subdomains')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
    const dnsServer = (url.searchParams.get('dns') || '').trim() || null;

    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?domain= parameter' }));
    }

    try {
      const { entries, sourceStatus } = await discoverSubdomains(domain, dnsServer);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        domain,
        dnsServer: dnsServer || 'system default',
        subdomains: entries,
        total: entries.length,
        sources: sourceStatus,
      }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ domain, error: err.message }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🔒 SSL scanner API listening on http://localhost:${PORT}`);
  console.log('   POST /scan  { "domains": ["example.com"] }');
  console.log('   GET  /scan?domain=example.com');
});
