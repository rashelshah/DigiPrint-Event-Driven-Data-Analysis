// DigiPrint Universal Tracker v4
// Standalone script loaded via <script> tag.
// Required attributes:
//   - data-site-id
//   - data-supabase-url
//   - data-supabase-key

(async function () {
  const script =
    document.currentScript ||
    Array.from(document.getElementsByTagName("script")).find((node) =>
      String(node.src || "").includes("tracker.js")
    );

  const siteId = (script?.getAttribute("data-site-id") || "").trim();
  const SUPABASE_URL = (script?.getAttribute("data-supabase-url") || "").trim();
  const SUPABASE_ANON_KEY = (script?.getAttribute("data-supabase-key") || "").trim();

  if (!siteId) {
    console.warn("DigiPrint: data-site-id attribute is required. Tracking disabled.");
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("DigiPrint: Supabase credentials missing from script attributes.");
    return;
  }

  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm"
  );

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  });

  const BATCH_INTERVAL_MS = 2000;
  const MAX_BATCH_SIZE = 20;
  const SESSION_RETRY_MAX = 3;
  const SESSION_RETRY_DELAY_MS = 500;

  let sessionId = null;
  let flushTimer = null;
  let ended = false;
  let isFlushing = false;

  const eventQueue = [];

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function detectBrowser(ua) {
    if (/edg/i.test(ua)) return "Edge";
    if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) return "Chrome";
    if (/safari/i.test(ua) && !/chrome|crios|edg/i.test(ua)) return "Safari";
    if (/firefox|fxios/i.test(ua)) return "Firefox";
    if (/opr|opera/i.test(ua)) return "Opera";
    return "Unknown";
  }

  function detectOs(ua) {
    if (/windows nt/i.test(ua)) return "Windows";
    if (/android/i.test(ua)) return "Android";
    if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
    if (/mac os x/i.test(ua)) return "macOS";
    if (/linux/i.test(ua)) return "Linux";
    return "Unknown";
  }

  function getBaseMetadata() {
    const ua = navigator.userAgent || "";
    return {
      page: `${location.pathname}${location.search}`,
      title: document.title || "",
      timestamp: new Date().toISOString(),
      referrer: document.referrer || null,
      screen: `${window.screen?.width || window.innerWidth}x${window.screen?.height || window.innerHeight}`,
      browser: detectBrowser(ua),
      os: detectOs(ua),
    };
  }

  function track(type, metadata) {
    if (!sessionId) return;
    const mergedMetadata = {
      ...getBaseMetadata(),
      ...(metadata || {}),
    };

    eventQueue.push({
      site_id: siteId,
      session_id: sessionId,
      event_type: type,
      metadata: mergedMetadata,
    });

    if (eventQueue.length >= MAX_BATCH_SIZE) {
      void flushQueue();
    }
  }

  function isSupabaseUrl(url) {
    if (!url) return false;
    const normalized = String(url).toLowerCase();
    return (
      normalized.includes("supabase.co") ||
      normalized.includes("/rest/v1") ||
      normalized.includes("/realtime")
    );
  }

  async function insertBatch(batch) {
    const { error } = await supabase.from("events").insert(batch);
    if (error) throw error;
  }

  async function flushQueue(options) {
    const useKeepalive = Boolean(options?.useKeepalive);
    const flushAll = Boolean(options?.flushAll);

    if (!eventQueue.length || !sessionId || isFlushing) return;
    isFlushing = true;

    try {
      while (eventQueue.length) {
        const sliceSize = flushAll ? Math.min(eventQueue.length, MAX_BATCH_SIZE) : MAX_BATCH_SIZE;
        const batch = eventQueue.splice(0, sliceSize);

        try {
          if (useKeepalive) {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
              method: "POST",
              keepalive: true,
              headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify(batch),
            });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
          } else {
            await insertBatch(batch);
          }
        } catch (error) {
          eventQueue.unshift(...batch);
          console.warn("DigiPrint: event batch flush failed", error);
          break;
        }

        if (!flushAll) break;
      }
    } finally {
      isFlushing = false;
    }
  }

  function flushWithBeacon() {
    if (!eventQueue.length || !navigator.sendBeacon) {
      return false;
    }

    const batch = eventQueue.splice(0, eventQueue.length);
    const payload = JSON.stringify(batch);
    const blob = new Blob([payload], { type: "application/json" });
    const url = `${SUPABASE_URL}/rest/v1/events?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}`;
    const ok = navigator.sendBeacon(url, blob);

    if (!ok) {
      eventQueue.unshift(...batch);
    }
    return ok;
  }

  async function createSessionWithRetry() {
    const ua = navigator.userAgent || "";
    const deviceInfo = {
      browser: detectBrowser(ua),
      os: detectOs(ua),
      screen: `${window.screen?.width || window.innerWidth}x${window.screen?.height || window.innerHeight}`,
      user_agent: ua,
    };

    for (let attempt = 1; attempt <= SESSION_RETRY_MAX; attempt += 1) {
      const candidateSessionId = crypto.randomUUID();
      const { error } = await supabase.from("sessions").insert({
        id: candidateSessionId,
        site_id: siteId,
        device_info: deviceInfo,
        start_time: new Date().toISOString(),
      });

      if (!error) {
        return candidateSessionId;
      }

      console.warn(
        `DigiPrint: session creation failed (attempt ${attempt}/${SESSION_RETRY_MAX})`,
        error
      );
      if (attempt < SESSION_RETRY_MAX) {
        await delay(SESSION_RETRY_DELAY_MS * attempt);
      }
    }

    throw new Error("DigiPrint: unable to create session after retries.");
  }

  function setupClickTracking() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const el = target?.closest("a,button,input,textarea,select,[role='button']") || target;
        if (!el) return;

        const text = (el.textContent || "").trim().slice(0, 120);
        const clickMetadata = {
          element: el.tagName,
          element_id: el.id || null,
          element_class: typeof el.className === "string" ? el.className.slice(0, 120) : null,
          text: text || null,
        };
        track("click", clickMetadata);

        const attrText = [
          el.id || "",
          el.getAttribute?.("name") || "",
          el.getAttribute?.("aria-label") || "",
          el.getAttribute?.("data-testid") || "",
          text,
        ]
          .join(" ")
          .toLowerCase();

        if (/logout|sign\s*out|log\s*out/.test(attrText)) {
          track("logout", { trigger: "click", element: el.tagName });
        }
        if (/login|sign\s*in|log\s*in/.test(attrText)) {
          track("login", { trigger: "click", element: el.tagName });
        }

        const anchor = el.closest("a");
        if (!anchor?.href) return;

        const href = anchor.href;
        const fileName = href.split("/").pop() || null;
        if (/\.(pdf|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|csv|tar|gz|dmg|exe|msi|apk|ipa)$/i.test(href)) {
          track("download", { file: fileName, url: href });
        }

        try {
          const linkDomain = new URL(href).hostname;
          if (linkDomain && linkDomain !== location.hostname) {
            track("external_link_click", { url: href, domain: linkDomain });
          }
        } catch {
          // Ignore invalid URLs.
        }
      },
      true
    );
  }

  function setupFormTracking() {
    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (!form) return;

        const metadata = {
          form_id: form.id || null,
          action: form.action || null,
          method: (form.method || "GET").toUpperCase(),
        };
        track("form_submit", metadata);

        const formText = [
          form.id || "",
          form.className || "",
          form.action || "",
          form.getAttribute("name") || "",
          form.textContent || "",
        ]
          .join(" ")
          .toLowerCase();

        const searchInput = form.querySelector(
          "input[type='search'], input[name*='search' i], input[name*='query' i], input[name='q' i]"
        );
        const query = searchInput?.value?.trim();
        if (query) {
          track("search", { query });
        }

        if (/login|sign\s*in|auth/.test(formText)) {
          track("login", { trigger: "form_submit" });
        }
        if (/logout|sign\s*out/.test(formText)) {
          track("logout", { trigger: "form_submit" });
        }
      },
      true
    );

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input) return;
      const type = String(input.type || "").toLowerCase();
      const name = String(input.name || "").toLowerCase();
      if (type !== "search" && !/search|query|q/.test(name)) return;
      const query = input.value?.trim();
      if (query) {
        track("search", { query, trigger: "enter_key" });
      }
    });
  }

  function setupScrollTracking() {
    const milestones = [25, 50, 75, 100];
    let reachedMilestones = new Set();
    let ticking = false;
    let lastPath = `${location.pathname}${location.search}`;

    function checkScroll() {
      const pageHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (pageHeight <= 0) return;

      const percent = Math.min(100, Math.round((window.scrollY / pageHeight) * 100));
      for (const milestone of milestones) {
        if (percent >= milestone && !reachedMilestones.has(milestone)) {
          reachedMilestones.add(milestone);
          track("scroll_depth", { scroll_percent: milestone });
        }
      }
    }

    function resetMilestonesOnPathChange() {
      const currentPath = `${location.pathname}${location.search}`;
      if (currentPath !== lastPath) {
        reachedMilestones = new Set();
        lastPath = currentPath;
      }
    }

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          resetMilestonesOnPathChange();
          checkScroll();
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  function setupNavigationTracking() {
    let lastPath = `${location.pathname}${location.search}`;

    const onNavigate = () => {
      const nextPath = `${location.pathname}${location.search}`;
      if (nextPath === lastPath) return;
      track("navigation", { from: lastPath, to: nextPath });
      track("page_view", { page: nextPath, title: document.title || "" });
      lastPath = nextPath;
    };

    const originalPushState = history.pushState;
    history.pushState = function pushStatePatched() {
      originalPushState.apply(this, arguments);
      onNavigate();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function replaceStatePatched() {
      originalReplaceState.apply(this, arguments);
      onNavigate();
    };

    window.addEventListener("popstate", onNavigate);
    window.addEventListener("hashchange", onNavigate);
  }

  function setupHoverTracking() {
    let timerId = null;
    let activeTarget = null;
    let hoverStartedAt = 0;

    document.addEventListener(
      "mouseover",
      (event) => {
        const target = event.target instanceof Element
          ? event.target.closest("a,button,input,select,textarea,[role='button']")
          : null;
        if (!target || target === activeTarget) return;

        if (timerId) {
          clearTimeout(timerId);
        }

        activeTarget = target;
        hoverStartedAt = Date.now();

        timerId = setTimeout(() => {
          const durationMs = Date.now() - hoverStartedAt;
          track("hover", {
            element: target.tagName,
            element_id: target.id || null,
            text: (target.textContent || "").trim().slice(0, 80) || null,
            duration_ms: durationMs,
          });
        }, 1000);
      },
      true
    );

    document.addEventListener(
      "mouseout",
      (event) => {
        const target = event.target instanceof Element
          ? event.target.closest("a,button,input,select,textarea,[role='button']")
          : null;
        if (!target || target !== activeTarget) return;
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
        activeTarget = null;
      },
      true
    );
  }

  function setupApiCallTracking() {
    const originalFetch = window.fetch;
    window.fetch = function fetchPatched(input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      if (!isSupabaseUrl(url)) {
        track("api_call", {
          endpoint: String(url).split("?")[0].slice(0, 240),
          method: String(init?.method || "GET").toUpperCase(),
        });
      }
      return originalFetch.apply(this, arguments);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function openPatched(method, url) {
      if (!isSupabaseUrl(url)) {
        track("api_call", {
          endpoint: String(url).split("?")[0].slice(0, 240),
          method: String(method || "GET").toUpperCase(),
        });
      }
      return originalXhrOpen.apply(this, arguments);
    };
  }

  function setupRageClickTracking() {
    const log = [];

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const now = Date.now();
        while (log.length && now - log[0].time > 1000) {
          log.shift();
        }

        log.push({ time: now, target });
        const sameTargetCount = log.filter((entry) => entry.target === target).length;
        if (sameTargetCount < 3) return;

        track("rage_click", {
          element: target.tagName,
          element_id: target.id || null,
          element_class: typeof target.className === "string" ? target.className.slice(0, 120) : null,
          text: (target.textContent || "").trim().slice(0, 80) || null,
          clicks: sameTargetCount,
          window_ms: 1000,
        });

        log.length = 0;
      },
      true
    );
  }

  function setupFlushTriggers() {
    flushTimer = window.setInterval(() => {
      void flushQueue();
    }, BATCH_INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (!flushWithBeacon()) {
          void flushQueue({ useKeepalive: true, flushAll: true });
        }
      }
    });

    window.addEventListener("pagehide", () => {
      if (!flushWithBeacon()) {
        void flushQueue({ useKeepalive: true, flushAll: true });
      }
    });
  }

  function endSession() {
    if (ended) return;
    ended = true;
    track("session_end", { reason: "page_exit" });
    if (!flushWithBeacon()) {
      void flushQueue({ useKeepalive: true, flushAll: true });
    }
    if (flushTimer) {
      window.clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  function setupTracking() {
    setupFlushTriggers();
    setupClickTracking();
    setupFormTracking();
    setupScrollTracking();
    setupNavigationTracking();
    setupHoverTracking();
    setupApiCallTracking();
    setupRageClickTracking();

    track("session_start", { entry_page: `${location.pathname}${location.search}` });
    track("page_view", { page: `${location.pathname}${location.search}`, title: document.title || "" });

    window.addEventListener("beforeunload", endSession);
    window.addEventListener("unload", endSession);
  }

  async function init() {
    try {
      sessionId = await createSessionWithRetry();
    } catch (error) {
      console.error("DigiPrint: session initialization failed. Tracking disabled.", error);
      return;
    }

    setupTracking();
  }

  void init();
})();
