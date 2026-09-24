/**
 * Rule-based plant-health provider: explainable heuristics over the last days of hourly data.
 * Each finding has a stable `code` the app can map to icons/copy; an ML provider may reuse them.
 */
import type { HealthFinding, HealthStatus } from '@xeno/shared';
import type { HealthInput, HealthResult, PlantHealthProvider } from './provider.js';

const MIN_HOURS = 12;
const WEIGHT = { info: 0, warning: 15, critical: 35 } as const;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const hours = (n: number) => (n === 1 ? '1 hour' : `${n} hours`);

function stdDev(v: number[]) {
  if (v.length < 2) return 0;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
}

export class RuleBasedHealthProvider implements PlantHealthProvider {
  readonly name = 'rules';
  readonly version = '1.0.0';

  async evaluate(input: HealthInput): Promise<HealthResult> {
    const pts = input.readings;
    const soilPts = pts.filter((p) => p.soilMoisture !== null);
    if (!input.device || soilPts.length < MIN_HOURS) {
      return {
        score: null,
        status: 'unknown',
        summary: input.device
          ? 'Not enough data yet. Check back after the device has been online for about half a day.'
          : 'Link this plant to a device to start health checks.',
        findings: [],
      };
    }

    const s = input.device.settings;
    const findings: HealthFinding[] = [];
    const soil = soilPts.map((p) => p.soilMoisture!);
    const dryHours = soilPts.filter((p) => p.soilMoisture! < s.moistureLow).length;
    const soggyLimit = Math.min(95, Math.max(s.moistureHigh + 25, 80));
    const soggyHours = soilPts.filter((p) => p.soilMoisture! > soggyLimit).length;
    const inZone = soilPts.filter((p) => p.soilMoisture! >= s.moistureLow && p.soilMoisture! <= s.moistureHigh + 10).length;
    const hotHours = pts.filter((p) => p.temperature !== null && p.temperature >= s.highTempC).length;
    const gapShare = 1 - soilPts.length / Math.max(1, pts.length);
    const days = Math.max(1, (input.window.to.getTime() - input.window.from.getTime()) / 86_400_000);
    const sessionsPerDay = input.pumpEvents.length / days;
    const safetyStops = input.pumpEvents.filter((e) => e.stopReason === 'max_runtime').length;
    const swing = stdDev(soil);
    const confidence = Math.min(0.95, 0.5 + soilPts.length / 200);

    if (dryHours > 24) {
      findings.push({ code: 'dry_spells', severity: 'critical', confidence, message: `Soil was below your ${s.moistureLow}% target for ${hours(dryHours)}. The plant is likely stressed; check the water supply.` });
    } else if (dryHours > 6) {
      findings.push({ code: 'dry_spells', severity: 'warning', confidence, message: `Soil dipped below ${s.moistureLow}% for ${hours(dryHours)} this period.` });
    }
    if (soggyHours > 12) {
      findings.push({ code: 'waterlogging', severity: soggyHours > 48 ? 'critical' : 'warning', confidence, message: `Soil stayed very wet (above ${soggyLimit}%) for ${hours(soggyHours)}. Roots need air; consider a lower target or better drainage.` });
    }
    if (safetyStops > 0) {
      findings.push({ code: 'pump_safety_stops', severity: 'warning', confidence: 0.9, message: `The pump hit its safety time limit ${safetyStops}× without wetting the soil. The tank may be empty or a hose blocked.` });
    }
    if (sessionsPerDay > 12) {
      findings.push({ code: 'frequent_watering', severity: 'warning', confidence: 0.8, message: `Watering about ${Math.round(sessionsPerDay)} times a day is unusual. Check the sensor sits deep enough in the soil.` });
    }
    if (hotHours > 4) {
      findings.push({ code: 'heat_stress', severity: hotHours > 20 ? 'critical' : 'warning', confidence, message: `It was ${s.highTempC}°C or hotter for ${hours(hotHours)}. Afternoon shade helps.` });
    }
    if (swing > 15) {
      findings.push({ code: 'moisture_unstable', severity: 'info', confidence: 0.7, message: 'Moisture swings a lot between waterings. Mulch or smaller, more frequent watering keeps it steadier.' });
    }
    if (gapShare > 0.2) {
      findings.push({ code: 'sensor_gaps', severity: 'info', confidence: 0.9, message: `About ${Math.round(gapShare * 100)}% of readings are missing. Check WiFi range and the sensor cable.` });
    }
    const zoneShare = pct(inZone, soilPts.length);
    if (!findings.some((f) => f.severity !== 'info')) {
      findings.unshift({ code: 'moisture_on_target', severity: 'info', confidence, message: `Moisture stayed in the comfort zone ${zoneShare}% of the time. Nice work.` });
    }

    const score = Math.max(0, Math.min(100, 100 - findings.reduce((a, f) => a + WEIGHT[f.severity], 0) - (zoneShare < 60 ? 10 : 0)));
    const status: HealthStatus = findings.some((f) => f.severity === 'critical') || score < 40
      ? 'critical'
      : findings.some((f) => f.severity === 'warning') || score < 75
        ? 'attention'
        : 'healthy';
    const summary =
      status === 'healthy'
        ? `${input.plant.name} is doing well: steady moisture and no warning signs.`
        : status === 'attention'
          ? `${input.plant.name} is mostly fine, but a few things need a look.`
          : `${input.plant.name} needs attention soon.`;
    return { score, status, summary, findings };
  }
}
