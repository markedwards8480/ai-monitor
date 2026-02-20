// ============================================================
// Mark Edwards Apparel — AI Monitor Server
// Collects usage events and generates AI-powered recommendations
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Database Setup ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ---- Anthropic Client ----
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ---- Initialize Database ----
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitor_events (
        id SERIAL PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        session_id VARCHAR(20),
        user_id VARCHAR(20),
        page VARCHAR(500),
        category VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        data JSONB DEFAULT '{}',
        viewport_width INT,
        viewport_height INT,
        device VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS monitor_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(20) UNIQUE NOT NULL,
        user_id VARCHAR(20),
        user_agent TEXT,
        screen_resolution VARCHAR(20),
        language VARCHAR(10),
        referrer TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        page_views INT DEFAULT 0,
        total_events INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS monitor_recommendations (
        id SERIAL PRIMARY KEY,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        category VARCHAR(50) NOT NULL,
        priority VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        evidence TEXT,
        impact VARCHAR(20),
        effort VARCHAR(20),
        status VARCHAR(20) DEFAULT 'new',
        ai_model VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS monitor_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot_date DATE UNIQUE NOT NULL,
        metrics JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON monitor_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_category ON monitor_events(category);
      CREATE INDEX IF NOT EXISTS idx_events_session ON monitor_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_created ON monitor_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_recommendations_status ON monitor_recommendations(status);
    `);
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// ---- Event Collection API ----
app.post('/api/monitor/events', async (req, res) => {
  try {
    const { batch, sessionMeta } = req.body;
    if (!batch || !Array.isArray(batch)) {
      return res.status(400).json({ error: 'Invalid batch' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert session
      if (sessionMeta) {
        await client.query(`
          INSERT INTO monitor_sessions (session_id, user_id, user_agent, screen_resolution, language, referrer, total_events)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (session_id) DO UPDATE SET
            last_activity = CURRENT_TIMESTAMP,
            total_events = monitor_sessions.total_events + $7
        `, [
          sessionMeta.sessionId,
          sessionMeta.userId,
          sessionMeta.userAgent,
          sessionMeta.screenResolution,
          sessionMeta.language,
          sessionMeta.referrer,
          batch.length
        ]);
      }

      // Insert events
      for (const event of batch) {
        await client.query(`
          INSERT INTO monitor_events (timestamp, session_id, user_id, page, category, action, data, viewport_width, viewport_height, device)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          event.timestamp,
          event.sessionId,
          event.userId,
          event.page,
          event.category,
          event.action,
          JSON.stringify(event.data || {}),
          event.viewport?.width,
          event.viewport?.height,
          event.device
        ]);
      }

      await client.query('COMMIT');
      res.json({ received: batch.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Event ingestion error:', err);
    res.status(500).json({ error: 'Failed to ingest events' });
  }
});

// ---- Analytics Queries ----

// Get overview metrics
app.get('/api/monitor/overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [
      totalEvents,
      totalSessions,
      uniqueUsers,
      featureUsage,
      topPages,
      uxIssues,
      performanceAvg,
      errorCount,
      deviceBreakdown,
      searchQueries,
      hourlyActivity
    ] = await Promise.all([
      // Total events
      pool.query(`SELECT COUNT(*) as count FROM monitor_events WHERE created_at >= $1`, [since]),
      // Total sessions
      pool.query(`SELECT COUNT(DISTINCT session_id) as count FROM monitor_events WHERE created_at >= $1`, [since]),
      // Unique users
      pool.query(`SELECT COUNT(DISTINCT user_id) as count FROM monitor_events WHERE created_at >= $1`, [since]),
      // Feature usage (clicks on features)
      pool.query(`
        SELECT data->>'feature' as feature, COUNT(*) as clicks,
               COUNT(DISTINCT session_id) as unique_sessions
        FROM monitor_events 
        WHERE category = 'feature' AND created_at >= $1 AND data->>'feature' IS NOT NULL
        GROUP BY data->>'feature'
        ORDER BY clicks DESC
        LIMIT 30
      `, [since]),
      // Top pages
      pool.query(`
        SELECT page, COUNT(*) as views, COUNT(DISTINCT session_id) as unique_sessions,
               AVG((data->>'timeOnPage')::float) as avg_time
        FROM monitor_events
        WHERE action = 'page_view' AND created_at >= $1
        GROUP BY page
        ORDER BY views DESC
        LIMIT 20
      `, [since]),
      // UX Issues (rage clicks, dead clicks)
      pool.query(`
        SELECT action, data->>'element' as element, data->>'text' as text,
               data->>'className' as class_name, COUNT(*) as occurrences,
               data->>'x' as x, data->>'y' as y
        FROM monitor_events
        WHERE category = 'ux_issue' AND created_at >= $1
        GROUP BY action, data->>'element', data->>'text', data->>'className', data->>'x', data->>'y'
        ORDER BY occurrences DESC
        LIMIT 20
      `, [since]),
      // Performance averages
      pool.query(`
        SELECT 
          AVG((data->>'fullLoad')::float) as avg_load_time,
          AVG((data->>'ttfb')::float) as avg_ttfb,
          AVG((data->>'domReady')::float) as avg_dom_ready,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (data->>'fullLoad')::float) as p95_load_time
        FROM monitor_events
        WHERE action = 'page_load' AND created_at >= $1
      `, [since]),
      // Error count
      pool.query(`
        SELECT data->>'message' as message, COUNT(*) as count
        FROM monitor_events
        WHERE category = 'error' AND created_at >= $1
        GROUP BY data->>'message'
        ORDER BY count DESC
        LIMIT 10
      `, [since]),
      // Device breakdown
      pool.query(`
        SELECT device, COUNT(DISTINCT session_id) as sessions
        FROM monitor_events
        WHERE created_at >= $1 AND device IS NOT NULL
        GROUP BY device
      `, [since]),
      // Search queries
      pool.query(`
        SELECT data->>'query' as query, COUNT(*) as count
        FROM monitor_events
        WHERE category = 'search' AND created_at >= $1 AND data->>'query' IS NOT NULL AND data->>'query' != ''
        GROUP BY data->>'query'
        ORDER BY count DESC
        LIMIT 20
      `, [since]),
      // Hourly activity pattern
      pool.query(`
        SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as events
        FROM monitor_events
        WHERE created_at >= $1
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour
      `, [since])
    ]);

    // Calculate scroll depth distribution
    const scrollDepth = await pool.query(`
      SELECT (data->>'depth')::int as depth, COUNT(*) as count
      FROM monitor_events
      WHERE action = 'scroll_depth' AND created_at >= $1
      GROUP BY (data->>'depth')::int
      ORDER BY depth
    `, [since]);

    // Filter usage (which filters are being used)
    const filterUsage = await pool.query(`
      SELECT data->>'label' as filter_label, data->>'name' as filter_name,
             data->>'value' as filter_value, COUNT(*) as uses
      FROM monitor_events
      WHERE category = 'filter' AND created_at >= $1
      GROUP BY data->>'label', data->>'name', data->>'value'
      ORDER BY uses DESC
      LIMIT 20
    `, [since]);

    // API performance
    const apiPerformance = await pool.query(`
      SELECT data->>'url' as url, 
             AVG((data->>'duration')::float) as avg_duration,
             COUNT(*) as calls,
             SUM(CASE WHEN data->>'ok' = 'true' THEN 0 ELSE 1 END) as errors
      FROM monitor_events
      WHERE action = 'api_call' AND created_at >= $1
      GROUP BY data->>'url'
      ORDER BY avg_duration DESC
      LIMIT 15
    `, [since]);

    res.json({
      period: { days, since },
      summary: {
        totalEvents: parseInt(totalEvents.rows[0].count),
        totalSessions: parseInt(totalSessions.rows[0].count),
        uniqueUsers: parseInt(uniqueUsers.rows[0].count),
        avgEventsPerSession: totalSessions.rows[0].count > 0 
          ? Math.round(totalEvents.rows[0].count / totalSessions.rows[0].count) 
          : 0
      },
      featureUsage: featureUsage.rows,
      topPages: topPages.rows,
      uxIssues: uxIssues.rows,
      performance: {
        averages: performanceAvg.rows[0],
        apiEndpoints: apiPerformance.rows
      },
      errors: errorCount.rows,
      devices: deviceBreakdown.rows,
      searchQueries: searchQueries.rows,
      scrollDepth: scrollDepth.rows,
      filterUsage: filterUsage.rows,
      hourlyActivity: hourlyActivity.rows
    });
  } catch (err) {
    console.error('Overview query error:', err);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// ---- AI Recommendation Engine ----
app.post('/api/monitor/analyze', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    
    // Gather all analytics data
    const overviewRes = await fetch(`http://localhost:${PORT}/api/monitor/overview?days=${days}`);
    const analytics = await overviewRes.json();

    // Build the analysis prompt
    const analysisPrompt = `You are an expert UX/UI analyst and product optimization consultant for an enterprise B2B product catalog application used by sales representatives at Mark Edwards Apparel (a ~$300M apparel company). The catalog is used to browse inventory, filter products by category/color/size, search for items, and share product info with retail buyers at stores like Burlington and Ross.

Here is the usage analytics data from the last ${days} days:

## Summary
- Total Events: ${analytics.summary.totalEvents}
- Total Sessions: ${analytics.summary.totalSessions}
- Unique Users: ${analytics.summary.uniqueUsers}
- Avg Events/Session: ${analytics.summary.avgEventsPerSession}

## Feature Usage (what's being clicked)
${JSON.stringify(analytics.featureUsage, null, 2)}

## Top Pages
${JSON.stringify(analytics.topPages, null, 2)}

## UX Issues (rage clicks, dead clicks)
${JSON.stringify(analytics.uxIssues, null, 2)}

## Performance
${JSON.stringify(analytics.performance, null, 2)}

## JavaScript Errors
${JSON.stringify(analytics.errors, null, 2)}

## Device Breakdown
${JSON.stringify(analytics.devices, null, 2)}

## Search Queries (what users are searching for)
${JSON.stringify(analytics.searchQueries, null, 2)}

## Scroll Depth Distribution
${JSON.stringify(analytics.scrollDepth, null, 2)}

## Filter Usage
${JSON.stringify(analytics.filterUsage, null, 2)}

## Hourly Activity Pattern
${JSON.stringify(analytics.hourlyActivity, null, 2)}

Based on this data, provide a comprehensive analysis with specific, actionable recommendations. For each recommendation, include:
1. Category (one of: feature_removal, feature_improvement, new_feature, performance, ux_fix, ui_improvement, workflow, accessibility)
2. Priority (critical, high, medium, low)
3. Title (concise)
4. Description (detailed explanation of the issue and recommended fix)
5. Evidence (specific data points that support this recommendation)
6. Impact (high, medium, low - expected impact on user experience)
7. Effort (high, medium, low - estimated implementation effort)

Also identify:
- Features that appear to be NEVER or RARELY used (candidates for removal/simplification)
- Areas where users seem confused or frustrated (based on rage clicks, dead clicks, navigation patterns)
- Performance bottlenecks that affect user experience
- Workflow improvements that could save time for sales reps
- Search patterns that suggest missing features or content gaps
- Mobile vs desktop usage patterns that suggest responsive design needs

Format your response as JSON:
{
  "overallScore": <1-100 score of current app health>,
  "summary": "<2-3 sentence executive summary>",
  "keyInsights": ["<insight 1>", "<insight 2>", ...],
  "recommendations": [
    {
      "category": "<category>",
      "priority": "<priority>",
      "title": "<title>",
      "description": "<description>",
      "evidence": "<evidence>",
      "impact": "<high|medium|low>",
      "effort": "<high|medium|low>"
    }
  ],
  "unusedFeatures": ["<feature 1>", "<feature 2>", ...],
  "frustrationPoints": ["<point 1>", "<point 2>", ...],
  "positivePatterns": ["<pattern 1>", "<pattern 2>", ...]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    let analysis;
    const responseText = message.content[0].text;
    
    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/```json?\s*([\s\S]*?)```/) || 
                      responseText.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[1]);
    } else {
      analysis = JSON.parse(responseText);
    }

    // Save recommendations to database
    if (analysis.recommendations) {
      for (const rec of analysis.recommendations) {
        await pool.query(`
          INSERT INTO monitor_recommendations (category, priority, title, description, evidence, impact, effort, ai_model)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [rec.category, rec.priority, rec.title, rec.description, rec.evidence, rec.impact, rec.effort, 'claude-sonnet-4']);
      }
    }

    // Save daily snapshot
    await pool.query(`
      INSERT INTO monitor_snapshots (snapshot_date, metrics)
      VALUES (CURRENT_DATE, $1)
      ON CONFLICT (snapshot_date) DO UPDATE SET metrics = $1
    `, [JSON.stringify({
      ...analytics.summary,
      overallScore: analysis.overallScore,
      recommendations: analysis.recommendations?.length || 0
    })]);

    res.json(analysis);
  } catch (err) {
    console.error('AI analysis error:', err);
    res.status(500).json({ error: 'Failed to generate analysis', details: err.message });
  }
});

// Get saved recommendations
app.get('/api/monitor/recommendations', async (req, res) => {
  try {
    const status = req.query.status || 'all';
    let query = 'SELECT * FROM monitor_recommendations ORDER BY generated_at DESC';
    let params = [];
    
    if (status !== 'all') {
      query = 'SELECT * FROM monitor_recommendations WHERE status = $1 ORDER BY generated_at DESC';
      params = [status];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// Update recommendation status
app.patch('/api/monitor/recommendations/:id', async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query(
      'UPDATE monitor_recommendations SET status = $1 WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update recommendation' });
  }
});

// Get historical snapshots for trending
app.get('/api/monitor/trends', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const result = await pool.query(`
      SELECT * FROM monitor_snapshots 
      WHERE snapshot_date >= CURRENT_DATE - $1::int
      ORDER BY snapshot_date ASC
    `, [days]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// Get real-time event stream (last N minutes)
app.get('/api/monitor/live', async (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 5;
    const result = await pool.query(`
      SELECT category, action, page, data, device, created_at
      FROM monitor_events
      WHERE created_at >= NOW() - ($1 || ' minutes')::interval
      ORDER BY created_at DESC
      LIMIT 100
    `, [minutes]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live events' });
  }
});

// ---- Serve Dashboard ----
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3500;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AI Monitor running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
