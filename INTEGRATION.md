# AI Monitor — Integration Guide
## Mark Edwards Apparel Product Catalog

### Overview

The AI Monitor system has two components:

1. **Tracker Script** (`tracker.js`) — Lightweight JavaScript that gets embedded in the product catalog to silently collect usage data
2. **Monitor Dashboard** (`server.js` + `public/`) — Separate app that stores events, analyzes data, and provides AI-powered recommendations

---

### Step 1: Deploy the Monitor Dashboard

**On Railway, create a new service:**

1. Push the `ai-monitor/` folder to a new GitHub repo (or add to existing repo)
2. Create a new Railway service from the repo
3. Add a PostgreSQL database to the service
4. Set environment variables:
   - `DATABASE_URL` — auto-set by Railway when you link the Postgres DB
   - `ANTHROPIC_API_KEY` — your Claude API key for AI analysis
   - `PORT` — Railway sets this automatically
5. Add a custom domain: `monitor.markedwards.cloud`

**Have Nassim add the DNS record:**
```
CNAME  monitor  →  [railway-domain].up.railway.app
```

---

### Step 2: Add Tracker to the Product Catalog

In your catalog's `server.js`, add the monitoring API endpoint and serve the tracker:

**Option A: Embed tracker directly (simplest)**

Add this script tag to the HTML template in your catalog's server.js, right before the closing `</body>` tag:

```html
<script src="https://monitor.markedwards.cloud/tracker.js"></script>
```

Then update the `MONITOR_CONFIG.apiEndpoint` in tracker.js to:
```javascript
apiEndpoint: 'https://monitor.markedwards.cloud/api/monitor/events',
```

**Option B: Self-hosted tracker (better performance)**

Copy `tracker.js` into your catalog's public folder and add the event collection routes to your catalog's server.js. This keeps everything on one domain and avoids CORS issues.

Add these routes to catalogue server.js:
```javascript
// Forward events to monitor service
app.post('/api/monitor/events', async (req, res) => {
  try {
    const response = await fetch('https://monitor.markedwards.cloud/api/monitor/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Monitor forwarding failed' });
  }
});
```

---

### Step 3: Add CORS Headers to Monitor

If using Option A (cross-domain), add CORS to the monitor's server.js:

```javascript
// Add at the top of server.js, after express() setup
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://catalogue.markedwards.cloud');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
```

---

### Step 4: Add Feature Annotations (Optional but Recommended)

For better feature tracking, add `data-feature` attributes to key UI elements in the catalog:

```html
<button data-feature="search-ai">AI Search</button>
<button data-feature="filter-category">Category Filter</button>
<button data-feature="view-toggle-available">Available Now</button>
<button data-feature="view-toggle-lts">Left to Sell</button>
<button data-feature="share-catalog">Share Catalog</button>
<button data-feature="email-catalog">Email Catalog</button>
<button data-feature="export-pdf">Export PDF</button>
<input data-feature="search-main" type="search" />
<select data-feature="filter-color">...</select>
<select data-feature="filter-size">...</select>
```

This gives the AI much cleaner data to work with for recommendations.

---

### Step 5: Custom Event Tracking (Optional)

For tracking specific business events, use the exposed API:

```javascript
// Track when a user shares a catalog
window.MEMonitor?.track('business', 'catalog_shared', {
  customer: 'Burlington',
  productCount: 45,
  categories: ['Tops', 'Bottoms']
});

// Track when an order request is submitted
window.MEMonitor?.track('business', 'order_request', {
  customer: 'Ross',
  items: 12,
  totalValue: 15000
});

// Track when a user views product details
window.MEMonitor?.track('business', 'product_detail_view', {
  styleId: 'ME-2024-CREW-BLK',
  category: 'T-Shirts'
});
```

---

### Using the Dashboard

1. Visit `monitor.markedwards.cloud` (or wherever you deploy it)
2. **Overview tab** — See key metrics, top features, device breakdown, search queries
3. **Feature Usage tab** — See every feature ranked by usage, filter usage, scroll depth
4. **UX Issues tab** — Rage clicks, dead clicks, JavaScript errors
5. **Performance tab** — Page load times, API response times, Core Web Vitals
6. **AI Recommendations tab** — Click "Run AI Analysis" to get Claude-powered recommendations
7. **Live Feed tab** — Watch events stream in real-time

### Scheduling Automated Analysis

Add a cron job or use Railway's cron feature to run analysis daily:

```bash
# Run AI analysis every morning at 8am
0 8 * * * curl -X POST https://monitor.markedwards.cloud/api/monitor/analyze?days=7
```

Or add to server.js:
```javascript
// Auto-analyze every 24 hours
setInterval(async () => {
  try {
    await fetch(`http://localhost:${PORT}/api/monitor/analyze?days=7`, { method: 'POST' });
    console.log('Automated AI analysis completed');
  } catch(err) {
    console.error('Automated analysis failed:', err);
  }
}, 24 * 60 * 60 * 1000);
```

---

### Data Retention

Consider adding cleanup for old events to keep the database manageable:

```sql
-- Delete events older than 90 days (run periodically)
DELETE FROM monitor_events WHERE created_at < NOW() - INTERVAL '90 days';

-- Keep recommendations forever (they're small)
-- Keep snapshots forever (for trending)
```

Add this as a daily cleanup in server.js:
```javascript
setInterval(async () => {
  await pool.query("DELETE FROM monitor_events WHERE created_at < NOW() - INTERVAL '90 days'");
  console.log('Old events cleaned up');
}, 24 * 60 * 60 * 1000);
```
