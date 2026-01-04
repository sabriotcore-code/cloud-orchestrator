/**
 * SYSTEM MONITORING SUITE
 *
 * Distributed tracing + performance monitoring:
 * - Request tracing with span IDs
 * - Performance metrics collection
 * - Error tracking and alerting
 * - Resource usage monitoring
 * - SLA tracking
 */

import * as db from '../db/index.js';

// ============================================================================
// DISTRIBUTED TRACING
// ============================================================================

const activeTraces = new Map();

/**
 * Start a new trace
 */
export function startTrace(name, metadata = {}) {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const trace = {
    id: traceId,
    name,
    startTime: Date.now(),
    spans: [],
    metadata,
    status: 'active'
  };

  activeTraces.set(traceId, trace);

  return {
    traceId,
    startSpan: (spanName) => startSpan(traceId, spanName),
    endTrace: () => endTrace(traceId),
    addMetadata: (key, value) => {
      trace.metadata[key] = value;
    }
  };
}

/**
 * Start a span within a trace
 */
export function startSpan(traceId, name) {
  const trace = activeTraces.get(traceId);
  if (!trace) return null;

  const spanId = `span_${trace.spans.length}_${Date.now()}`;
  const span = {
    id: spanId,
    name,
    startTime: Date.now(),
    endTime: null,
    duration: null,
    status: 'active',
    events: [],
    attributes: {}
  };

  trace.spans.push(span);

  return {
    spanId,
    addEvent: (event) => {
      span.events.push({ event, time: Date.now() });
    },
    setAttribute: (key, value) => {
      span.attributes[key] = value;
    },
    setStatus: (status) => {
      span.status = status;
    },
    end: () => {
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
      span.status = span.status === 'active' ? 'completed' : span.status;
    }
  };
}

/**
 * End a trace
 */
export function endTrace(traceId) {
  const trace = activeTraces.get(traceId);
  if (!trace) return null;

  trace.endTime = Date.now();
  trace.duration = trace.endTime - trace.startTime;
  trace.status = 'completed';

  // Close any open spans
  trace.spans.forEach(span => {
    if (!span.endTime) {
      span.endTime = trace.endTime;
      span.duration = span.endTime - span.startTime;
      span.status = 'auto-closed';
    }
  });

  // Store for analysis
  storeTrace(trace);

  activeTraces.delete(traceId);

  return trace;
}

/**
 * Get active traces
 */
export function getActiveTraces() {
  return Array.from(activeTraces.values()).map(t => ({
    id: t.id,
    name: t.name,
    duration: Date.now() - t.startTime,
    spanCount: t.spans.length
  }));
}

// ============================================================================
// PERFORMANCE METRICS
// ============================================================================

const metrics = {
  counters: {},
  gauges: {},
  histograms: {},
  timers: {}
};

/**
 * Increment a counter
 */
export function incrementCounter(name, value = 1, tags = {}) {
  const key = buildMetricKey(name, tags);
  metrics.counters[key] = (metrics.counters[key] || 0) + value;
  return metrics.counters[key];
}

/**
 * Set a gauge value
 */
export function setGauge(name, value, tags = {}) {
  const key = buildMetricKey(name, tags);
  metrics.gauges[key] = {
    value,
    timestamp: Date.now()
  };
  return value;
}

/**
 * Record histogram value
 */
export function recordHistogram(name, value, tags = {}) {
  const key = buildMetricKey(name, tags);
  if (!metrics.histograms[key]) {
    metrics.histograms[key] = {
      values: [],
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity
    };
  }

  const hist = metrics.histograms[key];
  hist.values.push(value);
  hist.count++;
  hist.sum += value;
  hist.min = Math.min(hist.min, value);
  hist.max = Math.max(hist.max, value);

  // Keep only last 1000 values for percentile calculation
  if (hist.values.length > 1000) {
    hist.values = hist.values.slice(-1000);
  }

  return hist;
}

/**
 * Start a timer
 */
export function startTimer(name, tags = {}) {
  const key = buildMetricKey(name, tags);
  const startTime = Date.now();

  return {
    end: () => {
      const duration = Date.now() - startTime;
      recordHistogram(name, duration, tags);
      return duration;
    }
  };
}

/**
 * Build metric key with tags
 */
function buildMetricKey(name, tags) {
  const tagStr = Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  return tagStr ? `${name}{${tagStr}}` : name;
}

/**
 * Get all metrics
 */
export function getAllMetrics() {
  return {
    counters: { ...metrics.counters },
    gauges: Object.fromEntries(
      Object.entries(metrics.gauges).map(([k, v]) => [k, v.value])
    ),
    histograms: Object.fromEntries(
      Object.entries(metrics.histograms).map(([k, v]) => [k, {
        count: v.count,
        sum: v.sum,
        min: v.min === Infinity ? 0 : v.min,
        max: v.max === -Infinity ? 0 : v.max,
        avg: v.count > 0 ? v.sum / v.count : 0,
        p50: percentile(v.values, 50),
        p95: percentile(v.values, 95),
        p99: percentile(v.values, 99)
      }])
    ),
    collectedAt: new Date().toISOString()
  };
}

/**
 * Calculate percentile
 */
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Reset metrics
 */
export function resetMetrics() {
  metrics.counters = {};
  metrics.gauges = {};
  metrics.histograms = {};
  metrics.timers = {};
}

// ============================================================================
// ERROR TRACKING
// ============================================================================

const recentErrors = [];
const errorCounts = {};

/**
 * Track an error
 */
export function trackError(error, context = {}) {
  const errorInfo = {
    message: error.message || String(error),
    stack: error.stack,
    name: error.name || 'Error',
    context,
    timestamp: new Date().toISOString(),
    id: `err_${Date.now()}_${Math.random().toString(36).substring(7)}`
  };

  // Add to recent errors
  recentErrors.unshift(errorInfo);
  if (recentErrors.length > 100) {
    recentErrors.pop();
  }

  // Increment error count by type
  const errorType = error.name || 'UnknownError';
  errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;

  // Increment counter metric
  incrementCounter('errors_total', 1, { type: errorType });

  return errorInfo;
}

/**
 * Get recent errors
 */
export function getRecentErrors(limit = 20) {
  return recentErrors.slice(0, limit);
}

/**
 * Get error statistics
 */
export function getErrorStats() {
  const last24h = recentErrors.filter(e =>
    new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
  );

  const byType = {};
  last24h.forEach(e => {
    byType[e.name] = (byType[e.name] || 0) + 1;
  });

  return {
    total: errorCounts,
    last24h: last24h.length,
    byType,
    topErrors: Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }))
  };
}

// ============================================================================
// RESOURCE MONITORING
// ============================================================================

/**
 * Get system resource usage
 */
export function getResourceUsage() {
  const used = process.memoryUsage();

  return {
    memory: {
      heapUsed: Math.round(used.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(used.heapTotal / 1024 / 1024) + ' MB',
      external: Math.round(used.external / 1024 / 1024) + ' MB',
      rss: Math.round(used.rss / 1024 / 1024) + ' MB',
      percentUsed: ((used.heapUsed / used.heapTotal) * 100).toFixed(1) + '%'
    },
    uptime: {
      seconds: Math.round(process.uptime()),
      formatted: formatUptime(process.uptime())
    },
    activeTraces: activeTraces.size,
    recentErrors: recentErrors.length
  };
}

/**
 * Format uptime
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);

  return parts.join(' ') || '< 1m';
}

// ============================================================================
// SLA TRACKING
// ============================================================================

const slaMetrics = {
  requests: { total: 0, successful: 0, failed: 0 },
  latencies: [],
  windows: {} // Sliding windows for SLA calculation
};

/**
 * Record SLA metric
 */
export function recordSLAMetric(success, latency, endpoint = 'default') {
  slaMetrics.requests.total++;
  if (success) {
    slaMetrics.requests.successful++;
  } else {
    slaMetrics.requests.failed++;
  }

  slaMetrics.latencies.push({ latency, timestamp: Date.now(), endpoint });

  // Keep only last 10000 latencies
  if (slaMetrics.latencies.length > 10000) {
    slaMetrics.latencies = slaMetrics.latencies.slice(-10000);
  }

  // Update sliding window
  const windowKey = new Date().toISOString().substring(0, 13); // Hour granularity
  if (!slaMetrics.windows[windowKey]) {
    slaMetrics.windows[windowKey] = { total: 0, successful: 0, latencySum: 0 };
  }
  const window = slaMetrics.windows[windowKey];
  window.total++;
  if (success) window.successful++;
  window.latencySum += latency;

  // Clean old windows (keep last 24 hours)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().substring(0, 13);
  Object.keys(slaMetrics.windows).forEach(key => {
    if (key < cutoff) delete slaMetrics.windows[key];
  });
}

/**
 * Get SLA report
 */
export function getSLAReport(options = {}) {
  const { latencyThreshold = 1000 } = options; // 1 second

  const { requests, latencies } = slaMetrics;

  // Calculate availability
  const availability = requests.total > 0
    ? ((requests.successful / requests.total) * 100).toFixed(2)
    : '100.00';

  // Calculate latency SLA (% under threshold)
  const underThreshold = latencies.filter(l => l.latency <= latencyThreshold).length;
  const latencySLA = latencies.length > 0
    ? ((underThreshold / latencies.length) * 100).toFixed(2)
    : '100.00';

  // Calculate percentiles
  const sortedLatencies = latencies.map(l => l.latency).sort((a, b) => a - b);

  return {
    availability: availability + '%',
    latencySLA: latencySLA + '% under ' + latencyThreshold + 'ms',
    requests: {
      total: requests.total,
      successful: requests.successful,
      failed: requests.failed
    },
    latency: {
      p50: percentile(sortedLatencies, 50) + 'ms',
      p95: percentile(sortedLatencies, 95) + 'ms',
      p99: percentile(sortedLatencies, 99) + 'ms',
      avg: sortedLatencies.length > 0
        ? Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length) + 'ms'
        : '0ms'
    },
    hourlyBreakdown: Object.entries(slaMetrics.windows).map(([hour, data]) => ({
      hour,
      availability: ((data.successful / data.total) * 100).toFixed(1) + '%',
      avgLatency: Math.round(data.latencySum / data.total) + 'ms',
      requests: data.total
    }))
  };
}

// ============================================================================
// STORAGE
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS traces (
        id SERIAL PRIMARY KEY,
        trace_id VARCHAR(100),
        name TEXT,
        duration INTEGER,
        span_count INTEGER,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`CREATE INDEX IF NOT EXISTS idx_traces_created ON traces(created_at DESC)`);
    schemaReady = true;
  } catch (e) {
    console.error('[Monitoring] Schema error:', e.message);
  }
}

/**
 * Store trace for analysis
 */
async function storeTrace(trace) {
  await ensureSchema();

  try {
    await db.query(`
      INSERT INTO traces (trace_id, name, duration, span_count, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [trace.id, trace.name, trace.duration, trace.spans.length, JSON.stringify(trace.metadata)]);
  } catch (e) {
    console.error('[Monitoring] Failed to store trace:', e.message);
  }
}

/**
 * Get trace history
 */
export async function getTraceHistory(limit = 50) {
  await ensureSchema();

  const result = await db.query(`
    SELECT trace_id, name, duration, span_count, created_at
    FROM traces
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Get health summary
 */
export function getHealthSummary() {
  const resources = getResourceUsage();
  const errors = getErrorStats();
  const sla = getSLAReport();
  const allMetrics = getAllMetrics();

  return {
    status: errors.last24h > 100 ? 'degraded' : 'healthy',
    uptime: resources.uptime.formatted,
    memory: resources.memory.percentUsed,
    errorRate: sla.requests.total > 0
      ? ((sla.requests.failed / sla.requests.total) * 100).toFixed(2) + '%'
      : '0%',
    availability: sla.availability,
    p95Latency: sla.latency.p95,
    activeTraces: resources.activeTraces,
    counters: Object.keys(allMetrics.counters).length,
    timestamp: new Date().toISOString()
  };
}

export default {
  // Tracing
  startTrace,
  startSpan,
  endTrace,
  getActiveTraces,
  getTraceHistory,

  // Metrics
  incrementCounter,
  setGauge,
  recordHistogram,
  startTimer,
  getAllMetrics,
  resetMetrics,

  // Errors
  trackError,
  getRecentErrors,
  getErrorStats,

  // Resources
  getResourceUsage,

  // SLA
  recordSLAMetric,
  getSLAReport,

  // Summary
  getHealthSummary
};
