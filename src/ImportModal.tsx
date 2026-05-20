import { useRef, useState } from 'react';
import type { CertificateRecord, CertType, ScanResult } from './types';

const SCANNER_URL = import.meta.env.DEV ? 'http://localhost:3456' : '';

const TEMPLATE_HEADERS = [
  'domain',
  'customer',
  'owner',
  'contact',
  'customer_poc_name',
  'customer_poc_email',
  'customer_poc_phone',
  'tags',
  'notes',
];

interface ParsedRow extends Omit<CertificateRecord, 'id'> {
  rowError?: string;
  scanStatus?: 'pending' | 'scanning' | 'done' | 'error';
  scanError?: string;
}

function splitCSVLine(line: string): string[] {
  // Handles quoted fields containing commas
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase());

  const idx = (name: string) => headers.indexOf(name);

  return lines.slice(1).map((line, i) => {
    const cols = splitCSVLine(line);
    const get = (name: string) => (idx(name) >= 0 ? (cols[idx(name)] ?? '') : '');

    const domain = get('domain');
    const customer = get('customer');
    const errors: string[] = [];
    if (!domain) errors.push('domain is required');
    if (!customer) errors.push('customer is required');

    const tagsRaw = get('tags');
    const tags = tagsRaw ? tagsRaw.split('|').map((t) => t.trim()).filter(Boolean) : [];

    return {
      commonName: domain,
      issuedTo: customer,
      issuer: '',
      owner: get('owner'),
      contact: get('contact'),
      customerPocName: get('customer_poc_name'),
      customerPocEmail: get('customer_poc_email'),
      customerPocPhone: get('customer_poc_phone'),
      expiresOn: '',
      validFrom: null,
      renewedOn: null,
      autoRenew: false,
      certType: 'Single Domain' as CertType,
      sanList: [],
      tags,
      notes: get('notes'),
      rowError: errors.length > 0 ? `Row ${i + 2}: ${errors.join('; ')}` : undefined,
      scanStatus: errors.length > 0 ? undefined : ('pending' as const),
    };
  });
}

function downloadTemplate() {
  const sample =
    'api.example.com,Example Corp,Platform Team,ops@example.com,John Doe,john@example.com,+1-555-1234,api|critical,Renew 30 days before expiry';
  const content = `${TEMPLATE_HEADERS.join(',')}\n${sample}\n`;
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ssl-import-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface Props {
  onImport: (records: Omit<CertificateRecord, 'id'>[]) => void;
  onClose: () => void;
}

export function ImportModal({ onImport, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  const validRows = rows.filter((r) => !r.rowError);
  const errorRows = rows.filter((r) => r.rowError);

  async function handleScan(parsedRows?: ParsedRow[]) {
    const rowsToUse = parsedRows || validRows;
    const domainsToScan = rowsToUse
      .filter((r) => r.scanStatus === 'pending')
      .map((r) => r.commonName);

    if (domainsToScan.length === 0) return;

    setScanning(true);

    // Mark rows as scanning
    setRows((prev) =>
      prev.map((r) =>
        r.scanStatus === 'pending' ? { ...r, scanStatus: 'scanning' as const } : r,
      ),
    );

    try {
      const resp = await fetch(`${SCANNER_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: domainsToScan }),
      });
      const results: ScanResult[] = await resp.json();

      const resultMap = new Map<string, ScanResult>();
      for (const r of results) {
        resultMap.set(r.hostname, r);
      }

      setRows((prev) =>
        prev.map((row) => {
          if (row.scanStatus !== 'scanning') return row;
          const scan = resultMap.get(row.commonName.toLowerCase());
          if (!scan || scan.error) {
            return {
              ...row,
              scanStatus: 'error' as const,
              scanError: scan?.error || 'No response from scanner',
            };
          }
          return {
            ...row,
            issuer: scan.issuer || row.issuer,
            expiresOn: scan.validTo || row.expiresOn,
            validFrom: scan.validFrom || null,
            certType: (scan.certType as CertType) || 'Unknown',
            sanList: scan.sanList || [],
            scanStatus: 'done' as const,
          };
        }),
      );
    } catch {
      setRows((prev) =>
        prev.map((r) =>
          r.scanStatus === 'scanning'
            ? { ...r, scanStatus: 'error' as const, scanError: 'Scanner API unreachable — is the server running on port 3456?' }
            : r,
        ),
      );
    }

    setScanning(false);
    setScanDone(true);
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setScanDone(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
      // Auto-scan immediately after parsing
      const pendingRows = parsed.filter((r) => !r.rowError && r.scanStatus === 'pending');
      if (pendingRows.length > 0) {
        handleScan(parsed);
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleConfirm() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const clean = validRows.map(({ rowError: _err, scanStatus: _s, scanError: _se, ...rest }) => rest);
    onImport(clean);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Bulk import</p>
            <h2 id="import-title">Import Certificates</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <p className="modal-intro">
          Upload a CSV file with <strong>domain</strong> and <strong>customer</strong> columns.
          After uploading, certificates are automatically scanned to detect
          the expiry date, issuer, and type (Single Domain / Wildcard)
          for each domain. Optional columns:{' '}
          <code>owner, contact, customer_poc_name, customer_poc_email, customer_poc_phone, tags, notes</code>.
          Separate multiple tags with <code>|</code>.
        </p>

        <button className="btn btn-ghost" onClick={downloadTemplate}>
          ↓ Download Template CSV
        </button>

        <div
          className={`drop-zone${dragOver ? ' drop-zone-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
          aria-label="Upload CSV file"
        >
          {fileName ? (
            <span className="drop-zone-filename">
              📄 {fileName} — {rows.length} row{rows.length !== 1 ? 's' : ''} parsed
            </span>
          ) : (
            <span>
              Drop a CSV file here or <u>click to browse</u>
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        {errorRows.length > 0 && (
          <div className="import-errors" role="alert">
            <strong>
              {errorRows.length} row{errorRows.length !== 1 ? 's' : ''} will be skipped due to errors
            </strong>
            <ul>
              {errorRows.map((r, i) => (
                <li key={i}>{r.rowError}</li>
              ))}
            </ul>
          </div>
        )}

        {validRows.length > 0 && (
          <div className="import-preview">
            {scanning && (
              <div className="scan-prompt">
                <p>Scanning {validRows.length} domain{validRows.length !== 1 ? 's' : ''} for SSL certificates…</p>
              </div>
            )}

            {scanDone && (
              <p className="import-preview-label scan-done-label">
                ✓ Scan complete — {validRows.filter((r) => r.scanStatus === 'done').length} succeeded,{' '}
                {validRows.filter((r) => r.scanStatus === 'error').length} failed
              </p>
            )}

            <div className="import-preview-grid import-preview-heading">
              <span>Domain</span>
              <span>Customer</span>
              <span>Type</span>
              <span>Expires</span>
              <span>Status</span>
            </div>
            {validRows.slice(0, 10).map((row, i) => (
              <div className="import-preview-grid" key={i}>
                <span>{row.commonName}</span>
                <span>{row.issuedTo}</span>
                <span>
                  {row.scanStatus === 'done' ? (
                    <span className={`cert-type-badge cert-type-${row.certType.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                      {row.certType}
                    </span>
                  ) : '—'}
                </span>
                <span>{row.scanStatus === 'done' && row.expiresOn ? row.expiresOn : '—'}</span>
                <span>
                  {row.scanStatus === 'pending' && <span className="scan-badge scan-pending">Pending</span>}
                  {row.scanStatus === 'scanning' && <span className="scan-badge scan-running">Scanning…</span>}
                  {row.scanStatus === 'done' && <span className="scan-badge scan-ok">✓ Scanned</span>}
                  {row.scanStatus === 'error' && (
                    <span className="scan-badge scan-fail" title={row.scanError}>✗ Failed</span>
                  )}
                </span>
              </div>
            ))}
            {validRows.length > 10 && (
              <p className="import-preview-more">…and {validRows.length - 10} more</p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={validRows.length === 0 || scanning || !scanDone} onClick={handleConfirm}>
            {scanning
              ? 'Scanning…'
              : validRows.length > 0
                ? `Import ${validRows.length} record${validRows.length !== 1 ? 's' : ''}`
                : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
