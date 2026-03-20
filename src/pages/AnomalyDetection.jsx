import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { pageVariants } from '../utils/animations';
import GlassCard from '../components/ui/GlassCard';
import {
  fetchAnomalies,
  fetchAnomalyTrend,
  fetchUserSites,
} from '../api/queries';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import ReactECharts from 'echarts-for-react';

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG = {
  CRITICAL: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    badge: 'bg-red-500/20 text-red-400',
    dot: 'bg-red-400',
    label: 'Critical',
  },
  HIGH: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500/20 text-amber-400',
    dot: 'bg-amber-400',
    label: 'High',
  },
  MEDIUM: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    badge: 'bg-blue-500/20 text-blue-400',
    dot: 'bg-blue-400',
    label: 'Medium',
  },
  NORMAL: {
    bg: 'bg-white/5',
    border: 'border-white/10',
    badge: 'bg-white/10 text-muted-foreground',
    dot: 'bg-muted-foreground',
    label: 'Normal',
  },
};

// Truncate session UUID for display: "abc...xyz"
function shortId(id = '') {
  if (id.length <= 13) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ title, value, sub, color = 'text-foreground', delay = 0 }) {
  return (
    <motion.div
      className="glass-strong rounded-xl p-5 flex flex-col gap-1 hover:bg-white/10 transition-all duration-300"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -3 }}
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </motion.div>
  );
}

function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.NORMAL;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function AnomalyCard({ anomaly, index }) {
  const cfg = SEVERITY_CONFIG[anomaly.severity] || SEVERITY_CONFIG.NORMAL;
  const deviationLabel = anomaly.deviation >= 0
    ? `+${anomaly.deviation} above average`
    : `${anomaly.deviation} below average`;

  return (
    <motion.div
      className={`rounded-xl border p-4 transition-all duration-200 hover:bg-white/5 ${cfg.bg} ${cfg.border}`}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left — primary info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="font-mono text-xs text-muted-foreground bg-white/5 px-2 py-0.5 rounded">
              {shortId(anomaly.session_id)}
            </span>
            <SeverityBadge severity={anomaly.severity} />
            <span className="text-xs text-muted-foreground truncate">{anomaly.site_name}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Events</p>
              <p className="font-semibold">{anomaly.event_count.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Z-Score</p>
              <p className="font-semibold text-cyan-400">{anomaly.z_score.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Deviation</p>
              <p className={`font-semibold ${anomaly.deviation >= 0 ? 'text-amber-400' : 'text-blue-400'}`}>
                {deviationLabel}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Ratio</p>
              <p className="font-semibold">{anomaly.ratio}x avg</p>
            </div>
          </div>
        </div>
      </div>

      {/* "Why flagged?" explanation */}
      <div className="mt-3 pt-3 border-t border-white/5">
        <p className="text-xs text-muted-foreground">
          This session has{' '}
          <span className="font-medium text-foreground">{anomaly.ratio}x</span>{' '}
          more events than average ({anomaly.mean_events} avg) — flagged at z-score{' '}
          <span className="font-medium text-cyan-400">{anomaly.z_score.toFixed(2)}</span>
        </p>
      </div>
    </motion.div>
  );
}

// ECharts Z-Score Distribution Histogram
function ZScoreDistributionChart({ anomalies }) {
  const buckets = useMemo(() => {
    const b = { '1.5–2.0': 0, '2.0–2.5': 0, '2.5–3.0': 0, '3.0+': 0 };
    anomalies.forEach(({ z_score: z }) => {
      if (z > 3.0) b['3.0+']++;
      else if (z > 2.5) b['2.5–3.0']++;
      else if (z > 2.0) b['2.0–2.5']++;
      else b['1.5–2.0']++;
    });
    return b;
  }, [anomalies]);

  const categories = Object.keys(buckets);
  const values = Object.values(buckets);
  const colors = ['#3b82f6', '#f59e0b', '#ef4444', '#dc2626'];

  const option = {
    backgroundColor: 'transparent',
    grid: { top: 16, right: 12, bottom: 28, left: 36, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'none' },
      backgroundColor: '#1e293b',
      borderColor: '#475569',
      textStyle: { color: '#f8fafc', fontSize: 12 },
      formatter: (params) => {
        const p = params[0];
        return `<b>${p.name}</b><br/>Sessions: <b>${p.value}</b>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 48,
        data: values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: colors[i],
            borderRadius: [4, 4, 0, 0],
            opacity: 0.85,
          },
          emphasis: { itemStyle: { opacity: 1 } },
        })),
      },
    ],
  };

  if (anomalies.length === 0) {
    return (
      <div className="flex items-center justify-center h-56 text-muted-foreground text-sm">
        No anomaly data for distribution
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: '220px', width: '100%' }}
      notMerge
    />
  );
}

// Recharts Trend Line Chart
function AnomalyTrendChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-56 text-muted-foreground text-sm">
        No trend data for selected range
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="label"
          stroke="#475569"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#475569"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #475569',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelStyle={{ color: '#94a3b8' }}
          itemStyle={{ color: '#f8fafc' }}
          formatter={(v) => [v, 'Anomalies']}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ fill: '#ef4444', r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Top Anomalous Sites Table
function TopSitesTable({ anomalies }) {
  const sites = useMemo(() => {
    const map = {};
    anomalies.forEach(({ site_name, z_score, severity }) => {
      if (!map[site_name]) {
        map[site_name] = { site_name, total: 0, zSum: 0, severities: {} };
      }
      map[site_name].total++;
      map[site_name].zSum += z_score;
      map[site_name].severities[severity] = (map[site_name].severities[severity] || 0) + 1;
    });
    return Object.values(map)
      .map((s) => ({ ...s, avgZ: Math.round((s.zSum / s.total) * 100) / 100 }))
      .sort((a, b) => b.avgZ - a.avgZ);
  }, [anomalies]);

  if (sites.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-3 px-3 text-muted-foreground font-medium">Site</th>
            <th className="text-right py-3 px-3 text-muted-foreground font-medium">Anomalies</th>
            <th className="text-right py-3 px-3 text-muted-foreground font-medium">Avg Z-Score</th>
            <th className="text-right py-3 px-3 text-muted-foreground font-medium">Worst</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => {
            const worstSeverity = s.severities.CRITICAL
              ? 'CRITICAL'
              : s.severities.HIGH
                ? 'HIGH'
                : 'MEDIUM';
            const cfg = SEVERITY_CONFIG[worstSeverity];
            return (
              <tr key={s.site_name} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                <td className="py-2.5 px-3 font-medium">{s.site_name}</td>
                <td className="py-2.5 px-3 text-right">{s.total}</td>
                <td className="py-2.5 px-3 text-right text-cyan-400">{s.avgZ.toFixed(2)}</td>
                <td className="py-2.5 px-3 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Skeleton loader
function SkeletonCard() {
  return (
    <div className="glass rounded-xl p-4 animate-pulse space-y-3">
      <div className="flex gap-2">
        <div className="h-4 w-28 bg-white/10 rounded" />
        <div className="h-4 w-16 bg-white/10 rounded" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-3 w-12 bg-white/10 rounded" />
            <div className="h-5 w-10 bg-white/10 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'high_critical', label: 'High + Critical' },
];

function applyFilter(anomalies, filter) {
  if (filter === 'critical') return anomalies.filter((a) => a.severity === 'CRITICAL');
  if (filter === 'high_critical') return anomalies.filter((a) => ['CRITICAL', 'HIGH'].includes(a.severity));
  return anomalies;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const AnomalyDetection = () => {
  const [anomalies, setAnomalies] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState('24h');
  const [minZ, setMinZ] = useState(1.5);
  const [siteIds, setSiteIds] = useState([]);

  const loadData = useCallback(async (ids, zThreshold, trendRange) => {
    setLoading(true);
    try {
      const [rawAnomalies, trend] = await Promise.all([
        fetchAnomalies(ids, zThreshold, 100),
        fetchAnomalyTrend(ids, trendRange, zThreshold),
      ]);
      setAnomalies(rawAnomalies);
      setTrendData(trend);
    } catch (err) {
      console.error('AnomalyDetection load error:', err);
      setAnomalies([]);
      setTrendData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — fetch sites first, then data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sites = await fetchUserSites();
      if (cancelled) return;
      const ids = sites.map((s) => s.id);
      setSiteIds(ids);
      loadData(ids, minZ, range);
    })();
    return () => { cancelled = true; };
  }, []);                    // eslint-disable-line react-hooks/exhaustive-deps  (intentional: run once)

  // Re-fetch when minZ or range changes (after initial load)
  useEffect(() => {
    if (siteIds.length > 0) loadData(siteIds, minZ, range);
  }, [minZ, range, siteIds, loadData]);

  // Derived metrics
  const filtered = useMemo(() => applyFilter(anomalies, filter), [anomalies, filter]);

  const summary = useMemo(() => {
    const criticalCount = anomalies.filter((a) => a.severity === 'CRITICAL').length;
    const highCount = anomalies.filter((a) => a.severity === 'HIGH').length;
    const avgZ = anomalies.length
      ? (anomalies.reduce((s, a) => s + a.z_score, 0) / anomalies.length).toFixed(2)
      : '—';
    return { total: anomalies.length, criticalCount, highCount, avgZ };
  }, [anomalies]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen py-8"
    >
      <div className="container mx-auto px-6 max-w-7xl">

        {/* ── Header ── */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-1">Anomaly Detection</h1>
            <p className="text-muted-foreground text-sm">
              Statistical session analysis using z-score methodology
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Time range selector */}
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="glass text-sm px-3 py-2 rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="1h">Last 1h</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
            </select>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            title="Total Anomalies"
            value={loading ? '—' : summary.total}
            sub="Sessions flagged above threshold"
            delay={0}
          />
          <SummaryCard
            title="Critical"
            value={loading ? '—' : summary.criticalCount}
            sub="Z-score above 2.5"
            color="text-red-400"
            delay={0.05}
          />
          <SummaryCard
            title="High"
            value={loading ? '—' : summary.highCount}
            sub="Z-score above 2.0"
            color="text-amber-400"
            delay={0.1}
          />
          <SummaryCard
            title="Avg Z-Score"
            value={loading ? '—' : summary.avgZ}
            sub="Across flagged sessions"
            color="text-cyan-400"
            delay={0.15}
          />
        </div>

        {/* ── Min Z-Score Slider ── */}
        <GlassCard className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium mb-1">
                Sensitivity Threshold — Min Z-Score:{' '}
                <span className="text-cyan-400 font-semibold">{minZ.toFixed(1)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Lower = more anomalies flagged. Higher = only extreme outliers shown.
              </p>
            </div>
            <div className="flex items-center gap-3 min-w-[220px]">
              <span className="text-xs text-muted-foreground w-7">1.5</span>
              <input
                type="range"
                min={1.5}
                max={3.0}
                step={0.1}
                value={minZ}
                onChange={(e) => setMinZ(parseFloat(e.target.value))}
                className="flex-1 h-1.5 appearance-none rounded-full bg-white/10 accent-cyan-400 cursor-pointer"
              />
              <span className="text-xs text-muted-foreground w-7">3.0</span>
            </div>
          </div>
        </GlassCard>

        {/* ── Charts Row ── */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <GlassCard>
            <h2 className="text-lg font-semibold mb-1">Z-Score Distribution</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Sessions bucketed by deviation severity
            </p>
            <ZScoreDistributionChart anomalies={anomalies} />
          </GlassCard>

          <GlassCard>
            <h2 className="text-lg font-semibold mb-1">Anomaly Trend</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Count of anomalous sessions over time
            </p>
            <AnomalyTrendChart data={trendData} />
          </GlassCard>
        </div>

        {/* ── Anomaly List ── */}
        <GlassCard className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-lg font-semibold">Flagged Sessions</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sorted by highest z-score first
              </p>
            </div>
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 glass rounded-lg p-1">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setFilter(opt.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                    filter === opt.key
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-base font-semibold mb-1">No anomalies detected</h3>
              <p className="text-sm text-muted-foreground">
                {anomalies.length > 0
                  ? 'None match the selected filter. Try "All" to see all flagged sessions.'
                  : `All sessions look normal for the selected range and z-score threshold (${minZ.toFixed(1)}).`}
              </p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={filter}
                className="space-y-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {filtered.map((anomaly, index) => (
                  <AnomalyCard key={anomaly.session_id} anomaly={anomaly} index={index} />
                ))}
              </motion.div>
            </AnimatePresence>
          )}
        </GlassCard>

        {/* ── Top Anomalous Sites ── */}
        {!loading && anomalies.length > 0 && (
          <GlassCard>
            <h2 className="text-lg font-semibold mb-1">Top Anomalous Sites</h2>
            <p className="text-xs text-muted-foreground mb-4">Ranked by average z-score</p>
            <TopSitesTable anomalies={anomalies} />
          </GlassCard>
        )}
      </div>
    </motion.div>
  );
};

export default AnomalyDetection;
