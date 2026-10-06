/**
 * Turns raw predictions into what the user reads: status, title, advice, and tips from the
 * linked Xeno device's live sensors (the part a photo-only app can't do). Pure; unit-tested.
 */
import type {
  DevicePublic,
  ScanAlternative,
  ScanCategory,
  ScanConditions,
  ScanSensorTip,
  ScanSeverity,
  ScanStatusKind,
} from '@xeno/shared';
import { CATEGORY_FALLBACK } from './catalog.js';
import { matchLabel } from './labels.js';
import type { Prediction } from './parse.js';

export interface Interpretation {
  status: ScanStatusKind;
  category: ScanCategory;
  severity: ScanSeverity;
  title: string;
  crop: string | null;
  condition: string | null;
  confidence: number | null;
  summary: string;
  treatment: string[];
  prevention: string[];
  alternatives: ScanAlternative[];
  rawLabel: string | null;
}

const pct = (c: number) => `${Math.round(c * 100)} %`;

export function interpret(
  d: { predictions: Prediction[]; isPlant: boolean | null; crop: string | null },
  minConfidence: number,
): Interpretation {
  const top = d.predictions[0];
  const alternatives = d.predictions
    .slice(1, 4)
    .filter((p): p is Prediction & { confidence: number } => p.confidence !== null && p.confidence >= 0.03)
    .map((p) => {
      const m = matchLabel(p.label, d.crop);
      return { label: [m.crop, m.condition?.name ?? m.displayName].filter(Boolean).join(' · '), confidence: p.confidence };
    });

  const notPlant = (): Interpretation => ({
    status: 'not_plant',
    category: 'unknown',
    severity: 'none',
    title: 'No leaf found',
    crop: null,
    condition: null,
    confidence: top?.confidence ?? null,
    summary: 'The model couldn’t find a plant leaf in this photo.',
    treatment: [],
    prevention: [],
    alternatives: [],
    rawLabel: top?.label ?? null,
  });

  if (d.isPlant === false || !top) return notPlant();
  const m = matchLabel(top.label, d.crop);
  if (m.notPlant) return notPlant();

  const healthy = m.category === 'healthy';
  const name = m.condition?.name ?? m.displayName;
  const info = m.condition ?? (healthy ? null : CATEGORY_FALLBACK[m.category as Exclude<ScanCategory, 'healthy'>]);
  const base = {
    crop: m.crop,
    condition: healthy ? null : name,
    confidence: top.confidence,
    treatment: info?.treatment ?? [],
    prevention: info?.prevention ?? [],
    alternatives,
    rawLabel: top.label,
  };

  if (top.confidence !== null && top.confidence < minConfidence) {
    return {
      ...base,
      status: 'uncertain',
      category: m.category,
      severity: 'none',
      title: 'Not sure',
      summary: `The model isn’t confident (${pct(top.confidence)}). Its best guess is ${healthy ? 'a healthy leaf' : name.toLowerCase()}${m.crop ? ` on ${m.crop.toLowerCase()}` : ''}. Retake the photo in daylight, with one leaf filling the frame.`,
      treatment: [],
    };
  }

  if (healthy) {
    return {
      ...base,
      status: 'healthy',
      category: 'healthy',
      severity: 'none',
      title: m.crop ? `Healthy ${m.crop.toLowerCase()} leaf` : 'Healthy leaf',
      summary: m.condition?.summary ?? 'No signs of disease on this leaf.',
    };
  }

  return {
    ...base,
    status: 'disease',
    category: m.category,
    severity: info?.severity ?? 'medium',
    title: name,
    summary: info?.summary ?? 'The model found a problem with this leaf.',
  };
}

/** Readings older than this are too stale to advise on. */
const FRESH_MS = 30 * 60_000;

export function gardenConditions(device: DevicePublic | null): ScanConditions | null {
  const l = device?.latest;
  if (!l) return null;
  return { soilMoisture: l.soilMoisture, temperature: l.temperature, humidity: l.humidity, rain: l.rain, at: l.ts };
}

export function sensorTips(
  category: ScanCategory,
  status: ScanStatusKind,
  device: DevicePublic | null,
  now: Date,
): ScanSensorTip[] {
  if (!device || status === 'not_plant') return [];
  const c = gardenConditions(device);
  if (!c?.at || now.getTime() - new Date(c.at).getTime() > FRESH_MS) {
    return [{ code: 'no_recent_data', tone: 'info', message: `No recent readings from ${device.name}. Turn it on to get advice based on your garden’s sensors.` }];
  }
  const s = device.desired.settings;
  const manual = device.desired.mode === 'manual';
  const fungalLike = category === 'fungal' || category === 'bacterial';
  const tips: ScanSensorTip[] = [];
  const { soilMoisture: soil, humidity: hum, temperature: temp, rain } = c;

  if (fungalLike && hum !== null && hum >= 80) {
    tips.push({ code: 'humid_air', tone: 'warning', message: `Air humidity is ${Math.round(hum)} %. This disease spreads fast in damp air: water the soil, never the leaves, and give the plant airflow.` });
  }
  if (fungalLike && rain) {
    tips.push({ code: 'rain', tone: 'warning', message: 'It is raining on the sensor. Wet leaves let spores spread, so remove infected leaves before the next rain.' });
  }
  if (fungalLike && soil !== null && soil > s.moistureHigh + 10) {
    tips.push({ code: 'soil_too_wet', tone: 'warning', message: `Soil is very wet (${Math.round(soil)} %). Too much water helps this disease. ${manual ? 'Switch Xeno to Auto so it waters only when needed.' : `Lower the Auto target below ${s.moistureHigh} % in device settings.`}` });
  }
  if (soil !== null && soil < s.moistureLow) {
    tips.push({ code: 'soil_dry', tone: 'warning', message: `Soil is dry (${Math.round(soil)} %). A thirsty plant fights disease worse. ${manual ? 'Tap Water now, or switch Xeno to Auto.' : 'Xeno will water it in Auto mode.'}` });
  }
  if (temp !== null && temp >= s.highTempC) {
    tips.push({ code: 'heat', tone: 'warning', message: `It is hot (${Math.round(temp)} °C). Heat stress makes leaves weaker: water in the morning and give some shade at midday.` });
  }
  if (category === 'pest' && temp !== null && temp >= 28 && hum !== null && hum < 45) {
    tips.push({ code: 'hot_dry_pests', tone: 'warning', message: `Hot, dry air (${Math.round(temp)} °C, ${Math.round(hum)} % humidity) is when mites multiply fastest. Mist under the leaves.` });
  }
  if (!tips.length) {
    const parts = [soil !== null ? `soil ${Math.round(soil)} %` : null, temp !== null ? `${Math.round(temp)} °C` : null, hum !== null ? `${Math.round(hum)} % humidity` : null].filter(Boolean).join(', ');
    tips.push(
      status === 'disease'
        ? { code: 'conditions_normal', tone: 'info', message: `Your garden sensors look normal${parts ? ` (${parts})` : ''}. Follow the treatment steps above.` }
        : { code: 'conditions_good', tone: 'good', message: `Garden conditions look good${parts ? `: ${parts}` : ''}.` },
    );
  }
  return tips;
}
