// DigiPrint Universal Tracker v2
// Standalone script for external websites — loaded via <script> tag
// Tracks: page_view, click, scroll, form_submit, navigation,
//         session_start, session_end, hover, download, external_link_click

(async function () {

    const script = document.currentScript;
    const domain = script.getAttribute("data-domain");
    const SUPABASE_URL = script.getAttribute("data-supabase-url");
    const SUPABASE_ANON_KEY = script.getAttribute("data-supabase-key");

    if (!domain) {
        console.warn("DigiPrint: data-domain attribute missing");
        return;
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.warn("DigiPrint: Supabase credentials missing from script attributes");
        return;
    }

    const { createClient } = await import(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm"
    );

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let siteId = null;
    let sessionId = null;

    // ─── Initialize ────────────────────────────────────────────

    async function init() {
        const { data: site } = await supabase
            .from("sites")
            .select("id")
            .eq("domain", domain)
            .single();

        if (!site) {
            console.warn("DigiPrint: site not registered —", domain);
            return;
        }

        siteId = site.id;

        const { data: session } = await supabase
            .from("sessions")
            .insert({
                site_id: siteId,
                device_info: {
                    browser: navigator.userAgent,
                    os: navigator.platform,
                    screen: `${window.innerWidth}x${window.innerHeight}`,
                },
            })
            .select()
            .single();

        if (!session) {
            console.warn("DigiPrint: failed to create session");
            return;
        }

        sessionId = session.id;

        track("session_start", { page: location.pathname });
        setupTracking();
    }

    // ─── Core tracking function ────────────────────────────────

    async function track(type, metadata = {}) {
        if (!siteId || !sessionId) return;

        await supabase.from("events").insert({
            site_id: siteId,
            session_id: sessionId,
            event_type: type,
            metadata,
        });
    }

    // ─── Event tracking setup ──────────────────────────────────

    function setupTracking() {
        // 1. Page View
        track("page_view", { page: location.pathname, title: document.title });

        // 2. Click tracking (with element details)
        document.addEventListener("click", (e) => {
            const el = e.target;
            const meta = {
                element: el.tagName,
                page: location.pathname,
            };
            if (el.id) meta.id = el.id;
            if (el.textContent) meta.text = el.textContent.trim().slice(0, 50);
            if (el.className && typeof el.className === 'string') meta.class = el.className.slice(0, 80);

            // Check for download links
            if (el.tagName === 'A' || el.closest('a')) {
                const anchor = el.tagName === 'A' ? el : el.closest('a');
                const href = anchor?.href || '';
                
                // Download detection
                if (/\.(pdf|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|csv|tar|gz|dmg|exe|msi|apk|ipa)$/i.test(href)) {
                    track("download", { file: href.split('/').pop(), url: href, page: location.pathname });
                }

                // External link detection
                try {
                    const linkDomain = new URL(href).hostname;
                    if (linkDomain && linkDomain !== location.hostname) {
                        track("external_link_click", { url: href, domain: linkDomain, page: location.pathname });
                    }
                } catch {
                    // Invalid URL, skip
                }
            }

            track("click", meta);
        });

        // 3. Form submission tracking
        document.addEventListener("submit", (e) => {
            const form = e.target;
            const meta = {
                page: location.pathname,
            };
            if (form.id) meta.formId = form.id;
            if (form.action) meta.action = form.action;
            if (form.method) meta.method = form.method;
            track("form_submit", meta);
        }, true);

        // 4. Scroll milestone tracking
        setupScrollTracking();

        // 5. Navigation tracking (SPA support)
        setupNavigationTracking();

        // 6. Hover tracking on interactive elements
        setupHoverTracking();

        // 7. Session end on page unload
        window.addEventListener("beforeunload", () => {
            track("session_end", { page: location.pathname });
        });
    }

    // ─── Scroll Milestones ─────────────────────────────────────

    function setupScrollTracking() {
        const milestones = [25, 50, 75, 100];
        const reached = new Set();

        const checkScroll = () => {
            const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (scrollHeight <= 0) return;

            const scrollPercent = Math.round((window.scrollY / scrollHeight) * 100);

            for (const milestone of milestones) {
                if (scrollPercent >= milestone && !reached.has(milestone)) {
                    reached.add(milestone);
                    track("scroll", { depth: milestone, page: location.pathname });
                }
            }
        };

        let ticking = false;
        window.addEventListener("scroll", () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    checkScroll();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    // ─── Navigation tracking (History API) ─────────────────────

    function setupNavigationTracking() {
        let lastPath = location.pathname;

        const onNavigate = () => {
            const newPath = location.pathname;
            if (newPath !== lastPath) {
                track("navigation", { from: lastPath, to: newPath });
                track("page_view", { page: newPath, title: document.title });
                lastPath = newPath;
            }
        };

        // Monkey-patch pushState and replaceState
        const origPushState = history.pushState;
        history.pushState = function () {
            origPushState.apply(this, arguments);
            onNavigate();
        };

        const origReplaceState = history.replaceState;
        history.replaceState = function () {
            origReplaceState.apply(this, arguments);
            onNavigate();
        };

        window.addEventListener("popstate", onNavigate);
    }

    // ─── Hover tracking (>1 second on interactive elements) ────

    function setupHoverTracking() {
        let hoverTimer = null;
        let hoveredEl = null;

        document.addEventListener("mouseover", (e) => {
            const target = e.target.closest("a, button, input, select, textarea, [role='button']");
            if (!target || target === hoveredEl) return;

            // Clear previous timer
            if (hoverTimer) clearTimeout(hoverTimer);
            hoveredEl = target;

            hoverTimer = setTimeout(() => {
                const meta = {
                    element: target.tagName,
                    page: location.pathname,
                    duration: 1,
                };
                if (target.id) meta.id = target.id;
                if (target.textContent) meta.text = target.textContent.trim().slice(0, 50);
                track("hover", meta);
            }, 1000);
        });

        document.addEventListener("mouseout", (e) => {
            const target = e.target.closest("a, button, input, select, textarea, [role='button']");
            if (target === hoveredEl) {
                if (hoverTimer) clearTimeout(hoverTimer);
                hoveredEl = null;
            }
        });
    }

    // ─── Start ─────────────────────────────────────────────────

    init();

})();
