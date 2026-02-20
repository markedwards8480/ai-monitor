// ============================================================
// Mark Edwards Apparel — AI Usage Monitor (Tracking Script)
// Embed this in the product catalog to collect usage analytics
// ============================================================

(function() {
  'use strict';

  const MONITOR_CONFIG = {
    // Where to send analytics data
    apiEndpoint: '/api/monitor/events',
    // Batch events before sending
    batchSize: 10,
    // Send batch every N seconds even if not full
    flushInterval: 30000,
    // Session timeout in minutes
    sessionTimeout: 30,
    // Enable console logging for debugging
    debug: false
  };

  // ---- Session Management ----
  const SESSION_KEY = 'me_monitor_session';
  const USER_KEY = 'me_monitor_user';

  function generateId() {
    return 'xxxx-xxxx-xxxx'.replace(/x/g, () => 
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  function getOrCreateSession() {
    let session = null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) session = JSON.parse(raw);
    } catch(e) {}
    
    if (!session || (Date.now() - session.lastActivity > MONITOR_CONFIG.sessionTimeout * 60000)) {
      session = {
        id: generateId(),
        startedAt: Date.now(),
        lastActivity: Date.now(),
        pageViews: 0
      };
    }
    session.lastActivity = Date.now();
    session.pageViews++;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch(e) {}
    return session;
  }

  function getOrCreateUser() {
    let user = null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) user = JSON.parse(raw);
    } catch(e) {}
    
    if (!user) {
      user = {
        id: generateId(),
        firstSeen: Date.now(),
        totalSessions: 0,
        totalEvents: 0
      };
    }
    user.totalSessions++;
    user.lastSeen = Date.now();
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch(e) {}
    return user;
  }

  const session = getOrCreateSession();
  const user = getOrCreateUser();

  // ---- Event Queue ----
  let eventQueue = [];
  let isFlushScheduled = false;

  function trackEvent(category, action, data = {}) {
    const event = {
      timestamp: Date.now(),
      sessionId: session.id,
      userId: user.id,
      page: window.location.pathname + window.location.search,
      category,
      action,
      data,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      device: getDeviceType()
    };

    eventQueue.push(event);
    user.totalEvents++;

    if (MONITOR_CONFIG.debug) {
      console.log('[Monitor]', category, action, data);
    }

    if (eventQueue.length >= MONITOR_CONFIG.batchSize) {
      flushEvents();
    } else if (!isFlushScheduled) {
      isFlushScheduled = true;
      setTimeout(() => {
        flushEvents();
        isFlushScheduled = false;
      }, MONITOR_CONFIG.flushInterval);
    }
  }

  function flushEvents() {
    if (eventQueue.length === 0) return;

    const batch = [...eventQueue];
    eventQueue = [];

    // Send to server
    fetch(MONITOR_CONFIG.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch,
        sessionMeta: {
          sessionId: session.id,
          userId: user.id,
          userAgent: navigator.userAgent,
          screenResolution: `${screen.width}x${screen.height}`,
          language: navigator.language,
          referrer: document.referrer
        }
      }),
      keepalive: true
    }).catch(err => {
      if (MONITOR_CONFIG.debug) console.warn('[Monitor] Flush failed:', err);
      // Re-queue failed events
      eventQueue = [...batch, ...eventQueue];
    });
  }

  function getDeviceType() {
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  // ---- Feature Usage Tracking ----

  // Track all clicks with element context
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a, [data-feature], input, select, .clickable, [onclick]');
    if (!el) {
      // Track clicks on non-interactive elements (potential UX issue)
      trackEvent('interaction', 'click_void', {
        element: e.target.tagName,
        className: e.target.className?.substring?.(0, 100),
        text: e.target.textContent?.substring?.(0, 50)?.trim(),
        x: e.clientX,
        y: e.clientY
      });
      return;
    }

    const featureName = el.dataset?.feature || 
                        el.id || 
                        el.getAttribute('aria-label') ||
                        el.textContent?.substring?.(0, 50)?.trim() ||
                        el.tagName;

    trackEvent('feature', 'click', {
      feature: featureName,
      element: el.tagName,
      id: el.id,
      className: el.className?.substring?.(0, 100),
      href: el.href || null,
      text: el.textContent?.substring?.(0, 80)?.trim(),
      dataFeature: el.dataset?.feature || null
    });
  }, true);

  // ---- Search Tracking ----
  let searchTimeout = null;
  document.addEventListener('input', (e) => {
    if (e.target.matches('input[type="search"], input[type="text"], [data-feature*="search"], #search, .search-input, input[placeholder*="search" i], input[placeholder*="Search" i]')) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        trackEvent('search', 'query', {
          query: e.target.value?.substring?.(0, 100),
          length: e.target.value?.length || 0,
          inputId: e.target.id,
          placeholder: e.target.placeholder
        });
      }, 500);
    }
  }, true);

  // ---- Filter Tracking ----
  document.addEventListener('change', (e) => {
    if (e.target.matches('select, input[type="checkbox"], input[type="radio"]')) {
      trackEvent('filter', 'change', {
        element: e.target.tagName,
        type: e.target.type,
        id: e.target.id,
        name: e.target.name,
        value: e.target.value?.substring?.(0, 100),
        checked: e.target.checked,
        label: e.target.closest('label')?.textContent?.substring?.(0, 50)?.trim() ||
               document.querySelector(`label[for="${e.target.id}"]`)?.textContent?.substring?.(0, 50)?.trim()
      });
    }
  }, true);

  // ---- Scroll Depth Tracking ----
  let maxScrollDepth = 0;
  let scrollCheckpoints = new Set();
  
  function getScrollDepth() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const viewHeight = window.innerHeight;
    return Math.round((scrollTop / (docHeight - viewHeight)) * 100) || 0;
  }

  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const depth = getScrollDepth();
      if (depth > maxScrollDepth) {
        maxScrollDepth = depth;
      }
      // Track at 25% intervals
      [25, 50, 75, 90, 100].forEach(checkpoint => {
        if (depth >= checkpoint && !scrollCheckpoints.has(checkpoint)) {
          scrollCheckpoints.add(checkpoint);
          trackEvent('engagement', 'scroll_depth', {
            depth: checkpoint,
            pageHeight: document.documentElement.scrollHeight
          });
        }
      });
    }, 200);
  }, { passive: true });

  // ---- Rage Click Detection ----
  let clickTimes = [];
  const RAGE_CLICK_THRESHOLD = 3;
  const RAGE_CLICK_WINDOW = 1500; // ms

  document.addEventListener('click', (e) => {
    const now = Date.now();
    clickTimes.push({ time: now, x: e.clientX, y: e.clientY });
    clickTimes = clickTimes.filter(c => now - c.time < RAGE_CLICK_WINDOW);

    if (clickTimes.length >= RAGE_CLICK_THRESHOLD) {
      // Check if clicks are in roughly the same area
      const avgX = clickTimes.reduce((s, c) => s + c.x, 0) / clickTimes.length;
      const avgY = clickTimes.reduce((s, c) => s + c.y, 0) / clickTimes.length;
      const isLocalized = clickTimes.every(c => 
        Math.abs(c.x - avgX) < 50 && Math.abs(c.y - avgY) < 50
      );

      if (isLocalized) {
        const el = document.elementFromPoint(avgX, avgY);
        trackEvent('ux_issue', 'rage_click', {
          x: Math.round(avgX),
          y: Math.round(avgY),
          element: el?.tagName,
          id: el?.id,
          className: el?.className?.substring?.(0, 100),
          text: el?.textContent?.substring?.(0, 50)?.trim(),
          clickCount: clickTimes.length
        });
        clickTimes = [];
      }
    }
  }, true);

  // ---- Dead Click Detection ----
  // Clicks on elements that look clickable but aren't interactive
  document.addEventListener('click', (e) => {
    const el = e.target;
    const style = window.getComputedStyle(el);
    const looksClickable = style.cursor === 'pointer' || 
                           el.style.cursor === 'pointer' ||
                           el.closest('[style*="cursor: pointer"]');
    const isInteractive = el.closest('button, a, input, select, textarea, [onclick], [data-feature]');
    
    if (looksClickable && !isInteractive) {
      trackEvent('ux_issue', 'dead_click', {
        element: el.tagName,
        id: el.id,
        className: el.className?.substring?.(0, 100),
        text: el.textContent?.substring?.(0, 50)?.trim(),
        x: e.clientX,
        y: e.clientY
      });
    }
  }, true);

  // ---- Page Performance ----
  window.addEventListener('load', () => {
    setTimeout(() => {
      const perf = performance.getEntriesByType('navigation')[0];
      if (perf) {
        trackEvent('performance', 'page_load', {
          dns: Math.round(perf.domainLookupEnd - perf.domainLookupStart),
          tcp: Math.round(perf.connectEnd - perf.connectStart),
          ttfb: Math.round(perf.responseStart - perf.requestStart),
          domReady: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
          fullLoad: Math.round(perf.loadEventEnd - perf.startTime),
          domInteractive: Math.round(perf.domInteractive - perf.startTime),
          transferSize: perf.transferSize,
          encodedSize: perf.encodedBodySize,
          decodedSize: perf.decodedBodySize
        });
      }

      // Core Web Vitals
      if ('PerformanceObserver' in window) {
        // Largest Contentful Paint
        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            trackEvent('performance', 'lcp', {
              value: Math.round(last.startTime),
              element: last.element?.tagName,
              url: last.url
            });
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch(e) {}

        // Cumulative Layout Shift
        try {
          let clsValue = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                clsValue += entry.value;
              }
            }
            trackEvent('performance', 'cls', { value: Math.round(clsValue * 1000) / 1000 });
          }).observe({ type: 'layout-shift', buffered: true });
        } catch(e) {}

        // First Input Delay
        try {
          new PerformanceObserver((list) => {
            const entry = list.getEntries()[0];
            trackEvent('performance', 'fid', { value: Math.round(entry.processingStart - entry.startTime) });
          }).observe({ type: 'first-input', buffered: true });
        } catch(e) {}
      }
    }, 1000);
  });

  // ---- Navigation Flow Tracking ----
  let pageEntryTime = Date.now();
  
  // Track time on page before leaving
  window.addEventListener('beforeunload', () => {
    const timeOnPage = Date.now() - pageEntryTime;
    trackEvent('engagement', 'page_exit', {
      timeOnPage,
      maxScrollDepth,
      page: window.location.pathname
    });
    flushEvents();
  });

  // Track SPA navigation (for hash or pushState based routing)
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      const timeOnPage = Date.now() - pageEntryTime;
      trackEvent('navigation', 'page_change', {
        from: lastUrl,
        to: window.location.href,
        timeOnPreviousPage: timeOnPage
      });
      lastUrl = window.location.href;
      pageEntryTime = Date.now();
      maxScrollDepth = 0;
      scrollCheckpoints.clear();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ---- Visibility Tracking ----
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      trackEvent('engagement', 'tab_hidden', {});
    } else if (hiddenAt) {
      trackEvent('engagement', 'tab_visible', {
        hiddenDuration: Date.now() - hiddenAt
      });
      hiddenAt = null;
    }
  });

  // ---- Error Tracking ----
  window.addEventListener('error', (e) => {
    trackEvent('error', 'js_error', {
      message: e.message?.substring?.(0, 200),
      source: e.filename,
      line: e.lineno,
      col: e.colno
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    trackEvent('error', 'promise_rejection', {
      message: String(e.reason)?.substring?.(0, 200)
    });
  });

  // ---- Network Request Tracking ----
  // Monitor fetch requests for performance
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const start = Date.now();
    
    // Don't track our own monitoring calls
    if (url?.includes('/api/monitor/')) return origFetch.apply(this, args);
    
    return origFetch.apply(this, args).then(response => {
      trackEvent('performance', 'api_call', {
        url: url?.substring?.(0, 200),
        method: args[1]?.method || 'GET',
        status: response.status,
        duration: Date.now() - start,
        ok: response.ok
      });
      return response;
    }).catch(err => {
      trackEvent('performance', 'api_error', {
        url: url?.substring?.(0, 200),
        method: args[1]?.method || 'GET',
        duration: Date.now() - start,
        error: err.message?.substring?.(0, 100)
      });
      throw err;
    });
  };

  // ---- Image Load Tracking ----
  // Track which product images are viewed vs skipped
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          trackEvent('content', 'image_viewed', {
            src: img.src?.substring?.(0, 200),
            alt: img.alt?.substring?.(0, 100),
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            loadTime: img.complete ? 'already_loaded' : 'loading'
          });
          imageObserver.unobserve(img);
        }
      });
    }, { threshold: 0.5 });

    // Observe images after page load
    window.addEventListener('load', () => {
      document.querySelectorAll('img').forEach(img => imageObserver.observe(img));
    });
  }

  // ---- Expose API for custom tracking ----
  window.MEMonitor = {
    track: trackEvent,
    flush: flushEvents,
    getSession: () => ({ ...session }),
    getUser: () => ({ ...user }),
    config: MONITOR_CONFIG
  };

  // Initial page view
  trackEvent('navigation', 'page_view', {
    url: window.location.href,
    title: document.title,
    referrer: document.referrer
  });

  if (MONITOR_CONFIG.debug) {
    console.log('[Monitor] AI Usage Monitor initialized', { session: session.id, user: user.id });
  }
})();
