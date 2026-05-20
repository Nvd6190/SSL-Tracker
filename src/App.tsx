import { useCallback, useMemo, useState } from 'react';
import { ImportModal } from './ImportModal';
import { AddDomainModal } from './AddDomainModal';
import type { CertificateRecord, CertType, RenewalStatus, ScanResult } from './types';

const SCANNER_URL = import.meta.env.DEV ? 'http://localhost:3456' : '';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const getDaysUntilExpiry = (expiresOn: string) => {
  if (!expiresOn) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiresOn);
  expiry.setHours(0, 0, 0, 0);
  return Math.floor((expiry.getTime() - today.getTime()) / MS_PER_DAY);
};

const getRenewalStatus = (record: CertificateRecord): RenewalStatus => {
  const daysUntilExpiry = getDaysUntilExpiry(record.expiresOn);

  if (daysUntilExpiry <= 0) {
    return 'Expired / Critical';
  }

  if (daysUntilExpiry <= 14) {
    return 'Urgent';
  }

  if (daysUntilExpiry <= 45) {
    return 'Expiring Soon';
  }

  return 'Active';
};

const getStatusDescription = (status: RenewalStatus, days: number): string => {
  if (days <= 0) return 'Certificate has expired — immediate renewal required';
  if (status === 'Urgent') return `Only ${days} days remaining — action needed`;
  if (status === 'Expiring Soon') return `Expires in ${days} days — schedule renewal`;
  return `Valid for ${days} more days`;
};

const formatDate = (value: string | null) => {
  if (!value) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
};

const sortByUrgency = (records: CertificateRecord[]) =>
  [...records].sort((left, right) => getDaysUntilExpiry(left.expiresOn) - getDaysUntilExpiry(right.expiresOn));

interface AppProps {
  records: CertificateRecord[];
  onRecordsChange: (updater: CertificateRecord[] | ((prev: CertificateRecord[]) => CertificateRecord[])) => void;
}

function App({ records, onRecordsChange: setRecords }: AppProps) {
  const [showImport, setShowImport] = useState(false);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CertificateRecord>>({});
  const [query, setQuery] = useState('');
  const [expiryTab, setExpiryTab] = useState<'All' | 'Active' | 'Expired' | 15 | 30 | 60 | 180 | 'NotFetched'>('All');
  const [renewalFilter, setRenewalFilter] = useState<'All' | RenewalStatus>('All');

  const handleImport = useCallback((incoming: Omit<CertificateRecord, 'id'>[]) => {
    const newRecords: CertificateRecord[] = incoming.map((r, i) => ({
      ...r,
      id: `import-${Date.now()}-${i}`,
    }));
    setRecords((prev) => [...prev, ...newRecords]);
  }, []);

  const handleAddDomain = useCallback((record: Omit<CertificateRecord, 'id'>) => {
    setRecords((prev) => [...prev, { ...record, id: `manual-${Date.now()}` }]);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setDeleteConfirmId(null);
  }, []);

  const startEditCard = (record: CertificateRecord) => {
    setEditingId(record.id);
    setEditDraft({
      issuedTo: record.issuedTo,
      owner: record.owner,
      contact: record.contact,
      customerPocName: record.customerPocName,
      customerPocEmail: record.customerPocEmail,
      customerPocPhone: record.customerPocPhone,
      notes: record.notes,
    });
  };

  const saveEditCard = () => {
    if (!editingId) return;
    setRecords((prev) =>
      prev.map((r) => (r.id === editingId ? { ...r, ...editDraft } : r)),
    );
    setEditingId(null);
    setEditDraft({});
  };

  const cancelEditCard = () => {
    setEditingId(null);
    setEditDraft({});
  };

  const updateDraft = (field: keyof CertificateRecord, value: string) => {
    setEditDraft((prev) => ({ ...prev, [field]: value }));
  };

  const [scanningAll, setScanningAll] = useState(false);

  const handleRescanAll = useCallback(async () => {
    const domains = records.map((r) => r.commonName.replace(/^\*\./, '')).filter(Boolean);
    if (domains.length === 0) return;
    setScanningAll(true);
    try {
      const resp = await fetch(`${SCANNER_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
      });
      const results: ScanResult[] = await resp.json();
      const resultMap = new Map<string, ScanResult>();
      for (const r of results) resultMap.set(r.hostname, r);

      setRecords((prev) =>
        prev.map((rec) => {
          const key = rec.commonName.replace(/^\*\./, '').toLowerCase();
          const scan = resultMap.get(key);
          if (!scan || scan.error) return rec;
          return {
            ...rec,
            issuer: scan.issuer || rec.issuer,
            expiresOn: scan.validTo || rec.expiresOn,
            validFrom: scan.validFrom || rec.validFrom,
            certType: (scan.certType as CertType) || rec.certType,
            sanList: scan.sanList || rec.sanList,
          };
        }),
      );
    } catch {
      // Scanner not reachable — silently ignore
    }
    setScanningAll(false);
  }, [records]);

  const enrichedRecords = useMemo(
    () =>
      sortByUrgency(records).map((record) => ({
        ...record,
        daysUntilExpiry: getDaysUntilExpiry(record.expiresOn),
        renewalStatus: getRenewalStatus(record),
      })),
    [records],
  );

  const isNotFetched = (r: { expiresOn: string; validFrom: string | null; issuer: string }) =>
    !r.expiresOn && !r.validFrom && !r.issuer;

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return enrichedRecords.filter((record) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [record.commonName, record.issuedTo, record.owner, record.contact, record.customerPocName, record.issuer, ...record.tags]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      let matchesExpiry = true;
      if (expiryTab === 'Active') {
        matchesExpiry = record.daysUntilExpiry > 60 && !isNotFetched(record);
      } else if (expiryTab === 'Expired') {
        matchesExpiry = record.daysUntilExpiry <= 0 && !isNotFetched(record);
      } else if (expiryTab === 'NotFetched') {
        matchesExpiry = isNotFetched(record);
      } else if (expiryTab === 15) {
        matchesExpiry = record.daysUntilExpiry <= 15 && record.daysUntilExpiry > 0 && !isNotFetched(record);
      } else if (expiryTab === 30) {
        matchesExpiry = record.daysUntilExpiry <= 30 && record.daysUntilExpiry > 0 && !isNotFetched(record);
      } else if (expiryTab === 60) {
        matchesExpiry = record.daysUntilExpiry <= 60 && record.daysUntilExpiry > 0 && !isNotFetched(record);
      } else if (expiryTab === 180) {
        matchesExpiry = record.daysUntilExpiry <= 180 && record.daysUntilExpiry > 0 && !isNotFetched(record);
      }
      const matchesRenewal = renewalFilter === 'All' || record.renewalStatus === renewalFilter;

      return matchesQuery && matchesExpiry && matchesRenewal;
    });
  }, [enrichedRecords, expiryTab, query, renewalFilter]);

  const summary = useMemo(() => {
    const fetched = enrichedRecords.filter((r) => !isNotFetched(r));
    const notFetched = enrichedRecords.filter((r) => isNotFetched(r));
    const active = fetched.filter((r) => r.daysUntilExpiry > 60);
    const expired = fetched.filter((r) => r.daysUntilExpiry <= 0);
    const in15 = fetched.filter((r) => r.daysUntilExpiry <= 15 && r.daysUntilExpiry > 0);
    const in30 = fetched.filter((r) => r.daysUntilExpiry <= 30 && r.daysUntilExpiry > 0);
    const in60 = fetched.filter((r) => r.daysUntilExpiry <= 60 && r.daysUntilExpiry > 0);
    const in180 = fetched.filter((r) => r.daysUntilExpiry <= 180 && r.daysUntilExpiry > 0);

    return {
      total: enrichedRecords.length,
      active,
      expired,
      in15,
      in30,
      in60,
      in180,
      notFetched,
    };
  }, [enrichedRecords]);

  const nextAction = filteredRecords[0];

  return (
    <>
      <div className="page-header">
        <p className="eyebrow">Certificate Operations</p>
        <h1>Certificate Overview</h1>
        <p className="page-desc">
          Track certificate health, manage renewal timelines, and maintain clear ownership to prevent service disruptions.
        </p>
      </div>

      {nextAction && (
        <section className="priority-banner">
          <div className="priority-icon">⚠️</div>
          <div className="priority-info">
            <span className="priority-label">Needs Attention</span>
            <span className="priority-domain">{nextAction.commonName}</span>
            <span className="priority-meta">
              {nextAction.daysUntilExpiry} days left &bull; {nextAction.owner}
            </span>
          </div>
        </section>
      )}

      <section className="metrics-row">
        <button
          className={`metric-card${expiryTab === 'All' ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab('All')}
        >
          <span className="metric-label">Total Certificates</span>
          <strong className="metric-value">{summary.total}</strong>
        </button>
        <button
          className={`metric-card metric-card-ok${expiryTab === 'Active' ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab('Active')}
        >
          <span className="metric-label">Active</span>
          <strong className="metric-value">{summary.active.length}</strong>
        </button>
        <button
          className={`metric-card metric-card-expired${expiryTab === 'Expired' ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab('Expired')}
        >
          <span className="metric-label">Expired</span>
          <strong className="metric-value">{summary.expired.length}</strong>
        </button>
        <button
          className={`metric-card metric-card-urgent${expiryTab === 15 ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab(15)}
        >
          <span className="metric-label">Due in 15 Days</span>
          <strong className="metric-value">{summary.in15.length}</strong>
        </button>
        <button
          className={`metric-card metric-card-warn${expiryTab === 30 ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab(30)}
        >
          <span className="metric-label">Due in 30 Days</span>
          <strong className="metric-value">{summary.in30.length}</strong>
        </button>
        <button
          className={`metric-card metric-card-info${expiryTab === 60 ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab(60)}
        >
          <span className="metric-label">Due in 60 Days</span>
          <strong className="metric-value">{summary.in60.length}</strong>
        </button>
        <button
          className={`metric-card metric-card-teal${expiryTab === 180 ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab(180)}
        >
          <span className="metric-label">Due in 180 Days</span>
          <strong className="metric-value">{summary.in180.length}</strong>
        </button>
        <button
          className={`metric-card metric-card-notfetched${expiryTab === 'NotFetched' ? ' metric-card-active' : ''}`}
          onClick={() => setExpiryTab('NotFetched')}
        >
          <span className="metric-label">Pending Scan</span>
          <strong className="metric-value">{summary.notFetched.length}</strong>
        </button>
      </section>

      <section className="toolbar-section">
        <div className="toolbar-row">
          <label>
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by domain, owner, issuer, or tag"
            />
          </label>
          <label>
            <span>Renewal status</span>
            <select
              value={renewalFilter}
              onChange={(event) => setRenewalFilter(event.target.value as 'All' | RenewalStatus)}
            >
              <option value="All">All</option>
                <option value="Active">Active</option>
                <option value="Expiring Soon">Expiring Soon</option>
                <option value="Urgent">Urgent</option>
                <option value="Expired / Critical">Expired / Critical</option>
            </select>
          </label>
        </div>
        <p className="toolbar-meta">
          Displaying {filteredRecords.length} of {summary.total} certificates.
        </p>
        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={() => setShowAddDomain(true)}>
            + Add Certificate
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
            ↑ Import CSV
          </button>
          <button className="btn btn-link" disabled={scanningAll} onClick={handleRescanAll}>
            {scanningAll ? 'Refreshing…' : 'Refresh All'}
          </button>
        </div>
      </section>

      <section className="table-section">
        <div className="table-section-header">
          <p className="eyebrow">Certificate Inventory</p>
          <h2>Managed Certificates</h2>
          <p className="table-section-desc">{filteredRecords.length} certificate{filteredRecords.length !== 1 ? 's' : ''}</p>
        </div>

          {filteredRecords.map((record) => {
            const notFetched = isNotFetched(record);
            const statusClass = notFetched ? 'not-fetched' : record.renewalStatus.toLowerCase().replace(/[\s/]+/g, '-');
            const statusDesc = notFetched ? 'Certificate data has not been scanned yet' : getStatusDescription(record.renewalStatus, record.daysUntilExpiry);
            const isEditing = editingId === record.id;

            return (
            <article className={`cert-card cert-card-${statusClass}`} key={record.id}>
              <div className="cert-card-status-bar" />
              <div className="cert-card-body">
                {/* Row 1: Domain + Status + Actions */}
                <div className="cert-card-top">
                  <div className="cert-card-identity">
                    <span className="cert-domain">{record.commonName}</span>
                    <span className={`cert-type-badge cert-type-${record.certType.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                      {record.certType}
                    </span>
                    {isEditing ? (
                      <input className="inline-edit-input" value={editDraft.issuedTo ?? ''} onChange={(e) => updateDraft('issuedTo', e.target.value)} placeholder="Customer / Org" />
                    ) : (
                      record.issuedTo ? <span className="cert-customer">{record.issuedTo}</span> : <span className="cert-customer cert-nil">Add customer or organisation</span>
                    )}
                  </div>
                  <div className="cert-card-status-group">
                    <div className={`cert-status-indicator status-${statusClass}`}>
                      <span className="cert-status-dot" />
                      <span className="cert-status-label">{notFetched ? 'Pending Scan' : record.renewalStatus}</span>
                    </div>
                    <span className="cert-status-desc">{statusDesc}</span>
                  </div>
                  <div className="cert-card-actions">
                    {isEditing ? (
                      <div className="edit-actions">
                        <button className="btn-edit-save" onClick={saveEditCard} title="Save">✓ Save</button>
                        <button className="btn-edit-cancel" onClick={cancelEditCard} title="Cancel">✕ Cancel</button>
                      </div>
                    ) : deleteConfirmId === record.id ? (
                      <div className="delete-confirm">
                        <span>Delete?</span>
                        <button className="btn-delete-yes" onClick={() => handleDelete(record.id)}>Yes</button>
                        <button className="btn-delete-no" onClick={() => setDeleteConfirmId(null)}>No</button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="btn-icon"
                          onClick={() => startEditCard(record)}
                          aria-label={`Edit ${record.commonName}`}
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => setDeleteConfirmId(record.id)}
                          aria-label={`Delete ${record.commonName}`}
                          title="Delete"
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Row 2: Key details grid */}
                <div className="cert-card-details">
                  <div className="cert-detail">
                    <span className="cert-detail-label">Valid From</span>
                    <span className="cert-detail-value">{formatDate(record.validFrom)}</span>
                  </div>
                  <div className="cert-detail">
                    <span className="cert-detail-label">Expires On</span>
                    <span className="cert-detail-value cert-detail-expires">{formatDate(record.expiresOn)}</span>
                    <span className={`cert-days-badge days-${statusClass}`}>
                      {notFetched ? 'N/A' : record.daysUntilExpiry <= 0 ? 'Expired' : `${record.daysUntilExpiry} days left`}
                    </span>
                  </div>
                  <div className="cert-detail">
                    <span className="cert-detail-label">Issuer</span>
                    <span className="cert-detail-value">{record.issuer || '—'}</span>
                  </div>
                  {record.scanError && (
                    <div className="cert-detail">
                      <span className="cert-detail-label">Scan Error</span>
                      <span className="cert-detail-value" style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{record.scanError}</span>
                    </div>
                  )}
                  <div className="cert-detail">
                    <span className="cert-detail-label">Customer Details</span>
                    {isEditing ? (
                      <>
                        <input className="inline-edit-input" value={editDraft.customerPocName ?? ''} onChange={(e) => updateDraft('customerPocName', e.target.value)} placeholder="POC name" />
                        <input className="inline-edit-input" value={editDraft.customerPocEmail ?? ''} onChange={(e) => updateDraft('customerPocEmail', e.target.value)} placeholder="POC email" />
                        <input className="inline-edit-input" value={editDraft.customerPocPhone ?? ''} onChange={(e) => updateDraft('customerPocPhone', e.target.value)} placeholder="POC phone" />
                      </>
                    ) : (
                      <>
                        <span className={`cert-detail-value${!record.customerPocName ? ' cert-nil' : ''}`}>{record.customerPocName || 'Add contact name'}</span>
                        {record.customerPocEmail ? <span className="cert-detail-sub">{record.customerPocEmail}</span> : <span className="cert-detail-sub cert-nil">Add email</span>}
                        {record.customerPocPhone ? <span className="cert-detail-sub">{record.customerPocPhone}</span> : <span className="cert-detail-sub cert-nil">Add phone</span>}
                      </>
                    )}
                  </div>
                  <div className="cert-detail">
                    <span className="cert-detail-label">Remark</span>
                    {isEditing ? (
                      <textarea className="inline-edit-textarea" value={editDraft.notes ?? ''} onChange={(e) => updateDraft('notes', e.target.value)} placeholder="Notes" rows={2} />
                    ) : (
                      <span className={`cert-detail-value${!record.notes ? ' cert-nil' : ''}`}>{record.notes || 'Add a remark'}</span>
                    )}
                  </div>
                </div>

                {/* Tags */}
                {record.tags.length > 0 && (
                <div className="cert-card-footer">
                  {record.tags.length > 0 && (
                    <div className="tag-row">
                      {record.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </article>
            );
          })}

          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <strong>No matching certificates found.</strong>
              <p>Try adjusting your search or filter criteria.</p>
            </div>
          ) : null}
        </section>

      {showImport && (
        <ImportModal onImport={handleImport} onClose={() => setShowImport(false)} />
      )}

      {showAddDomain && (
        <AddDomainModal onAdd={handleAddDomain} onClose={() => setShowAddDomain(false)} />
      )}
    </>
  );
}

export default App;