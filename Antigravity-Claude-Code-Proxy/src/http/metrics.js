// @ts-check
/**
 * Minimal Prometheus metrics registry (text exposition format 0.0.4), no dependencies.
 * Exposed at GET /metrics.
 */

/** @typedef {Record<string, string | number>} Labels */
/** @typedef {{labels: Labels, value: number}} Sample */

/**
 * @param {string} value
 * @returns {string}
 */
function escapeLabel(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * @param {Labels} labels
 * @returns {string} `{a="1",b="2"}` or '' when empty
 */
function formatLabels(labels) {
    const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(String(v))}"`);
    return parts.length ? `{${parts.join(',')}}` : '';
}

class Metric {
    /**
     * @param {string} name
     * @param {string} help
     * @param {string} type
     * @param {string[]} labelNames
     */
    constructor(name, help, type, labelNames) {
        this.name = name;
        this.help = help;
        this.type = type;
        this.labelNames = labelNames;
    }

    /**
     * Normalise labels to the declared order and reject unknown names.
     * @param {Labels} labels
     * @returns {{key: string, labels: Labels}}
     */
    resolve(labels) {
        for (const k of Object.keys(labels)) {
            if (!this.labelNames.includes(k)) throw new Error(`${this.name}: unknown label "${k}"`);
        }
        /** @type {Labels} */
        const ordered = {};
        for (const k of this.labelNames) ordered[k] = labels[k] ?? '';
        return { key: JSON.stringify(ordered), labels: ordered };
    }

    /** @returns {string[]} */
    header() {
        return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
    }
}

export class Counter extends Metric {
    /**
     * @param {string} name
     * @param {string} help
     * @param {string[]} [labelNames]
     */
    constructor(name, help, labelNames = []) {
        super(name, help, 'counter', labelNames);
        /** @type {Map<string, Sample>} */
        this.samples = new Map();
    }

    /**
     * @param {Labels} [labels]
     * @param {number} [value=1]
     */
    inc(labels = {}, value = 1) {
        if (value < 0) throw new RangeError('counters can only increase');
        const { key, labels: ordered } = this.resolve(labels);
        const sample = this.samples.get(key) ?? { labels: ordered, value: 0 };
        sample.value += value;
        this.samples.set(key, sample);
    }

    /** @returns {string[]} */
    render() {
        if (this.samples.size === 0 && this.labelNames.length === 0) return [...this.header(), `${this.name} 0`];
        return [
            ...this.header(),
            ...[...this.samples.values()].map(s => `${this.name}${formatLabels(s.labels)} ${s.value}`)
        ];
    }
}

export class Gauge extends Metric {
    /**
     * @param {string} name
     * @param {string} help
     * @param {string[]} [labelNames]
     * @param {() => Sample[]} [collect] - Called at scrape time instead of using set()
     */
    constructor(name, help, labelNames = [], collect) {
        super(name, help, 'gauge', labelNames);
        /** @type {Map<string, Sample>} */
        this.samples = new Map();
        this.collect = collect;
    }

    /**
     * @param {Labels} labels
     * @param {number} value
     */
    set(labels, value) {
        const { key, labels: ordered } = this.resolve(labels);
        this.samples.set(key, { labels: ordered, value });
    }

    /** @returns {string[]} */
    render() {
        const samples = this.collect ? this.collect() : [...this.samples.values()];
        return [...this.header(), ...samples.map(s => `${this.name}${formatLabels(s.labels)} ${s.value}`)];
    }
}

export class Histogram extends Metric {
    /**
     * @param {string} name
     * @param {string} help
     * @param {string[]} [labelNames]
     * @param {number[]} [buckets] - Upper bounds in ascending order
     */
    constructor(name, help, labelNames = [], buckets = [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]) {
        super(name, help, 'histogram', labelNames);
        this.buckets = buckets;
        /** @type {Map<string, {labels: Labels, counts: number[], sum: number, count: number}>} */
        this.series = new Map();
    }

    /**
     * @param {Labels} labels
     * @param {number} value
     */
    observe(labels, value) {
        const { key, labels: ordered } = this.resolve(labels);
        const s = this.series.get(key) ?? { labels: ordered, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
        this.buckets.forEach((le, i) => {
            if (value <= le) s.counts[i]++;
        });
        s.sum += value;
        s.count++;
        this.series.set(key, s);
    }

    /** @returns {string[]} */
    render() {
        const lines = this.header();
        for (const s of this.series.values()) {
            this.buckets.forEach((le, i) => {
                lines.push(`${this.name}_bucket${formatLabels({ ...s.labels, le })} ${s.counts[i]}`);
            });
            lines.push(`${this.name}_bucket${formatLabels({ ...s.labels, le: '+Inf' })} ${s.count}`);
            lines.push(`${this.name}_sum${formatLabels(s.labels)} ${Number(s.sum.toFixed(6))}`);
            lines.push(`${this.name}_count${formatLabels(s.labels)} ${s.count}`);
        }
        return lines;
    }
}

export class Registry {
    constructor() {
        /** @type {Map<string, Counter | Gauge | Histogram>} */
        this.metrics = new Map();
    }

    /**
     * @template {Counter | Gauge | Histogram} M
     * @param {M} metric
     * @returns {M}
     */
    register(metric) {
        if (this.metrics.has(metric.name)) throw new Error(`metric ${metric.name} already registered`);
        this.metrics.set(metric.name, metric);
        return metric;
    }

    /**
     * @param {string} name
     * @param {string} help
     * @param {string[]} [labelNames]
     */
    counter(name, help, labelNames) {
        return this.register(new Counter(name, help, labelNames));
    }

    /**
     * @param {string} name
     * @param {string} help
     * @param {string[]} [labelNames]
     * @param {() => Sample[]} [collect]
     */
    gauge(name, help, labelNames, collect) {
        return this.register(new Gauge(name, help, labelNames, collect));
    }

    /**
     * @param {string} name
     * @param {string} help
     * @param {string[]} [labelNames]
     * @param {number[]} [buckets]
     */
    histogram(name, help, labelNames, buckets) {
        return this.register(new Histogram(name, help, labelNames, buckets));
    }

    /** @returns {string} Prometheus text exposition */
    render() {
        return [...this.metrics.values()].flatMap(m => m.render()).join('\n') + '\n';
    }
}

/**
 * Express middleware recording request count and latency per matched route.
 * Unmatched paths share one label value so random URLs cannot blow up cardinality.
 * @param {{requests: Counter, duration: Histogram}} instruments
 * @returns {(req: any, res: any, next: () => void) => void}
 */
export function createMetricsMiddleware({ requests, duration }) {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
            const seconds = Number(process.hrtime.bigint() - start) / 1e9;
            requests.inc({ method: req.method, route, status: res.statusCode });
            duration.observe({ method: req.method, route }, seconds);
        });
        next();
    };
}

/** Process-wide registry and the proxy's instruments. */
export const registry = new Registry();
const startedAt = Date.now();

export const metrics = {
    httpRequests: registry.counter('proxy_http_requests_total', 'HTTP requests handled by the proxy', [
        'method',
        'route',
        'status'
    ]),
    httpDuration: registry.histogram('proxy_http_request_duration_seconds', 'HTTP request latency in seconds', [
        'method',
        'route'
    ]),
    upstreamRetries: registry.counter(
        'proxy_upstream_retries_total',
        'Upstream calls retried after a transient failure (5xx, timeout, network)',
        ['reason']
    ),
    /** Replaced by the server with a collector reading the account pool. */
    accounts: registry.gauge('proxy_accounts', 'Accounts in the pool by state', ['state'], () => accountSamples()),
    uptime: registry.gauge('process_uptime_seconds', 'Seconds since the proxy started', [], () => [
        { labels: {}, value: Math.round((Date.now() - startedAt) / 1000) }
    ]),
    heap: registry.gauge('nodejs_heap_used_bytes', 'V8 heap in use', [], () => [
        { labels: {}, value: process.memoryUsage().heapUsed }
    ])
};

/** @type {() => Sample[]} */
let accountSamples = () => [];

/**
 * Let the server plug in the account pool without this module importing it.
 * @param {() => Sample[]} collector
 */
export function setAccountCollector(collector) {
    accountSamples = collector;
}

export const metricsMiddleware = createMetricsMiddleware({
    requests: metrics.httpRequests,
    duration: metrics.httpDuration
});
