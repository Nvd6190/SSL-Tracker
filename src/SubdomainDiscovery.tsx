import { useState } from 'react';

export interface SubdomainEntry {
  name: string;
  sources: string[];
  parentDomain: string;
}

interface Props {
  subdomains: SubdomainEntry[];
  scanProgress: { done: number; total: number; scanning: boolean };
  scanErrors: Record<string, string>;
  onRescan: () => void;
}

export function SubdomainDiscovery({ subdomains, scanProgress, scanErrors, onRescan }: Props) {
  const [filter, setFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('All');

  const filteredSubs = subdomains.filter((entry) => {
    const matchesDomain = domainFilter === 'All' || entry.parentDomain === domainFilter;
    const matchesText = !filter.trim() || entry.name.includes(filter.trim().toLowerCase());
    return matchesDomain && matchesText;
  });

  const uniqueDomains = Array.from(new Set(subdomains.map((s) => s.parentDomain))).sort();

  function handleExportCSV() {
    if (filteredSubs.length === 0) return;
    const lines = [
      'subdomain,parent_domain,sources',
      ...filteredSubs.map((e) => `${e.name},${e.parentDomain},"${e.sources.join(', ')}"`)
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subdomains-all-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const sourceClasses: Record<string, string> = {
    'crt.sh': 'source-crt-sh',
    'HackerTarget': 'source-hackertarget',
    'DNS Brute-force': 'source-dns-brute-force',
    'DNS Records': 'source-dns-records',
  };

  return (
    <div className="discovery-page">
      <div className="page-header">
        <p className="eyebrow">Network Intelligence</p>
        <h1>Subdomain Scanner</h1>
        <p className="page-desc">
          {scanProgress.scanning
            ? `Scanning in progress — ${scanProgress.done} of ${scanProgress.total} domains completed…`
            : `${subdomains.length} subdomain${subdomains.length !== 1 ? 's' : ''} found across ${uniqueDomains.length} domain${uniqueDomains.length !== 1 ? 's' : ''}.`}
        </p>
      </div>

      {scanProgress.scanning && (
        <div className="scan-progress-bar" style={{ marginBottom: 20 }}>
          <div
            className="scan-progress-fill"
            style={{ width: `${scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0}%` }}
          />
        </div>
      )}

      {Object.keys(scanErrors).length > 0 && (
        <div className="error-banner" role="alert">
          <strong>Some domains could not be scanned:</strong>{' '}
          {Object.entries(scanErrors).map(([d, msg]) => (
            <span key={d} className="error-domain">{d} ({msg})</span>
          ))}
        </div>
      )}

      {subdomains.length > 0 && (
        <>
          <section className="discovery-summary">
            <article className="summary-card">
              <span className="summary-card-value">{subdomains.length}</span>
              <span className="summary-card-label">Subdomains Found</span>
            </article>
            <article className="summary-card">
              <span className="summary-card-value">{uniqueDomains.length}</span>
              <span className="summary-card-label">Domains Analysed</span>
            </article>
          </section>

          <div className="discovery-toolbar">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter subdomains…"
              className="discovery-input"
            />
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="discovery-input"
            >
              <option value="All">All domains</option>
              {uniqueDomains.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={handleExportCSV}>
              ↓ Export CSV
            </button>
            <button className="btn btn-link" onClick={onRescan} disabled={scanProgress.scanning}>
              Re-scan
            </button>
          </div>

          <section className="subdomain-grid">
            <div className="subdomain-grid-3 subdomain-grid-heading">
              <span>Subdomain</span>
              <span>Parent Domain</span>
              <span>Sources</span>
            </div>

            {filteredSubs.map((entry) => (
              <div className="subdomain-grid-3 subdomain-row" key={`${entry.parentDomain}-${entry.name}`}>
                <span className="subdomain-name">{entry.name}</span>
                <span className="subdomain-parent">{entry.parentDomain}</span>
                <span className="source-badges">
                  {entry.sources.map((src) => (
                    <span
                      key={src}
                      className={`source-badge ${sourceClasses[src] || ''}`}
                    >
                      {src}
                    </span>
                  ))}
                </span>
              </div>
            ))}

            {filteredSubs.length === 0 && subdomains.length > 0 && (
              <div className="empty-state">
                <strong>No subdomains match your filter.</strong>
                <p>Clear the filter to see all {subdomains.length} results.</p>
              </div>
            )}
          </section>
        </>
      )}

      {!scanProgress.scanning && subdomains.length === 0 && (
        <div className="empty-state">
          <strong>No subdomains found yet.</strong>
          <p>Subdomains are scanned automatically when domains are added to the inventory.</p>
        </div>
      )}
    </div>
  );
}
