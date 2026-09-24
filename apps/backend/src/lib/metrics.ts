/**
 * Tiny in-process metrics registry exposed in Prometheus text format at /v1/metrics.
 * No dependency needed; enough for dashboards/alerts on requests, MQTT traffic and devices.
 */
type Labels = Record<string, string>;

const key = (name: string, labels: Labels) => {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
};

export class Metrics {
  private counters = new Map<string, { name: string; help: string; values: Map<string, number> }>();
  private gauges = new Map<string, { help: string; read: () => number }>();

  counter(name: string, help: string) {
    if (!this.counters.has(name)) this.counters.set(name, { name, help, values: new Map() });
    const c = this.counters.get(name)!;
    return {
      inc: (labels: Labels = {}, by = 1) => {
        const k = key(name, labels);
        c.values.set(k, (c.values.get(k) ?? 0) + by);
      },
      get: (labels: Labels = {}) => c.values.get(key(name, labels)) ?? 0,
    };
  }

  /** Gauge computed on scrape. */
  gauge(name: string, help: string, read: () => number) {
    this.gauges.set(name, { help, read });
  }

  render(): string {
    const lines: string[] = [];
    for (const c of this.counters.values()) {
      lines.push(`# HELP ${c.name} ${c.help}`, `# TYPE ${c.name} counter`);
      if (!c.values.size) lines.push(`${c.name} 0`);
      for (const [k, v] of c.values) lines.push(`${k} ${v}`);
    }
    for (const [name, g] of this.gauges) {
      let v: number;
      try {
        v = g.read();
      } catch {
        v = Number.NaN;
      }
      lines.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`, `${name} ${v}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export function createAppMetrics() {
  const m = new Metrics();
  return {
    registry: m,
    httpRequests: m.counter('xg_http_requests_total', 'HTTP requests by method and status class'),
    mqttMessages: m.counter('xg_mqtt_messages_total', 'Device MQTT messages received by kind'),
    mqttDropped: m.counter('xg_mqtt_messages_dropped_total', 'Device MQTT messages rejected (invalid/oversized/unknown device)'),
    busErrors: m.counter('xg_bus_listener_errors_total', 'Failures inside domain event listeners'),
    alertsRaised: m.counter('xg_alerts_raised_total', 'Alerts opened by type'),
    pushSent: m.counter('xg_push_sent_total', 'Push notifications sent by outcome'),
  };
}
export type AppMetrics = ReturnType<typeof createAppMetrics>;
