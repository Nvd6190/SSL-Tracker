import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SubdomainDiscovery } from './SubdomainDiscovery';
import type { SubdomainEntry } from './SubdomainDiscovery';
import { certificateRecords } from './data/certificates';
import type { CertificateRecord, CertType, ScanResult } from './types';
import './index.css';

const SCANNER_URL = import.meta.env.DEV ? 'http://localhost:3456' : '';
const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : '';

/** Load certificates from the backend API; falls back to seed data. */
async function loadCertsFromAPI(): Promise<CertificateRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/api/certificates`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data;
  } catch (e) {
    console.warn('Could not load from API, using seed data:', e);
  }
  return certificateRecords;
}

/** Load subdomains from the backend API. */
async function loadSubdomainsFromAPI(): Promise<SubdomainEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/api/subdomains`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) return data;
  } catch (e) {
    console.warn('Could not load subdomains from API:', e);
  }
  return [];
}

/** Save discovered subdomains to the backend. */
async function saveSubdomainsToDB(entries: SubdomainEntry[]) {
  if (entries.length === 0) return;
  try {
    await fetch(`${API_BASE}/api/subdomains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    });
  } catch (e) {
    console.warn('Failed to save subdomains:', e);
  }
}

/** Save a single record to the backend. */
async function saveCertToAPI(record: CertificateRecord) {
  try {
    await fetch(`${API_BASE}/api/certificates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (e) {
    console.warn('Failed to save cert:', e);
  }
}

/** Bulk-save records to the backend. */
async function saveCertsBulk(records: CertificateRecord[]) {
  try {
    await fetch(`${API_BASE}/api/certificates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records),
    });
  } catch (e) {
    console.warn('Failed to bulk save:', e);
  }
}

/** Delete a cert from the backend. */
async function deleteCertFromAPI(id: string) {
  try {
    await fetch(`${API_BASE}/api/certificates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('Failed to delete cert:', e);
  }
}

interface SubdomainScanResult {
  domain: string;
  subdomains: { name: string; sources: string[] }[];
  total: number;
  error?: string;
}

type Page = 'dashboard' | 'subdomains';

function Root() {
  const [page, setPage] = useState<Page>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [records, setRecords] = useState<CertificateRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Background subdomain scan state
  const [discoveredSubs, setDiscoveredSubs] = useState<SubdomainEntry[]>([]);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, scanning: false });
  const [scanErrors, setScanErrors] = useState<Record<string, string>>({});
  const scanRef = useRef(false);
  const prevRecordsRef = useRef<CertificateRecord[]>([]);

  // Load from API on startup
  useEffect(() => {
    Promise.all([loadCertsFromAPI(), loadSubdomainsFromAPI()]).then(([certs, subs]) => {
      setRecords(certs);
      prevRecordsRef.current = certs;
      if (subs.length > 0) setDiscoveredSubs(subs);
      setLoading(false);
    });
  }, []);

  const domainList = Array.from(
    new Set(records.map((r) => r.commonName.replace(/^\*\./, '').toLowerCase()).filter(Boolean))
  ).sort();

  const handleRecordsChange = useCallback((updater: CertificateRecord[] | ((prev: CertificateRecord[]) => CertificateRecord[])) => {
    setRecords((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Sync changes to DB in the background
      const prevIds = new Set(prev.map((r) => r.id));
      const nextIds = new Set(next.map((r) => r.id));
      // Deleted records
      for (const id of prevIds) {
        if (!nextIds.has(id)) deleteCertFromAPI(id);
      }
      // Added or updated records
      const changed = next.filter((r) => {
        const old = prev.find((o) => o.id === r.id);
        return !old || JSON.stringify(old) !== JSON.stringify(r);
      });
      if (changed.length > 0) saveCertsBulk(changed);
      return next;
    });
  }, []);

  // Auto SSL cert scan — runs once on startup, updates cert info (expiry, issuer, etc.)
  const sslScanRef = useRef(false);
  const runAutoSSLScan = useCallback(async (domains: string[]) => {
    if (domains.length === 0) return;
    try {
      const resp = await fetch(`${SCANNER_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
      });
      const results: ScanResult[] = await resp.json();
      const resultMap = new Map<string, ScanResult>();
      for (const r of results) resultMap.set(r.hostname, r);

      setRecords((prev) => {
        const next = prev.map((rec) => {
          const key = rec.commonName.replace(/^\*\./, '').toLowerCase();
          const scan = resultMap.get(key);
          if (!scan) return rec;
          if (scan.error) {
            return { ...rec, scanError: scan.error };
          }
          return {
            ...rec,
            issuer: scan.issuer || rec.issuer,
            expiresOn: scan.validTo || rec.expiresOn,
            validFrom: scan.validFrom || rec.validFrom,
            certType: (scan.certType as CertType) || rec.certType,
            sanList: scan.sanList && scan.sanList.length > 0 ? scan.sanList : rec.sanList,
            scanError: undefined,
          };
        });
        const changed = next.filter((r) => {
          const old = prev.find((o) => o.id === r.id);
          return !old || JSON.stringify(old) !== JSON.stringify(r);
        });
        if (changed.length > 0) saveCertsBulk(changed);
        return next;
      });
    } catch {
      console.warn('Auto SSL scan failed — scanner unreachable');
    }
  }, []);

  // Background scan — runs once on startup, updates records' sanList
  const runBackgroundScan = useCallback(async (domains: string[]) => {
    if (domains.length === 0) return;
    setScanProgress({ done: 0, total: domains.length, scanning: true });
    setScanErrors({});
    const subs: SubdomainEntry[] = [];
    const errs: Record<string, string> = {};

    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      try {
        const resp = await fetch(
          `${SCANNER_URL}/subdomains?domain=${encodeURIComponent(domain)}`
        );
        const data: SubdomainScanResult = await resp.json();
        if (data.error) {
          errs[domain] = data.error;
        } else if (data.subdomains) {
          const domainSubs = data.subdomains.map((s) => ({ ...s, parentDomain: domain }));
          subs.push(...domainSubs);

          // Save discovered subdomains to DB
          saveSubdomainsToDB(domainSubs);

          // Update record's sanList with discovered subdomains
          const subNames = data.subdomains.map((s) => s.name);
          setRecords((prev) => {
            const next = prev.map((rec) => {
              const recDomain = rec.commonName.replace(/^\*\./, '').toLowerCase();
              if (recDomain !== domain) return rec;
              const merged = Array.from(new Set([...rec.sanList, ...subNames])).sort();
              return { ...rec, sanList: merged };
            });
            // Persist updated sanLists
            const changed = next.filter((r) => {
              const old = prev.find((o) => o.id === r.id);
              return !old || JSON.stringify(old) !== JSON.stringify(r);
            });
            if (changed.length > 0) saveCertsBulk(changed);
            return next;
          });
        }
      } catch {
        errs[domain] = 'Scanner unreachable';
      }
      setScanProgress({ done: i + 1, total: domains.length, scanning: true });
      setDiscoveredSubs([...subs]);
      setScanErrors({ ...errs });
    }
    setScanProgress((p) => ({ ...p, scanning: false }));
  }, []);

  // Auto-scan on first load (after records load from DB)
  useEffect(() => {
    if (loading || scanRef.current || domainList.length === 0) return;
    scanRef.current = true;
    runBackgroundScan(domainList);
  }, [loading, domainList, runBackgroundScan]);

  // Auto SSL cert scan on first load
  useEffect(() => {
    if (loading || sslScanRef.current || domainList.length === 0) return;
    sslScanRef.current = true;
    runAutoSSLScan(domainList);
  }, [loading, domainList, runAutoSSLScan]);

  const handleRescan = useCallback(() => {
    setDiscoveredSubs([]);
    runBackgroundScan(domainList);
  }, [domainList, runBackgroundScan]);

  return (
    <div className="app-layout">
      <button
        className="mobile-nav-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle navigation"
      >
        ☰
      </button>

      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-icon">🔒</span>
          SSL Tracker
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item${page === 'dashboard' ? ' nav-item-active' : ''}`}
            onClick={() => { setPage('dashboard'); setSidebarOpen(false); }}
          >
            <span className="nav-icon">📊</span>
            Overview
          </button>
          <button
            className={`nav-item${page === 'subdomains' ? ' nav-item-active' : ''}`}
            onClick={() => { setPage('subdomains'); setSidebarOpen(false); }}
          >
            <span className="nav-icon">🔍</span>
            Subdomain Scanner
          </button>
        </nav>

        <div className="sidebar-footer">
          SSL Tracker v1.0
        </div>
      </aside>

      <main className="main-content">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontSize: '1.2rem', color: '#888' }}>
            Loading certificate data…
          </div>
        ) : (
          <>
            {page === 'dashboard' && <App records={records} onRecordsChange={handleRecordsChange} />}
            {page === 'subdomains' && (
              <SubdomainDiscovery
                subdomains={discoveredSubs}
                scanProgress={scanProgress}
                scanErrors={scanErrors}
                onRescan={handleRescan}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);