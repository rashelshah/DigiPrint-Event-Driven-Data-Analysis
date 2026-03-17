-- =============================
-- EXTENSIONS
-- =============================
create extension if not exists pgcrypto;

-- =============================
-- SITES
-- =============================
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  site_name text,
  domain text,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  is_active boolean default true
);

-- allow same domain for different users
drop constraint if exists sites_domain_key on sites;

create unique index if not exists unique_user_domain
on sites(user_id, domain);

-- =============================
-- SESSIONS
-- =============================
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  start_time timestamptz default now(),
  end_time timestamptz,
  duration_seconds integer,
  device_info jsonb,
  ip_hash text,
  created_at timestamptz default now()
);

-- =============================
-- EVENTS
-- =============================
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  event_type text,
  metadata jsonb,
  event_timestamp timestamptz default now(),
  created_at timestamptz default now()
);

-- =============================
-- INDEXES (PERFORMANCE)
-- =============================
create index if not exists idx_events_site_time
on events(site_id, event_timestamp desc);

create index if not exists idx_events_type
on events(event_type);

create index if not exists idx_sessions_site
on sessions(site_id);

-- =============================
-- RLS ENABLE
-- =============================
alter table sites enable row level security;
alter table sessions enable row level security;
alter table events enable row level security;

-- =============================
-- USER ISOLATION POLICIES
-- =============================

-- SITES
drop policy if exists "users_own_sites" on sites;

create policy "users_own_sites"
on sites
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- SESSIONS
drop policy if exists "users_own_sessions" on sessions;

create policy "users_own_sessions"
on sessions
for all
using (
  site_id in (
    select id from sites where user_id = auth.uid()
  )
)
with check (
  site_id in (
    select id from sites where user_id = auth.uid()
  )
);

-- EVENTS
drop policy if exists "users_own_events" on events;

create policy "users_own_events"
on events
for all
using (
  site_id in (
    select id from sites where user_id = auth.uid()
  )
)
with check (
  site_id in (
    select id from sites where user_id = auth.uid()
  )
);

-- =============================
-- TRACKER (ANON ACCESS)
-- =============================

drop policy if exists "anon_select_sites" on sites;
drop policy if exists "anon_insert_sessions" on sessions;
drop policy if exists "anon_insert_events" on events;

create policy "anon_select_sites"
on sites
for select
to anon
using (true);

create policy "anon_insert_sessions"
on sessions
for insert
to anon
with check (true);

create policy "anon_insert_events"
on events
for insert
to anon
with check (true);

-- =============================
-- ANALYTICS VIEWS
-- =============================

-- Events over time
create or replace view v_events_over_time as
select
  site_id,
  date_trunc('minute', event_timestamp) as time_bucket,
  count(*) as event_count
from events
group by site_id, time_bucket;

-- Event distribution
create or replace view v_event_distribution as
select
  site_id,
  event_type,
  count(*) as total
from events
group by site_id, event_type;

-- Top pages
create or replace view v_top_pages as
select
  site_id,
  metadata->>'page' as page,
  count(*) as visits
from events
where event_type = 'page_view'
group by site_id, page;

-- Scroll depth
create or replace view v_scroll_depth as
select
  site_id,
  (metadata->>'scroll_percent')::int as scroll_percent,
  count(*) as users
from events
where event_type = 'scroll_depth'
group by site_id, scroll_percent;

-- Device analytics
create or replace view v_device_analytics as
select
  site_id,
  metadata->>'browser' as browser,
  count(*) as users
from events
group by site_id, browser;

-- Session summary
create or replace view v_session_summary as
select
  site_id,
  count(*) as total_sessions,
  avg(duration_seconds) as avg_duration
from sessions
group by site_id;

-- Funnel
create or replace view v_funnel as
select
  site_id,
  count(*) filter (where event_type = 'page_view') as page_views,
  count(*) filter (where event_type = 'click') as clicks,
  count(*) filter (where event_type = 'form_submit') as conversions
from events
group by site_id;