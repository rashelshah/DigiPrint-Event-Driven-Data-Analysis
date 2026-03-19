import { motion } from 'framer-motion';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { pageVariants } from '../utils/animations';
import GlassCard from '../components/ui/GlassCard';
import SiteFilter from '../components/livestream/SiteFilter';
import LiveEventFeed from '../components/livestream/LiveEventFeed';
import EventDetailsModal from '../components/livestream/EventDetailsModal';
import EventCounter from '../components/livestream/EventCounter';
import TrackingScriptGenerator from '../components/livestream/TrackingScriptGenerator';
import {
  fetchLiveEvents,
  fetchUserSites,
  fetchEventRate,
  fetchNewEvents,
  subscribeLiveEvents,
  unsubscribeChannel,
} from '../api/queries';

const LIVE_LIMIT = 100;
const POLL_INTERVAL_MS = 2000;

function getIndiaNowIso() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const map = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+05:30`;
}

const LiveTracking = () => {
  const [trackedSite, setTrackedSite] = useState(null);
  const [siteFilter, setSiteFilter] = useState(null);
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [timeRange, setTimeRange] = useState(null);

  const [events, setEvents] = useState([]);
  const [sites, setSites] = useState([]);
  const [eventRate, setEventRate] = useState(0);
  const [highlightIds, setHighlightIds] = useState(new Set());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(() => {
    return localStorage.getItem("live_paused") === "true";
  });
  const [error, setError] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('IDLE');
  const [pollingHealthy, setPollingHealthy] = useState(true);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const newState = !prev;
      localStorage.setItem("live_paused", String(newState));
      return newState;
    });
  }, []);

  const channelRef = useRef(null);
  const pollTimerRef = useRef(null);
  const highlightTimerRef = useRef({});
  const eventIdSetRef = useRef(new Set());
  const lastTimestampRef = useRef(new Date().toISOString());
  const lastTimestampIndiaRef = useRef(getIndiaNowIso());

  const allSiteIds = useMemo(
    () => sites.map((site) => site.id),
    [sites]
  );

  const activeSiteIds = useMemo(() => {
    if (trackedSite?.id != null) return [trackedSite.id];
    if (siteFilter != null && siteFilter !== '') {
      const matched = sites.find((site) => String(site.id) === String(siteFilter));
      return matched ? [matched.id] : [siteFilter];
    }
    return allSiteIds;
  }, [trackedSite, siteFilter, allSiteIds, sites]);

  const isWithinRange = useCallback(
    (timestamp) => {
      if (!timeRange || !timestamp) return true;
      const cutoff = Date.now() - timeRange * 60 * 1000;
      const tsStr = typeof timestamp === 'string' && !timestamp.endsWith('Z') && !timestamp.includes('+') ? timestamp + 'Z' : timestamp;
      return new Date(tsStr).getTime() >= cutoff;
    },
    [timeRange]
  );

  const eventMatchesCurrentFilters = useCallback(
    (event) => {
      if (!event) return false;
      if (eventTypeFilter !== 'all' && event.event_type !== eventTypeFilter) return false;
      const time = event.metadata?.client_timestamp || event.event_timestamp;
      if (!isWithinRange(time)) return false;
      return true;
    },
    [eventTypeFilter, isWithinRange]
  );

  const mergeIncomingEvents = useCallback((incoming) => {
    if (!incoming?.length) return;

    const filtered = incoming.filter(eventMatchesCurrentFilters);
    if (!filtered.length) return;

    const newIds = [];
    filtered.forEach((row) => {
      const id = row.event_id || row.id;
      if (id != null && !eventIdSetRef.current.has(id)) {
        newIds.push(id);
      }
    });

    setEvents((prev) => {
      const merged = [...filtered, ...prev];
      const deduped = [];
      const seen = new Set();

      merged.forEach((row) => {
        const time = row.metadata?.client_timestamp || row.event_timestamp;
        const key = row.event_id || row.id || `${row.session_id}-${time}-${row.event_type}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(row);
      });

      deduped.sort((a, b) => {
        const timeA = a.metadata?.client_timestamp || a.event_timestamp;
        const timeB = b.metadata?.client_timestamp || b.event_timestamp;
        const dateA = typeof timeA === 'string' && !timeA.endsWith('Z') && !timeA.includes('+') ? new Date(timeA + 'Z') : new Date(timeA);
        const dateB = typeof timeB === 'string' && !timeB.endsWith('Z') && !timeB.includes('+') ? new Date(timeB + 'Z') : new Date(timeB);
        return dateB - dateA;
      });
      const trimmed = deduped.slice(0, LIVE_LIMIT);

      eventIdSetRef.current = new Set(trimmed.map((row) => row.event_id || row.id).filter(Boolean));
      const newest = trimmed[0]?.metadata?.client_timestamp || trimmed[0]?.event_timestamp;
      if (newest) {
        lastTimestampRef.current = newest;
        const newestStr = typeof newest === 'string' && !newest.endsWith('Z') && !newest.includes('+') ? newest + 'Z' : newest;
        lastTimestampIndiaRef.current = new Date(newestStr).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' });
      }
      return trimmed;
    });

    if (newIds.length) {
      setHighlightIds((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.add(id));
        return next;
      });

      newIds.forEach((id) => {
        if (highlightTimerRef.current[id]) {
          clearTimeout(highlightTimerRef.current[id]);
        }
        highlightTimerRef.current[id] = setTimeout(() => {
          setHighlightIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          delete highlightTimerRef.current[id];
        }, 2200);
      });
    }
  }, [eventMatchesCurrentFilters]);

  const refreshSites = useCallback(async () => {
    const data = await fetchUserSites();
    setSites(data);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!activeSiteIds.length) {
      setEvents([]);
      eventIdSetRef.current = new Set();
      lastTimestampRef.current = new Date().toISOString();
      lastTimestampIndiaRef.current = getIndiaNowIso();
      setLoading(false);
      return;
    }

    try {
      const data = await fetchLiveEvents({
        limit: LIVE_LIMIT,
        siteIds: activeSiteIds,
        eventType: eventTypeFilter,
        minutes: timeRange,
      });

      setEvents(data);
      eventIdSetRef.current = new Set(data.map((row) => row.event_id || row.id).filter(Boolean));
      const newest = data[0]?.metadata?.client_timestamp || data[0]?.event_timestamp;
      lastTimestampRef.current = newest || new Date().toISOString();
      const newestStr = typeof newest === 'string' && !newest.endsWith('Z') && !newest.includes('+') ? newest + 'Z' : newest;
      lastTimestampIndiaRef.current = newest
        ? new Date(newestStr).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })
        : getIndiaNowIso();
      setError(null);
    } catch (err) {
      console.error('Failed to load events:', err);
      setError(err.message || 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  }, [activeSiteIds, eventTypeFilter, timeRange]);

  useEffect(() => {
    refreshSites();
  }, [refreshSites]);

  useEffect(() => {
    setLoading(true);
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const loadRate = async () => {
      try {
        const data = await fetchEventRate();
        setEventRate(data?.events_per_second ?? 0);
      } catch {
        // non-critical
      }
    };
    void loadRate();
    const interval = setInterval(loadRate, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isPaused || !activeSiteIds.length) {
      setRealtimeStatus(isPaused ? 'PAUSED' : 'NO_SITES');
      return undefined;
    }

    const channel = subscribeLiveEvents({
      siteIds: activeSiteIds,
      onStatusChange: setRealtimeStatus,
      onNewEvent: (newEvent) => {
        mergeIncomingEvents([newEvent]);
      },
    });

    channelRef.current = channel;
    return () => {
      unsubscribeChannel(channel);
    };
  }, [isPaused, activeSiteIds, mergeIncomingEvents]);

  useEffect(() => {
    if (isPaused || !activeSiteIds.length) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return undefined;
    }

    const poll = async () => {
      try {
        const newRows = await fetchNewEvents(activeSiteIds, lastTimestampRef.current, {
          limit: 200,
          eventType: eventTypeFilter,
        });
        if (newRows.length) {
          mergeIncomingEvents(newRows);
        }
        setPollingHealthy(true);
      } catch (err) {
        console.error('Polling fallback error:', err);
        setPollingHealthy(false);
      }
    };

    void poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isPaused, activeSiteIds, eventTypeFilter, mergeIncomingEvents]);

  useEffect(
    () => () => {
      unsubscribeChannel(channelRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      Object.values(highlightTimerRef.current).forEach(clearTimeout);
      highlightTimerRef.current = {};
    },
    []
  );

  const handleStartMonitoring = (site) => {
    if (!site) {
      setTrackedSite(null);
      setSiteFilter(null);
      return;
    }
    setTrackedSite(site);
    setSiteFilter(String(site.id));
  };

  const handleSiteFilterChange = (siteId) => {
    setTrackedSite(null);
    setSiteFilter(siteId);
  };

  const statusBadge = (() => {
    if (isPaused) {
      return {
        text: 'Paused',
        className: 'text-yellow-400',
        dotClass: 'bg-yellow-400',
      };
    }
    if (!activeSiteIds.length) {
      return {
        text: 'No active sites',
        className: 'text-muted-foreground',
        dotClass: 'bg-muted-foreground',
      };
    }
    if (realtimeStatus === 'SUBSCRIBED') {
      return {
        text: pollingHealthy ? 'Live realtime + polling backup' : 'Live realtime',
        className: 'text-green-400',
        dotClass: 'bg-green-400',
      };
    }
    return {
      text: pollingHealthy ? 'Polling fallback active (2s)' : 'Connection degraded',
      className: pollingHealthy ? 'text-cyan-400' : 'text-red-400',
      dotClass: pollingHealthy ? 'bg-cyan-400' : 'bg-red-400',
    };
  })();

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen py-8"
    >
      <div className="container mx-auto px-6">
        <div className="mb-6">
          <h1 className="text-4xl font-bold mb-2">Live Event Tracking</h1>
          <p className="text-muted-foreground">Realtime event monitoring with auto-refresh fallback every 2 seconds.</p>
        </div>

        <div className="mb-4">
          <TrackingScriptGenerator
            onSiteRegistered={refreshSites}
            onStartMonitoring={handleStartMonitoring}
          />
        </div>

        <div className="grid lg:grid-cols-[1fr_auto] gap-4 mb-4">
          <SiteFilter
            sites={sites}
            selectedSite={siteFilter}
            onSiteChange={handleSiteFilterChange}
            selectedType={eventTypeFilter}
            onTypeChange={setEventTypeFilter}
            selectedRange={timeRange}
            onRangeChange={setTimeRange}
          />
          <EventCounter rate={eventRate} eventCount={events.length} />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            onClick={togglePause}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
              isPaused
                ? 'bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30'
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 hover:bg-yellow-500/30'
            }`}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>

          <button
            onClick={() => {
              setLoading(true);
              void loadEvents();
            }}
            className="px-4 py-2 glass rounded-lg text-sm text-muted-foreground hover:bg-white/10 transition-all active:scale-95"
          >
            Refresh
          </button>

          {error && <span className="text-xs text-red-400">Error: {error}</span>}

          <span className={`ml-auto flex items-center gap-2 text-xs ${statusBadge.className}`}>
            <span className={`w-2 h-2 rounded-full animate-pulse ${statusBadge.dotClass}`} />
            {statusBadge.text}
            {activeSiteIds.length ? ` • Last seen (IST): ${lastTimestampIndiaRef.current}` : ''}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading events...</p>
            </div>
          </div>
        ) : (
          <GlassCard>
            <LiveEventFeed
              events={events}
              highlightIds={highlightIds}
              onSelectEvent={setSelectedEvent}
            />
          </GlassCard>
        )}
      </div>

      <EventDetailsModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </motion.div>
  );
};

export default LiveTracking;
