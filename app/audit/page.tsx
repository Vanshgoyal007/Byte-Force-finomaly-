'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getDemoUserId } from '@/lib/apiClient';
import Footer from '@/components/Footer';

export interface AuditRecord {
  id: string;
  user_id: string;
  score: number;
  band: string;
  features?: {
    liveVector?: number[];
    baselineVector?: number[];
  };
  flags?: {
    pasteDetected?: boolean;
    botSuspected?: boolean;
  };
  created_at: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [bandFilter, setBandFilter] = useState<'all' | 'match' | 'rushed' | 'anomaly'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Scope filter: 'all' (default, displays all demo audit logs) vs 'mine' (only current browser session)
  const [scope, setScope] = useState<'all' | 'mine'>('all');

  const fetchAuditLogs = useCallback(async (currentScope = scope) => {
    setLoading(true);
    setError(null);

    try {
      const currentId = getDemoUserId();
      const queryUser = currentScope === 'mine' ? currentId : 'all';

      const res = await fetch(`/api/audit?userId=${encodeURIComponent(queryUser)}`, {
        headers: {
          'x-finomaly-client': 'web',
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load audit logs';
      setError(msg);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    const currentId = getDemoUserId();
    setUserId(currentId);
    fetchAuditLogs('all');
  }, []);

  // Format time (local + relative)
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const local = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      let relative = '';
      if (diffMins < 1) relative = 'just now';
      else if (diffMins < 60) relative = `${diffMins}m ago`;
      else {
        const diffHours = Math.floor(diffMins / 60);
        relative = `${diffHours}h ago`;
      }
      return { local, relative };
    } catch {
      return { local: '—', relative: '—' };
    }
  };

  // Filtered and sorted logs
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // Filter by band
    if (bandFilter !== 'all') {
      result = result.filter((r) => r.band?.toLowerCase() === bandFilter);
    }

    // Search query (matches ID, user_id, band)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.id?.toLowerCase().includes(q) ||
          r.user_id?.toLowerCase().includes(q) ||
          r.band?.toLowerCase().includes(q)
      );
    }

    // Sort by timestamp
    result.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

    return result;
  }, [logs, bandFilter, searchQuery, sortOrder]);

  // Paginated records
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const renderBandChip = (band: string) => {
    const b = band?.toLowerCase();
    if (b === 'match') {
      return <span className="chip chip-success">Match</span>;
    }
    if (b === 'rushed') {
      return <span className="chip chip-warning">Rushed</span>;
    }
    return <span className="chip chip-danger">Anomaly</span>;
  };

  return (
    <>
      <main id="main-content" className="container audit-main" style={{ paddingTop: '40px', paddingBottom: '72px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <div>
            <span className="small text-muted" style={{ display: 'block', marginBottom: '6px' }}>
              Operations & compliance
            </span>
            <h1 style={{ marginBottom: '6px' }}>Audit log</h1>
            <p className="body-text text-muted">
              Live telemetry records captured from demo and challenge verification sessions.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '3px' }}>
              <button
                type="button"
                className={`btn small ${scope === 'all' ? 'btn-primary' : 'btn-text'}`}
                style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '4px' }}
                onClick={() => {
                  setScope('all');
                  fetchAuditLogs('all');
                }}
              >
                All sessions
              </button>
              <button
                type="button"
                className={`btn small ${scope === 'mine' ? 'btn-primary' : 'btn-text'}`}
                style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '4px' }}
                onClick={() => {
                  setScope('mine');
                  fetchAuditLogs('mine');
                }}
              >
                My session only
              </button>
            </div>
            <button
              type="button"
              className="btn btn-secondary small"
              onClick={() => fetchAuditLogs(scope)}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', flex: 1, maxWidth: '600px' }}>
            <input
              type="search"
              placeholder="Search session ID or user..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{ maxWidth: '280px' }}
            />

            <select
              value={bandFilter}
              onChange={(e) => {
                setBandFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              style={{ width: 'auto' }}
            >
              <option value="all">All bands</option>
              <option value="match">Match</option>
              <option value="rushed">Rushed</option>
              <option value="anomaly">Anomaly</option>
            </select>

            <button
              type="button"
              className="btn btn-secondary small"
              onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            >
              Time: {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
            </button>
          </div>

          <div className="small text-muted num-tabular">
            {filteredLogs.length} {filteredLogs.length === 1 ? 'record' : 'records'} found
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div style={{ background: 'var(--danger-light)', border: '1px solid #654139', color: 'var(--danger)', padding: '12px 16px', borderRadius: '4px', marginBottom: '16px', fontSize: '0.875rem' }}>
            Could not fetch audit records: {error}. Check backend connection or try refreshing.
          </div>
        )}

        {/* Main Content Layout (Table + Side Panel) */}
        <div style={{ display: 'grid', gridTemplateColumns: selectedRecord ? '1fr 340px' : '1fr', gap: '20px', alignItems: 'start' }}>
          {/* Operations Table */}
          <div className="table-wrapper">
            <table className="fin-table">
              <thead>
                <tr>
                  <th style={{ width: '180px' }}>Time</th>
                  <th>Session ID</th>
                  <th>Score</th>
                  <th>Band</th>
                  <th>Flags</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {/* Loading skeleton state */}
                {loading && (
                  <>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={i}>
                        <td><div className="skeleton" style={{ height: '16px', width: '120px' }} /></td>
                        <td><div className="skeleton" style={{ height: '16px', width: '90px' }} /></td>
                        <td><div className="skeleton" style={{ height: '16px', width: '50px' }} /></td>
                        <td><div className="skeleton" style={{ height: '16px', width: '60px' }} /></td>
                        <td><div className="skeleton" style={{ height: '16px', width: '40px' }} /></td>
                        <td><div className="skeleton" style={{ height: '16px', width: '60px' }} /></td>
                      </tr>
                    ))}
                  </>
                )}

                {/* Empty state (No fake sample rows) */}
                {!loading && filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px' }}>
                      <p className="text-muted" style={{ marginBottom: '12px' }}>
                        No attempts yet. Run the demo to create one.
                      </p>
                      <Link href="/demo" className="btn btn-primary small">
                        Go to demo
                      </Link>
                    </td>
                  </tr>
                )}

                {/* Real Log rows */}
                {!loading &&
                  paginatedLogs.map((row) => {
                    const { local, relative } = formatTime(row.created_at);
                    const isSelected = selectedRecord?.id === row.id;
                    const flagsCount = (row.flags?.pasteDetected ? 1 : 0) + (row.flags?.botSuspected ? 1 : 0);
                    const shortId = row.id ? row.id.slice(0, 8) : '—';

                    return (
                      <tr
                        key={row.id}
                        className={`clickable ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedRecord(row)}
                      >
                        <td>
                          <span className="num-tabular" style={{ fontWeight: 500 }}>{local}</span>
                          <span className="small text-muted" style={{ display: 'block' }}>{relative}</span>
                        </td>
                        <td>
                          <span className="mono-id">{shortId}</span>
                        </td>
                        <td>
                          <span className="num-tabular" style={{ fontWeight: 600 }}>
                            {(row.score * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td>{renderBandChip(row.band)}</td>
                        <td>
                          {flagsCount > 0 ? (
                            <span className="chip chip-danger">{flagsCount} flagged</span>
                          ) : (
                            <span className="text-muted small">None</span>
                          )}
                        </td>
                        <td>
                          <span className="small text-muted">
                            {row.user_id?.startsWith('ephemeral') ? 'Demo' : 'API'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Side Panel for Selected Record */}
          {selectedRecord && (
            <div className="panel" style={{ padding: '20px', position: 'sticky', top: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Record details</span>
                <button
                  type="button"
                  className="btn btn-text small"
                  onClick={() => setSelectedRecord(null)}
                  style={{ padding: '0 4px', color: 'var(--text-muted)' }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.8125rem' }}>
                <div>
                  <div className="text-muted small">Session ID</div>
                  <div className="mono-id" style={{ wordBreak: 'break-all' }}>{selectedRecord.id}</div>
                </div>

                <div>
                  <div className="text-muted small">User ID</div>
                  <div className="mono-id">{selectedRecord.user_id}</div>
                </div>

                <div>
                  <div className="text-muted small">Recorded at</div>
                  <div>{new Date(selectedRecord.created_at).toLocaleString()}</div>
                </div>

                <div>
                  <div className="text-muted small">Score & band</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <span style={{ fontWeight: 600, fontSize: '1.1rem' }} className="num-tabular">
                      {(selectedRecord.score * 100).toFixed(1)}%
                    </span>
                    {renderBandChip(selectedRecord.band)}
                  </div>
                </div>

                <div>
                  <div className="text-muted small">Security flags</div>
                  <div style={{ marginTop: '4px' }}>
                    {selectedRecord.flags?.pasteDetected && (
                      <div className="chip chip-danger" style={{ marginBottom: '4px' }}>Paste detected</div>
                    )}
                    {selectedRecord.flags?.botSuspected && (
                      <div className="chip chip-danger">Bot pattern suspected</div>
                    )}
                    {!selectedRecord.flags?.pasteDetected && !selectedRecord.flags?.botSuspected && (
                      <div className="text-muted">No security flags triggered</div>
                    )}
                  </div>
                </div>

                {selectedRecord.features?.liveVector && (
                  <div>
                    <div className="text-muted small" style={{ marginBottom: '6px' }}>5D Feature vector</div>
                    <div style={{ background: 'var(--surface)', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                      [{selectedRecord.features.liveVector.map((v) => Math.round(v)).join(', ')}]
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pagination bar */}
        {filteredLogs.length > pageSize && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
            <span className="small text-muted num-tabular">
              Page {currentPage} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary small"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary small"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
