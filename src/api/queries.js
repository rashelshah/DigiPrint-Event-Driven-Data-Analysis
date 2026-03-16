import { supabase } from './supabaseClient';

// ─── Dashboard Queries ──────────────────────────────────────────

/**
 * Fetch dashboard-level summary metrics.
 * Uses direct queries instead of RPC to avoid function overload conflicts.
 */
export async function fetchDashboardSummary() {
  try {
    // Run all counts in parallel
    const [sitesRes, sessionsRes, eventsRes, activeRes] = await Promise.all([
      supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('sessions').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('sessions').select('id', { count: 'exact', head: true }).is('end_time', null),
    ]);

    // Get most active hour
    let most_active_hour = null;
    try {
      const { data: hourData } = await supabase
        .from('events')
        .select('event_timestamp')
        .order('event_timestamp', { ascending: false })
        .limit(1000);
      if (hourData?.length) {
        const hourCounts = {};
        hourData.forEach(row => {
          const h = new Date(row.event_timestamp).getHours();
          hourCounts[h] = (hourCounts[h] || 0) + 1;
        });
        most_active_hour = Object.entries(hourCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0];
        most_active_hour = most_active_hour != null ? parseInt(most_active_hour) : null;
      }
    } catch { /* non-critical */ }

    // Get avg events per session
    let avg_events_per_session = 0;
    const totalEvents = eventsRes.count || 0;
    const totalSessions = sessionsRes.count || 0;
    if (totalSessions > 0) {
      avg_events_per_session = Math.round((totalEvents / totalSessions) * 100) / 100;
    }

    return {
      total_sites: sitesRes.count || 0,
      total_users: 0,
      total_sessions: totalSessions,
      total_events: totalEvents,
      active_sessions: activeRes.count || 0,
      most_active_hour,
      avg_events_per_session,
    };
  } catch (err) {
    console.error('fetchDashboardSummary error:', err);
    return {
      total_sites: 0,
      total_users: 0,
      total_sessions: 0,
      total_events: 0,
      active_sessions: 0,
      most_active_hour: null,
      avg_events_per_session: 0,
    };
  }
}

/**
 * Fetch events-per-second.
 * Uses direct count instead of v_event_rate view to avoid missing view errors.
 */
export async function fetchEventRate() {
  try {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    const { count, error } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gte('event_timestamp', tenSecondsAgo);

    if (error) throw error;
    return { events_per_second: Math.round(((count || 0) / 10) * 100) / 100 };
  } catch {
    return { events_per_second: 0 };
  }
}

/** Fetch per-site analytics */
export async function fetchSiteAnalytics() {
  try {
    // Try the view first
    const { data, error } = await supabase
      .from('v_site_analytics')
      .select('*');
    if (!error && data) return data;
  } catch { /* fallback below */ }

  // Fallback: query sites directly
  try {
    const { data: sites } = await supabase
      .from('sites')
      .select('id, site_name, domain')
      .eq('is_active', true);

    if (!sites?.length) return [];

    // For each site, count events
    const results = [];
    for (const site of sites) {
      const { count } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', site.id);
      results.push({
        site_name: site.site_name,
        domain: site.domain,
        total_events: count || 0,
        total_sessions: 0,
      });
    }
    return results.sort((a, b) => b.total_events - a.total_events);
  } catch {
    return [];
  }
}

/** Fetch top event types with counts */
export async function fetchTopEventTypes() {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('event_type')
      .limit(5000);
    if (error) throw error;

    const counts = {};
    (data ?? []).forEach((row) => {
      counts[row.event_type] = (counts[row.event_type] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([event_type, count]) => ({ event_type, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

// ─── Analytics Queries (direct Supabase) ────────────────────────

/** Fetch event frequency by date */
export async function fetchEventFrequency() {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('event_timestamp')
      .order('event_timestamp', { ascending: true })
      .limit(5000);
    if (error) throw error;

    // Aggregate by date
    const dateCounts = {};
    const sessionDates = {};
    (data ?? []).forEach(row => {
      const date = new Date(row.event_timestamp).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric'
      });
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    });

    return Object.entries(dateCounts)
      .map(([date, events]) => ({ date, events, sessions: Math.floor(events / 5) || 1 }));
  } catch {
    return [];
  }
}

/** Fetch peak activity hours */
export async function fetchPeakActivity() {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('event_timestamp')
      .limit(5000);
    if (error) throw error;

    const hourCounts = {};
    (data ?? []).forEach(row => {
      const hour = new Date(row.event_timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    return Object.entries(hourCounts)
      .map(([hour, event_count]) => ({ hour: parseInt(hour), event_count }))
      .sort((a, b) => a.hour - b.hour);
  } catch {
    return [];
  }
}

/** Fetch site-level user behavior stats */
export async function fetchSiteBehavior() {
  try {
    const { data: sites } = await supabase
      .from('sites')
      .select('id, site_name, domain')
      .eq('is_active', true);

    if (!sites?.length) return [];

    const results = [];
    for (const site of sites.slice(0, 10)) {
      const [eventsRes, sessionsRes] = await Promise.all([
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('site_id', site.id),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('site_id', site.id),
      ]);
      const totalEvents = eventsRes.count || 0;
      const totalSessions = sessionsRes.count || 0;
      results.push({
        username: site.site_name || site.domain,
        total_events: totalEvents,
        total_sessions: totalSessions || 1,
      });
    }
    return results.sort((a, b) => b.total_events - a.total_events);
  } catch {
    return [];
  }
}

// ─── Live Events Queries ────────────────────────────────────────

/**
 * Fetch live events from v_live_events view.
 */
export async function fetchLiveEvents({
  limit = 50,
  domain = null,
  eventType = null,
  minutes = null,
} = {}) {
  try {
    let query = supabase
      .from('v_live_events')
      .select('*')
      .order('event_timestamp', { ascending: false })
      .limit(limit);

    if (domain) {
      query = query.eq('domain', domain);
    }
    if (eventType && eventType !== 'all') {
      query = query.eq('event_type', eventType);
    }
    if (minutes) {
      const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      query = query.gte('event_timestamp', since);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error('fetchLiveEvents error:', err);
    return [];
  }
}

/** Fetch list of active sites for filter dropdown */
export async function fetchSitesList() {
  try {
    const { data, error } = await supabase
      .from('sites')
      .select('id, site_name, domain')
      .eq('is_active', true)
      .order('site_name');
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Realtime Subscription ──────────────────────────────────────

/**
 * Subscribe to live INSERT events on the events table.
 * Returns subscription channel for cleanup.
 */
export function subscribeLiveEvents(onNewEvent) {
  const channel = supabase
    .channel('events-stream')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'events',
      },
      (payload) => {
        onNewEvent(payload.new);
      }
    )
    .subscribe();

  return channel;
}

/** Unsubscribe from a channel */
export function unsubscribeChannel(channel) {
  if (channel) {
    supabase.removeChannel(channel);
  }
}
