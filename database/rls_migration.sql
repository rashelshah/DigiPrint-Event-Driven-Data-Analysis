-- ============================================
-- DigiPrint RLS Migration
-- Adds: owner_id to sites, RLS policies
-- Run this in the Supabase SQL Editor
-- ============================================

-- ======================
-- ADD owner_id TO sites
-- ======================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sites' AND column_name = 'owner_id'
    ) THEN
        ALTER TABLE sites ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sites_owner_id ON sites(owner_id);

-- ======================
-- (Optional) Assign existing sites to a specific user.
-- Replace '<YOUR_USER_UUID>' with a real auth.users id if needed.
-- ======================
-- UPDATE sites SET owner_id = '<YOUR_USER_UUID>' WHERE owner_id IS NULL;

-- ======================
-- ENABLE ROW LEVEL SECURITY
-- ======================
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- ======================
-- SITES POLICIES
-- ======================
-- Authenticated users can only see their own sites
DROP POLICY IF EXISTS "Users see own sites" ON sites;
CREATE POLICY "Users see own sites"
    ON sites FOR SELECT
    USING (owner_id = auth.uid());

-- Authenticated users can insert sites (owner_id set on insert)
DROP POLICY IF EXISTS "Users insert own sites" ON sites;
CREATE POLICY "Users insert own sites"
    ON sites FOR INSERT
    WITH CHECK (owner_id = auth.uid());

-- Authenticated users can update their own sites
DROP POLICY IF EXISTS "Users update own sites" ON sites;
CREATE POLICY "Users update own sites"
    ON sites FOR UPDATE
    USING (owner_id = auth.uid());

-- ======================
-- SESSIONS POLICIES
-- ======================
-- Users can see sessions belonging to their sites
DROP POLICY IF EXISTS "Users see own sessions" ON sessions;
CREATE POLICY "Users see own sessions"
    ON sessions FOR SELECT
    USING (
        site_id IN (SELECT id FROM sites WHERE owner_id = auth.uid())
    );

-- Anon/service role can insert sessions (tracker script uses anon key)
DROP POLICY IF EXISTS "Anon insert sessions" ON sessions;
CREATE POLICY "Anon insert sessions"
    ON sessions FOR INSERT
    WITH CHECK (true);

-- ======================
-- EVENTS POLICIES
-- ======================
-- Users can see events belonging to their sites
DROP POLICY IF EXISTS "Users see own events" ON events;
CREATE POLICY "Users see own events"
    ON events FOR SELECT
    USING (
        site_id IN (SELECT id FROM sites WHERE owner_id = auth.uid())
    );

-- Anon/service role can insert events (tracker script uses anon key)
DROP POLICY IF EXISTS "Anon insert events" ON events;
CREATE POLICY "Anon insert events"
    ON events FOR INSERT
    WITH CHECK (true);

-- ======================
-- UPDATE event_type CHECK constraint to allow new event types
-- ======================
DO $$
BEGIN
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
    ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (
        event_type IN (
            'login', 'logout', 'click', 'search', 'api_call',
            'session_start', 'session_end', 'page_view',
            'scroll', 'form_submit', 'navigation', 'hover',
            'download', 'external_link_click'
        )
    );
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not update event_type constraint: %', SQLERRM;
END $$;
