import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback } from 'react';
import { pageVariants } from '../utils/animations';
import GlassCard from '../components/ui/GlassCard';
import GlowButton from '../components/ui/GlowButton';
import { PLAYGROUND_QUERIES, executePlaygroundQuery, exportRowsAsCsv } from '../api/queries';

// ─── Type badge colours ──────────────────────────────────────────────────────
const TYPE_BADGE = {
  aggregate:    { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: 'Aggregate'    },
  distribution: { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'Distribution' },
  users:        { bg: 'bg-green-500/15',  text: 'text-green-400',  label: 'Users'        },
  timeseries:   { bg: 'bg-cyan-500/15',   text: 'text-cyan-400',   label: 'Time Series'  },
  summary:      { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Summary'      },
  security:     { bg: 'bg-red-500/15',    text: 'text-red-400',    label: 'Security'     },
};

// ─── Format cell value for display ───────────────────────────────────────────
function formatCell(value) {
  if (value === null || value === undefined) return <span className="text-muted-foreground/40 italic">null</span>;
  if (typeof value === 'boolean') return <span className={value ? 'text-green-400' : 'text-red-400'}>{String(value)}</span>;
  if (typeof value === 'object') return <span className="text-purple-400/80">{JSON.stringify(value)}</span>;
  const str = String(value);
  // Highlight UUIDs dimly
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(str)) {
    return <span className="text-muted-foreground/60 font-mono text-[10px]">{str.slice(0, 8)}…</span>;
  }
  return str;
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DataExplorer = () => {
  const [selectedQuery, setSelectedQuery] = useState(null);
  const [results, setResults]             = useState(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [executionMs, setExecutionMs]     = useState(null);
  const [copied, setCopied]               = useState(false);

  const executeQuery = useCallback(async (queryId) => {
    if (!queryId) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setExecutionMs(null);
    setSelectedQuery(queryId);

    try {
      const res = await executePlaygroundQuery(queryId);
      setResults(res.rows);
      setExecutionMs(res.executionMs);
    } catch (err) {
      setError(err?.message || 'Failed to execute query. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Copy results as JSON
  const handleCopyJson = async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // Download results as CSV
  const handleDownloadCsv = () => {
    if (!results?.length) return;
    exportRowsAsCsv(results, `digiprint-${selectedQuery}-${Date.now()}.csv`);
  };

  const selectedMeta = PLAYGROUND_QUERIES.find((q) => q.id === selectedQuery);
  const columns = results?.length ? Object.keys(results[0]) : [];

  // ─── Render helpers ────────────────────────────────────────────────────────
  const renderResultsPanel = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm animate-pulse">Executing query securely on backend…</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-5 bg-red-500/10 border border-red-500/30 rounded-xl flex gap-3 items-start">
          <span className="text-red-400 text-lg mt-0.5">⚠️</span>
          <div>
            <p className="text-red-400 font-medium text-sm mb-1">Query failed</p>
            <p className="text-red-300/70 text-xs font-mono">{error}</p>
          </div>
        </div>
      );
    }

    if (!results) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl">🔍</div>
          <p className="text-sm">Select a query from the left panel to execute it</p>
          <p className="text-xs opacity-60">Execution is isolated to your data & securely controlled by the backend.</p>
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl">📭</div>
          <p className="text-sm">{selectedMeta?.emptyMessage || 'No data found for this query.'}</p>
        </div>
      );
    }

    return (
      <div>
        {/* Stats bar */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 bg-primary/15 text-primary text-xs font-semibold rounded-full">
              {results.length} row{results.length !== 1 ? 's' : ''}
            </span>
            {executionMs !== null && (
              <span className="text-xs text-muted-foreground">
                ⏱ {executionMs}ms
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="px-3 py-1.5 text-xs bg-muted hover:bg-white/10 border border-border rounded-lg transition-all flex items-center gap-1.5"
            >
              {copied ? '✅  Copied' : '📋  Copy JSON'}
            </button>
            <button
              onClick={handleDownloadCsv}
              className="px-3 py-1.5 text-xs bg-muted hover:bg-white/10 border border-border rounded-lg transition-all flex items-center gap-1.5"
            >
              ⬇️  Download CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="text-left py-2.5 px-3 text-muted-foreground font-medium uppercase tracking-wide text-[10px] whitespace-nowrap"
                  >
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {results.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-white/5 hover:bg-white/[0.04] transition-colors"
                >
                  {columns.map((col) => (
                    <td key={col} className="py-2 px-3 max-w-[220px] truncate">
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen py-8"
    >
      <div className="container mx-auto px-6">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Data Explorer</h1>
          <p className="text-muted-foreground">View predefined, read-only analytics securely via the backend API</p>

          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <p className="text-sm text-yellow-400">
              🔒 <strong>Production Data Security:</strong> Queries are executed securely on the backend mapping to whitelisted analytics views. Isolation rules apply seamlessly.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">

          {/* ── Query List ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <GlassCard className="flex-1">
              <h3 className="text-lg font-semibold mb-4">Available Queries</h3>
              <div className="space-y-1.5">
                {PLAYGROUND_QUERIES.map((query) => {
                  const badge = TYPE_BADGE[query.type] || TYPE_BADGE.aggregate;
                  const isActive = selectedQuery === query.id;
                  return (
                    <button
                      key={query.id}
                      onClick={() => executeQuery(query.id)}
                      disabled={loading}
                      className={`w-full text-left p-3 rounded-xl transition-all duration-200 border ${
                        isActive
                          ? 'bg-primary/15 border-primary/40 shadow-sm shadow-primary/10'
                          : 'bg-muted/50 border-transparent hover:bg-white/8 hover:border-white/10'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-medium text-sm leading-tight">{query.name}</div>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{query.description}</div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>
          </div>

          {/* ── Results Panel ──────────────────────────────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <GlassCard>
              {/* Panel header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-semibold">Query Results</h3>
                  {selectedMeta && (
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedMeta.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedQuery && (
                    <GlowButton
                      size="sm"
                      variant="glass"
                      onClick={() => executeQuery(selectedQuery)}
                      disabled={loading}
                      id="rerun-btn"
                    >
                      🔄  Re-run
                    </GlowButton>
                  )}
                </div>
              </div>

              <div className="min-h-[400px]">
                {renderResultsPanel()}
              </div>
            </GlassCard>

            {/* ── Query Info ───────────────────────────────────────────────── */}
            <AnimatePresence>
              {selectedMeta && (
                <motion.div
                  key="info-panel"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                >
                  <GlassCard>
                    <h4 className="font-semibold text-sm text-muted-foreground mb-3">Query Information</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Query ID:</span>
                        <span className="font-mono text-primary text-xs">{selectedMeta.id}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Type:</span>
                        <span className={`text-xs font-semibold ${TYPE_BADGE[selectedMeta.type]?.text ?? 'text-foreground'}`}>
                          {TYPE_BADGE[selectedMeta.type]?.label ?? selectedMeta.type}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Security Layer:</span>
                        <span className="text-green-400 text-xs text-right max-w-[200px]">Backend RPC + Strict Whitelist</span>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
      </div>
    </motion.div>
  );
};

export default DataExplorer;
