-- DigiPrint analytics views (production-grade aggregates)
-- Run in Supabase SQL editor after base tables exist.
-- Does not alter existing table structure or RLS policies.

-- ---------------------------------------------------------------------------
-- Recommended indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_events_site_timestamp
ON events (site_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_type
ON events (event_type);

CREATE INDEX IF NOT EXISTS idx_sessions_site
ON sessions (site_id);

-- ---------------------------------------------------------------------------
-- Events over time
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_events_over_time AS
SELECT
  e.site_id,
  DATE_TRUNC('minute', e.event_timestamp) AS time_bucket,
  COUNT(*)::BIGINT AS event_count
FROM events e
GROUP BY e.site_id, DATE_TRUNC('minute', e.event_timestamp);

COMMENT ON VIEW v_events_over_time IS
'Minute-level event counts per site.';

-- ---------------------------------------------------------------------------
-- Event distribution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_event_distribution AS
SELECT
  e.site_id,
  e.event_type,
  COUNT(*)::BIGINT AS total
FROM events e
GROUP BY e.site_id, e.event_type;

COMMENT ON VIEW v_event_distribution IS
'Count per event_type per site.';

-- ---------------------------------------------------------------------------
-- Top pages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_top_pages AS
SELECT
  e.site_id,
  COALESCE(NULLIF(e.metadata ->> 'page', ''), '/') AS page,
  COUNT(*)::BIGINT AS visits
FROM events e
WHERE e.event_type = 'page_view'
GROUP BY e.site_id, COALESCE(NULLIF(e.metadata ->> 'page', ''), '/');

COMMENT ON VIEW v_top_pages IS
'Top page_view pages per site.';

-- ---------------------------------------------------------------------------
-- Scroll depth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_scroll_depth AS
SELECT
  e.site_id,
  (e.metadata ->> 'scroll_percent')::INT AS scroll_percent,
  COUNT(DISTINCT e.session_id)::BIGINT AS users
FROM events e
WHERE
  e.event_type = 'scroll_depth'
  AND (e.metadata ->> 'scroll_percent') ~ '^[0-9]+$'
GROUP BY e.site_id, (e.metadata ->> 'scroll_percent')::INT;

COMMENT ON VIEW v_scroll_depth IS
'Distinct sessions reaching a scroll milestone per site.';

-- ---------------------------------------------------------------------------
-- Device analytics
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_device_analytics AS
SELECT
  e.site_id,
  COALESCE(NULLIF(e.metadata ->> 'browser', ''), NULLIF(se.device_info ->> 'browser', ''), 'Unknown') AS browser,
  COALESCE(NULLIF(e.metadata ->> 'screen', ''), NULLIF(se.device_info ->> 'screen', ''), 'Unknown') AS screen,
  COUNT(DISTINCT e.session_id)::BIGINT AS users
FROM events e
LEFT JOIN sessions se ON se.id = e.session_id
GROUP BY
  e.site_id,
  COALESCE(NULLIF(e.metadata ->> 'browser', ''), NULLIF(se.device_info ->> 'browser', ''), 'Unknown'),
  COALESCE(NULLIF(e.metadata ->> 'screen', ''), NULLIF(se.device_info ->> 'screen', ''), 'Unknown');

COMMENT ON VIEW v_device_analytics IS
'Distinct sessions grouped by browser and screen per site.';

-- ---------------------------------------------------------------------------
-- Session summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_session_summary AS
SELECT
  s.site_id,
  COUNT(*)::BIGINT AS total_sessions,
  ROUND(AVG(
    CASE
      WHEN s.duration_seconds IS NOT NULL THEN s.duration_seconds::NUMERIC
      WHEN s.end_time IS NOT NULL THEN EXTRACT(EPOCH FROM (s.end_time - s.start_time))
      ELSE NULL
    END
  ), 2) AS avg_duration_seconds
FROM sessions s
GROUP BY s.site_id;

COMMENT ON VIEW v_session_summary IS
'Session counts and average duration per site.';

-- ---------------------------------------------------------------------------
-- Funnel summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_funnel AS
SELECT
  e.site_id,
  COUNT(DISTINCT CASE WHEN e.event_type = 'page_view' THEN e.session_id END)::BIGINT AS page_views,
  COUNT(DISTINCT CASE WHEN e.event_type = 'click' THEN e.session_id END)::BIGINT AS clicks,
  COUNT(DISTINCT CASE WHEN e.event_type = 'form_submit' THEN e.session_id END)::BIGINT AS form_submits,
  COUNT(DISTINCT CASE WHEN e.event_type IN ('conversion', 'signup', 'purchase', 'checkout_complete', 'form_submit') THEN e.session_id END)::BIGINT AS conversions
FROM events e
GROUP BY e.site_id;

COMMENT ON VIEW v_funnel IS
'Session-level funnel counts per site.';
