import { useCallback, useEffect, useRef, useState } from 'react';
import type { CertificateRecord, CertType, ScanResult } from './types';

const SCANNER_URL = import.meta.env.DEV ? 'http://localhost:3456' : '';

interface Props {
  onAdd: (record: Omit<CertificateRecord, 'id'>) => void;
  onClose: () => void;
}

export function AddDomainModal({ onAdd, onClose }: Props) {
  const [domain, setDomain] = useState('');
  const [customer, setCustomer] = useState('');
  const [customerPocName, setCustomerPocName] = useState('');
  const [customerPocEmail, setCustomerPocEmail] = useState('');
  const [customerPocPhone, setCustomerPocPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState('');

  // Auto-filled by scan
  const [issuer, setIssuer] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [certType, setCertType] = useState<CertType>('Single Domain');
  const [sanList, setSanList] = useState<string[]>([]);

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSubmit = domain.trim().length > 0 && customer.trim().length > 0 && scanned;

  const runScan = useCallback(async (host: string) => {
    if (!host) return;
    setScanning(true);
    setScanError('');
    setScanned(false);
    try {
      const resp = await fetch(`${SCANNER_URL}/scan?domain=${encodeURIComponent(host)}`);
      const data: ScanResult = await resp.json();
      if (data.error) {
        setScanError(data.error);
      } else {
        setIssuer(data.issuer || '');
        setExpiresOn(data.validTo || '');
        setValidFrom(data.validFrom || '');
        setCertType((data.certType as CertType) || 'Single Domain');
        setSanList(data.sanList || []);
        setScanned(true);
      }
    } catch {
      setScanError('Scanner unreachable — is the server running on port 3456?');
    }
    setScanning(false);
  }, []);

  // Auto-scan after user stops typing for 800ms
  useEffect(() => {
    const trimmed = domain.trim().toLowerCase();
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);

    // Reset scan state when domain changes
    setScanned(false);
    setScanError('');

    // Only auto-scan if it looks like a real domain (has a dot)
    if (trimmed.length > 3 && trimmed.includes('.')) {
      scanTimerRef.current = setTimeout(() => runScan(trimmed), 800);
    }

    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [domain, runScan]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onAdd({
      commonName: domain.trim(),
      issuedTo: customer.trim(),
      issuer,
      owner: '',
      contact: '',
      customerPocName: customerPocName.trim(),
      customerPocEmail: customerPocEmail.trim(),
      customerPocPhone: customerPocPhone.trim(),
      expiresOn,
      validFrom: validFrom || null,
      renewedOn: null,
      autoRenew: false,
      certType,
      sanList,
      tags: [],
      notes: notes.trim(),
    });
    onClose();
  }

  const formatDateDisplay = (v: string) => {
    if (!v) return '—';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(v));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">New certificate</p>
            <h2 id="add-title">Add Certificate</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="add-form">
          {/* Domain — auto-scans */}
          <div className="add-form-row">
            <div className="add-form-field add-form-field-full">
              <label>Domain *</label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. api.example.com"
                required
                autoFocus
              />
              {scanning && <p className="scan-status scanning">Scanning SSL certificate…</p>}
              {scanError && <p className="scan-status scan-error">{scanError}</p>}
            </div>
          </div>

          {/* Auto-scanned SSL info */}
          {scanned && (
            <div className="scan-result-card">
              <p className="scan-result-heading">✓ SSL certificate detected</p>
              <div className="scan-result-grid">
                <div><span className="scan-result-label">Valid From</span><strong>{formatDateDisplay(validFrom)}</strong></div>
                <div><span className="scan-result-label">Expires On</span><strong>{formatDateDisplay(expiresOn)}</strong></div>
                <div><span className="scan-result-label">Issuer</span><strong>{issuer || '—'}</strong></div>
                <div>
                  <span className="scan-result-label">Type</span>
                  <strong>
                    <span className={`cert-type-badge cert-type-${certType.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                      {certType}
                    </span>
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Manual fields */}
          <div className="add-form-row">
            <div className="add-form-field">
              <label>Customer / Organisation *</label>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="e.g. Acme Corp"
                required
              />
            </div>
            <div className="add-form-field">
              <label>Contact Name</label>
              <input value={customerPocName} onChange={(e) => setCustomerPocName(e.target.value)} placeholder="Point-of-contact name" />
            </div>
          </div>

          <div className="add-form-row">
            <div className="add-form-field">
              <label>Email Address</label>
              <input type="email" value={customerPocEmail} onChange={(e) => setCustomerPocEmail(e.target.value)} placeholder="poc@customer.com" />
            </div>
            <div className="add-form-field">
              <label>Phone Number</label>
              <input value={customerPocPhone} onChange={(e) => setCustomerPocPhone(e.target.value)} placeholder="+91-9876543210" />
            </div>
          </div>

          <div className="add-form-row">
            <div className="add-form-field add-form-field-full">
              <label>Remarks</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {!scanned && domain.trim().length > 3 ? 'Waiting for scan…' : 'Add Certificate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
