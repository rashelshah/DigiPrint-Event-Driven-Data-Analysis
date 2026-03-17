import { motion } from 'framer-motion';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { pageVariants } from '../utils/animations';
import GlassCard from '../components/ui/GlassCard';
import {
  fetchUserSites,
  fetchOverviewMetrics,
  fetchEventDistribution,
  fetchEventsOverTime,
  fetchTopPages,
  fetchScrollDepth,
  fetchDeviceAnalytics,
  fetchFunnelData,
  fetchRecentActivitySummary,
  fetchLiveEvents,
  exportRowsAsCsv,
} from '../api/queries';

const RANGE_OPTIONS = [
  { label: 'Last 1h', value: '1h', minutes: 60 },
  { label: 'Last 24h', value: '24h', minutes: 1440 },
  { label: 'Last 7d', value: '7d', minutes: 10080 },
];

const PIE_COLORS = ['#22d3ee', '#60a5fa', '#34d399', '#f59e0b', '#f97316', '#ef4444', '#a78bfa'];

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatStep(step) {
  return step.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function toLocalTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SkeletonBlock = ({ className = '' }) => (
  <div className={`animate-pulse bg-white/5 rounded-lg ${className}`} />
);

const UserAnalytics = () => {
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState('all');
  const [range, setRange] = useState('24h');
  const [search, setSearch] = useState('');

  const [overview, setOverview] = useState(null);
  const [eventDistribution, setEventDistribution] = useState([]);
  const [eventsOverTime, setEventsOverTime] = useState([]);
  const [topPages, setTopPages] = useState([]);
  const [scrollDepth, setScrollDepth] = useState([]);
  const [deviceAnalytics, setDeviceAnalytics] = useState({ browsers: [], screens: [] });
  const [funnel, setFunnel] = useState([]);
  const [recentSummary, setRecentSummary] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const activeSiteIds = useMemo(() => {
    if (selectedSite !== 'all') {
      const matched = sites.find((site) => String(site.id) === String(selectedSite));
      return matched ? [matched.id] : [];
    }
    return sites.map((site) => site.id);
  }, [sites, selectedSite]);

  const loadSites = useCallback(async () => {
    const data = await fetchUserSites();
    setSites(data || []);
  }, []);

  const loadAnalytics = useCallback(async ({ silent = false } = {}) => {
    if (!activeSiteIds.length) {
      setOverview({
        total_events: 0,
        sessions: 0,
        active_users: 0,
        avg_session_duration: 0,
      });
      setEventDistribution([]);
      setEventsOverTime([]);
      setTopPages([]);
      setScrollDepth([]);
      setDeviceAnalytics({ browsers: [], screens: [] });
      setFunnel([]);
      setRecentSummary([]);
      setLoading(false);
      return;
    }

    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const [
        overviewData,
        distributionData,
        overTimeData,
        pagesData,
        scrollData,
        deviceData,
        funnelData,
        recentData,
      ] = await Promise.all([
        fetchOverviewMetrics(activeSiteIds, range),
        fetchEventDistribution(activeSiteIds, range),
        fetchEventsOverTime(activeSiteIds, range),
        fetchTopPages(activeSiteIds, range),
        fetchScrollDepth(activeSiteIds, range),
        fetchDeviceAnalytics(activeSiteIds, range),
        fetchFunnelData(activeSiteIds, range),
        fetchRecentActivitySummary(activeSiteIds, range, 20, search),
      ]);

      setOverview(overviewData);
      setEventDistribution(distributionData);
      setEventsOverTime(overTimeData);
      setTopPages(pagesData);
      setScrollDepth(scrollData);
      setDeviceAnalytics(deviceData);
      setFunnel(funnelData);
      setRecentSummary(recentData);
      setError(null);
    } catch (err) {
      console.error('User analytics load error:', err);
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeSiteIds, range, search]);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    if (!activeSiteIds.length) return undefined;
    const timer = setInterval(() => {
      void loadAnalytics({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [activeSiteIds, loadAnalytics]);

  const handleExport = async () => {
    if (!activeSiteIds.length) return;
    setExporting(true);
    try {
      const selectedRange = RANGE_OPTIONS.find((r) => r.value === range) || RANGE_OPTIONS[1];
      const rows = await fetchLiveEvents({
        siteIds: activeSiteIds,
        minutes: selectedRange.minutes,
        eventType: 'all',
        limit: 1000,
        search,
      });

      const exportRows = rows.map((row) => ({
        event_timestamp: row.event_timestamp,
        event_type: row.event_type,
        site_name: row.site_name,
        domain: row.domain,
        session_id: row.session_id,
        page: row.metadata?.page || '',
        title: row.metadata?.title || '',
        referrer: row.metadata?.referrer || '',
        browser: row.metadata?.browser || '',
        os: row.metadata?.os || '',
      }));

      exportRowsAsCsv(
        exportRows,
        `digiprint-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err) {
      console.error('CSV export failed:', err);
      setError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const filteredRecentSummary = useMemo(() => {
    if (!search.trim()) return recentSummary;
    const term = search.toLowerCase();
    return recentSummary.filter((item) => {
      return (
        String(item.event_type || '').toLowerCase().includes(term) ||
        String(item.site_name || '').toLowerCase().includes(term) ||
        String(item.domain || '').toLowerCase().includes(term)
      );
    });
  }, [recentSummary, search]);

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen py-8"
    >
      <div className="container mx-auto px-6 space-y-6">
        <div className="flex flex-col xl:flex-row xl:items-end gap-4 justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Analytics</h1>
            <p className="text-muted-foreground">
              Production dashboard for traffic, behavior funnels, devices, and live activity insights.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="all">All Sites</option>
              {sites.map((site) => (
                <option key={site.id} value={String(site.id)}>
                  {site.site_name}
                  {site.domain ? ` (${site.domain})` : ''}
                </option>
              ))}
            </select>

            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setRange(option.value)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                  range === option.value
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'bg-muted border-transparent text-muted-foreground hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events/sites"
              className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50"
            />

            <button
              onClick={handleExport}
              disabled={exporting || !activeSiteIds.length}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 hover:bg-cyan-500/30 transition-all disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-2 text-green-400">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            {refreshing ? 'Refreshing analytics...' : 'Live auto-refresh every 15s'}
          </span>
          {error && (
            <span className="text-red-400">Error: {error}</span>
          )}
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {loading ? (
            <>
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
            </>
          ) : (
            <>
              <GlassCard className="p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Events</p>
                <p className="text-3xl font-bold text-cyan-300 mt-2">{overview?.total_events ?? 0}</p>
              </GlassCard>
              <GlassCard className="p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Sessions</p>
                <p className="text-3xl font-bold text-emerald-300 mt-2">{overview?.sessions ?? 0}</p>
              </GlassCard>
              <GlassCard className="p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Users</p>
                <p className="text-3xl font-bold text-indigo-300 mt-2">{overview?.active_users ?? 0}</p>
              </GlassCard>
              <GlassCard className="p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Session Duration</p>
                <p className="text-3xl font-bold text-amber-300 mt-2">{formatDuration(overview?.avg_session_duration)}</p>
              </GlassCard>
            </>
          )}
        </div>

        <div className="grid xl:grid-cols-3 gap-6">
          <GlassCard className="p-5 xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Events Over Time</h3>
              <span className="text-xs text-muted-foreground">{RANGE_OPTIONS.find((r) => r.value === range)?.label}</span>
            </div>
            {loading ? (
              <SkeletonBlock className="h-72" />
            ) : eventsOverTime.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={eventsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#22d3ee"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-72 flex items-center justify-center text-muted-foreground">No time-series data yet.</div>
            )}
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="text-xl font-semibold mb-4">Event Breakdown</h3>
            {loading ? (
              <SkeletonBlock className="h-72" />
            ) : eventDistribution.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={eventDistribution.slice(0, 8)} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" stroke="#94a3b8" />
                  <YAxis
                    type="category"
                    dataKey="event_type"
                    stroke="#94a3b8"
                    width={95}
                    tickFormatter={(v) => String(v).replace(/_/g, ' ')}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                  />
                  <Bar dataKey="count" fill="#60a5fa" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-72 flex items-center justify-center text-muted-foreground">No distribution data yet.</div>
            )}
          </GlassCard>
        </div>

        <div className="grid xl:grid-cols-3 gap-6">
          <GlassCard className="p-5 xl:col-span-2">
            <h3 className="text-xl font-semibold mb-4">User Behavior Funnel</h3>
            {loading ? (
              <SkeletonBlock className="h-64" />
            ) : (
              <div className="space-y-3">
                {(funnel || []).map((step, idx) => {
                  const base = funnel[0]?.count || 1;
                  const width = Math.max(8, Math.round((step.count / base) * 100));
                  return (
                    <div key={step.step} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground font-medium">{idx + 1}. {formatStep(step.step)}</span>
                        <span className="text-muted-foreground">
                          {step.count} users
                          {idx > 0 ? ` • ${step.dropoff}% drop-off` : ''}
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-cyan-400 to-blue-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${width}%` }}
                          transition={{ duration: 0.5, delay: idx * 0.08 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="text-xl font-semibold mb-4">Scroll Depth</h3>
            {loading ? (
              <SkeletonBlock className="h-64" />
            ) : (
              <div className="space-y-3">
                {(scrollDepth || []).map((row) => (
                  <div key={row.milestone}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-foreground">{row.milestone}%</span>
                      <span className="text-muted-foreground">{row.percentage}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${row.percentage}%` }}
                        transition={{ duration: 0.45 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        <div className="grid xl:grid-cols-2 gap-6">
          <GlassCard className="p-5">
            <h3 className="text-xl font-semibold mb-4">Top Pages</h3>
            {loading ? (
              <SkeletonBlock className="h-64" />
            ) : topPages.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-2">Page</th>
                      <th className="py-2 text-right">Visits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {topPages.map((row) => (
                      <tr key={row.page} className="hover:bg-white/[.04]">
                        <td className="py-2 pr-2 font-mono text-xs text-foreground">{row.page}</td>
                        <td className="py-2 text-right text-cyan-300">{row.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">No page-view data yet.</div>
            )}
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="text-xl font-semibold mb-4">Device Analytics</h3>
            {loading ? (
              <SkeletonBlock className="h-64" />
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="h-64">
                  {deviceAnalytics.browsers?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={deviceAnalytics.browsers}
                          dataKey="count"
                          nameKey="browser"
                          outerRadius={85}
                          innerRadius={45}
                          paddingAngle={2}
                        >
                          {deviceAnalytics.browsers.map((entry, idx) => (
                            <Cell key={entry.browser} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No browser data yet.</div>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Top screen sizes</p>
                  <div className="space-y-2 max-h-56 overflow-auto pr-1">
                    {(deviceAnalytics.screens || []).slice(0, 8).map((row) => (
                      <div key={row.screen} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-white/[.03]">
                        <span className="font-mono text-xs">{row.screen}</span>
                        <span className="text-cyan-300">{row.count}</span>
                      </div>
                    ))}
                    {!deviceAnalytics.screens?.length && (
                      <div className="text-muted-foreground text-sm">No screen data yet.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </GlassCard>
        </div>

        <GlassCard className="p-5">
          <h3 className="text-xl font-semibold mb-4">Recent Activity Feed (Summarized)</h3>
          {loading ? (
            <SkeletonBlock className="h-56" />
          ) : filteredRecentSummary.length ? (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredRecentSummary.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-border bg-white/[.03] p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-foreground">{formatStep(item.event_type)}</p>
                    <span className="text-xs text-cyan-300">{item.count}x</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.site_name || 'Unknown Site'}
                    {item.domain ? ` • ${item.domain}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Last seen: {toLocalTime(item.last_seen)}</p>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="h-56 flex items-center justify-center text-muted-foreground">
              No recent activity matches your filters.
            </div>
          )}
        </GlassCard>
      </div>
    </motion.div>
  );
};

export default UserAnalytics;
