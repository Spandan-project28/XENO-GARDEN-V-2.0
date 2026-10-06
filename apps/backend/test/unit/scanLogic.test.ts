import type { DevicePublic } from '@xeno/shared';
import { defaultSettings } from '@xeno/shared';
import { describe, expect, it } from 'vitest';
import { interpret, sensorTips } from '../../src/modules/scans/advice.js';
import { CONDITIONS } from '../../src/modules/scans/catalog.js';
import { loadScanConfig } from '../../src/modules/scans/config.js';
import { matchLabel } from '../../src/modules/scans/labels.js';
import { parseModelResponse } from '../../src/modules/scans/parse.js';

/** All 38 PlantVillage class names, exactly as the dataset spells them. */
const PLANT_VILLAGE: [string, string | null, string][] = [
  ['Apple___Apple_scab', 'Apple', 'apple_scab'],
  ['Apple___Black_rot', 'Apple', 'black_rot'],
  ['Apple___Cedar_apple_rust', 'Apple', 'cedar_apple_rust'],
  ['Apple___healthy', 'Apple', 'healthy'],
  ['Blueberry___healthy', 'Blueberry', 'healthy'],
  ['Cherry_(including_sour)___Powdery_mildew', 'Cherry', 'powdery_mildew'],
  ['Cherry_(including_sour)___healthy', 'Cherry', 'healthy'],
  ['Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot', 'Corn', 'gray_leaf_spot'],
  ['Corn_(maize)___Common_rust_', 'Corn', 'common_rust'],
  ['Corn_(maize)___Northern_Leaf_Blight', 'Corn', 'northern_leaf_blight'],
  ['Corn_(maize)___healthy', 'Corn', 'healthy'],
  ['Grape___Black_rot', 'Grape', 'black_rot'],
  ['Grape___Esca_(Black_Measles)', 'Grape', 'esca'],
  ['Grape___Leaf_blight_(Isariopsis_Leaf_Spot)', 'Grape', 'grape_leaf_blight'],
  ['Grape___healthy', 'Grape', 'healthy'],
  ['Orange___Haunglongbing_(Citrus_greening)', 'Orange', 'citrus_greening'],
  ['Peach___Bacterial_spot', 'Peach', 'bacterial_spot'],
  ['Peach___healthy', 'Peach', 'healthy'],
  ['Pepper,_bell___Bacterial_spot', 'Pepper', 'bacterial_spot'],
  ['Pepper,_bell___healthy', 'Pepper', 'healthy'],
  ['Potato___Early_blight', 'Potato', 'early_blight'],
  ['Potato___Late_blight', 'Potato', 'late_blight'],
  ['Potato___healthy', 'Potato', 'healthy'],
  ['Raspberry___healthy', 'Raspberry', 'healthy'],
  ['Soybean___healthy', 'Soybean', 'healthy'],
  ['Squash___Powdery_mildew', 'Squash', 'powdery_mildew'],
  ['Strawberry___Leaf_scorch', 'Strawberry', 'leaf_scorch'],
  ['Strawberry___healthy', 'Strawberry', 'healthy'],
  ['Tomato___Bacterial_spot', 'Tomato', 'bacterial_spot'],
  ['Tomato___Early_blight', 'Tomato', 'early_blight'],
  ['Tomato___Late_blight', 'Tomato', 'late_blight'],
  ['Tomato___Leaf_Mold', 'Tomato', 'leaf_mold'],
  ['Tomato___Septoria_leaf_spot', 'Tomato', 'septoria_leaf_spot'],
  ['Tomato___Spider_mites Two-spotted_spider_mite', 'Tomato', 'spider_mites'],
  ['Tomato___Target_Spot', 'Tomato', 'target_spot'],
  ['Tomato___Tomato_Yellow_Leaf_Curl_Virus', 'Tomato', 'yellow_leaf_curl_virus'],
  ['Tomato___Tomato_mosaic_virus', 'Tomato', 'mosaic_virus'],
  ['Tomato___healthy', 'Tomato', 'healthy'],
];

describe('label matching', () => {
  it.each(PLANT_VILLAGE)('%s', (label, crop, id) => {
    const m = matchLabel(label);
    expect(m.crop).toBe(crop);
    expect(m.condition?.id).toBe(id);
  });

  /** The same 38 classes as worded by the Hugging Face MobileNetV2 model (services/ml default). */
  const HF_WORDING = ["Apple Scab", "Apple with Black Rot", "Cedar Apple Rust", "Healthy Apple", "Healthy Blueberry Plant", "Cherry with Powdery Mildew", "Healthy Cherry Plant", "Corn (Maize) with Cercospora and Gray Leaf Spot", "Corn (Maize) with Common Rust", "Corn (Maize) with Northern Leaf Blight", "Healthy Corn (Maize) Plant", "Grape with Black Rot", "Grape with Esca (Black Measles)", "Grape with Isariopsis Leaf Spot", "Healthy Grape Plant", "Orange with Citrus Greening", "Peach with Bacterial Spot", "Healthy Peach Plant", "Bell Pepper with Bacterial Spot", "Healthy Bell Pepper Plant", "Potato with Early Blight", "Potato with Late Blight", "Healthy Potato Plant", "Healthy Raspberry Plant", "Healthy Soybean Plant", "Squash with Powdery Mildew", "Strawberry with Leaf Scorch", "Healthy Strawberry Plant", "Tomato with Bacterial Spot", "Tomato with Early Blight", "Tomato with Late Blight", "Tomato with Leaf Mold", "Tomato with Septoria Leaf Spot", "Tomato with Spider Mites or Two-spotted Spider Mite", "Tomato with Target Spot", "Tomato Yellow Leaf Curl Virus", "Tomato Mosaic Virus", "Healthy Tomato Plant"];
  it.each(HF_WORDING.map((label, i) => [label, PLANT_VILLAGE[i]![1], PLANT_VILLAGE[i]![2]] as const))('%s', (label, crop, id) => {
    const m = matchLabel(label);
    expect(m.crop).toBe(crop);
    expect(m.condition?.id).toBe(id);
  });

  it('understands other wordings of the same classes', () => {
    expect(matchLabel('Tomato with Early Blight').condition?.id).toBe('early_blight');
    expect(matchLabel('Healthy Apple').condition?.id).toBe('healthy');
    expect(matchLabel('Corn (maize) leaf with Common Rust').condition?.id).toBe('common_rust');
    expect(matchLabel('TomatoLateBlight').condition?.id).toBe('late_blight');
    expect(matchLabel('Potato___Early_blight').category).toBe('fungal');
  });

  it('takes the crop from a separate hint (crop.health gives "early blight" + crop)', () => {
    const m = matchLabel('early blight', 'tomato');
    expect(m.crop).toBe('Tomato');
    expect(m.condition?.id).toBe('early_blight');
  });

  it('guesses a category for labels outside the catalogue', () => {
    const virus = matchLabel('Cassava Brown Streak Virus');
    expect(virus.condition).toBeNull();
    expect(virus.category).toBe('viral');
    expect(virus.crop).toBe('Cassava');
    expect(virus.displayName).toBe('Brown streak virus');
    expect(matchLabel('Rice Blast').category).toBe('fungal');
    expect(matchLabel('fall armyworm').category).toBe('pest');
    expect(matchLabel('something odd').category).toBe('unknown');
  });

  it('recognises "no plant" classes', () => {
    expect(matchLabel('Background_without_leaves').notPlant).toBe(true);
    expect(matchLabel('not a plant').notPlant).toBe(true);
  });

  it('every catalogue entry has advice', () => {
    for (const c of CONDITIONS) {
      expect(c.summary.length).toBeGreaterThan(10);
      if (c.category !== 'healthy') expect(c.treatment.length).toBeGreaterThan(0);
      expect(c.prevention.length).toBeGreaterThan(0);
    }
  });
});

describe('model response parsing', () => {
  it('Hugging Face: [{label, score}]', () => {
    const r = parseModelResponse([
      { label: 'Tomato___Late_blight', score: 0.08 },
      { label: 'Tomato___Early_blight', score: 0.9 },
    ]);
    expect(r.predictions[0]).toEqual({ label: 'Tomato___Early_blight', confidence: 0.9 });
    expect(r.predictions).toHaveLength(2);
  });

  it('Roboflow single-label and multi-label', () => {
    const single = parseModelResponse({ predictions: [{ class: 'Leaf_Mold', confidence: 0.81 }], top: 'Leaf_Mold', confidence: 0.81 });
    expect(single.predictions[0]).toEqual({ label: 'Leaf_Mold', confidence: 0.81 });
    const multi = parseModelResponse({ predictions: { Leaf_Mold: { confidence: 0.7 }, healthy: { confidence: 0.2 } }, predicted_classes: ['Leaf_Mold'] });
    expect(multi.predictions.map((p) => p.label)).toEqual(['Leaf_Mold', 'healthy']);
  });

  it('crop.health (Kindwise) with its preset paths', () => {
    const cfg = loadScanConfig({ SCAN_API_PRESET: 'kindwise', SCAN_API_KEY: 'k' });
    const r = parseModelResponse(
      {
        result: {
          is_plant: { probability: 0.98, binary: true },
          crop: { suggestions: [{ name: 'tomato', probability: 0.95 }] },
          disease: { suggestions: [{ name: 'early blight', probability: 0.72 }, { name: 'septoria leaf spot', probability: 0.1 }] },
        },
      },
      cfg,
    );
    expect(r.isPlant).toBe(true);
    expect(r.crop).toBe('tomato');
    expect(r.predictions[0]).toEqual({ label: 'early blight', confidence: 0.72 });
  });

  it('single objects, percentages, plain strings and custom keys', () => {
    expect(parseModelResponse({ prediction: 'Tomato___healthy', probability: 97 }).predictions[0]).toEqual({ label: 'Tomato___healthy', confidence: 0.97 });
    expect(parseModelResponse({ disease: 'Apple scab', score: '64%' }).predictions[0]).toEqual({ label: 'Apple scab', confidence: 0.64 });
    expect(parseModelResponse('Grape___Black_rot').predictions[0]).toEqual({ label: 'Grape___Black_rot', confidence: null });
    expect(
      parseModelResponse({ out: { top: [{ k: 'Potato___Late_blight', p: 0.93 }] } }, { resultsPath: 'out.top', labelKey: 'k', confidenceKey: 'p' }).predictions[0],
    ).toEqual({ label: 'Potato___Late_blight', confidence: 0.93 });
    expect(parseModelResponse({ data: { results: [{ name: 'Rust', confidence: 0.5 }] } }).predictions[0]?.label).toBe('Rust');
  });

  it('nothing usable → no predictions', () => {
    expect(parseModelResponse({ error: 'bad image' }).predictions).toEqual([]);
    expect(parseModelResponse(null).predictions).toEqual([]);
  });
});

describe('config', () => {
  it('is off (never throws) without a model', () => {
    const c = loadScanConfig({});
    expect(c.ready).toBe(false);
    expect(c.problem).toMatch(/No disease model/);
  });
  it('treats the blank lines of the .env template as "not set"', () => {
    const c = loadScanConfig({ SCAN_API_PRESET: '', SCAN_API_URL: '', SCAN_API_KEY: '' });
    expect(c.problem).toMatch(/No disease model/);
  });
  it('reports invalid settings instead of crashing', () => {
    expect(loadScanConfig({ SCAN_API_URL: 'not a url' }).ready).toBe(false);
    expect(loadScanConfig({ SCAN_API_URL: 'https://m.example/p', SCAN_API_BODY_EXTRA: '[1]' }).problem).toMatch(/JSON object/);
    expect(loadScanConfig({ SCAN_API_PRESET: 'kindwise' }).problem).toMatch(/SCAN_API_KEY/);
  });
  it('fills preset defaults', () => {
    const k = loadScanConfig({ SCAN_API_PRESET: 'kindwise', SCAN_API_KEY: 'k' });
    expect(k).toMatchObject({ ready: true, url: 'https://crop.kindwise.com/api/v1/identification', auth: 'header:Api-Key', request: 'json-base64' });
    const hf = loadScanConfig({ SCAN_API_PRESET: 'huggingface', SCAN_API_URL: 'https://router.huggingface.co/hf-inference/models/x/y', SCAN_API_KEY: 'hf_x' });
    expect(hf).toMatchObject({ ready: true, auth: 'bearer', request: 'raw' });
    const local = loadScanConfig({ SCAN_API_PRESET: 'xeno-ml' });
    expect(local).toMatchObject({ ready: true, auth: 'none', url: 'http://127.0.0.1:8000/v1/scan/predict' });
    const generic = loadScanConfig({ SCAN_API_URL: 'https://m.example/predict', SCAN_MIN_CONFIDENCE: '0.7', SCAN_API_AUTH: 'header:x-api-key', SCAN_API_KEY: 'k' });
    expect(generic).toMatchObject({ ready: true, minConfidence: 0.7, auth: 'header:x-api-key', request: 'multipart' });
  });
});

describe('interpretation', () => {
  const p = (label: string, confidence: number | null) => ({ label, confidence });

  it('disease with advice and alternatives', () => {
    const r = interpret({ predictions: [p('Tomato___Early_blight', 0.91), p('Tomato___Target_Spot', 0.05)], isPlant: null, crop: null }, 0.55);
    expect(r).toMatchObject({ status: 'disease', title: 'Early blight', crop: 'Tomato', category: 'fungal', severity: 'medium', confidence: 0.91 });
    expect(r.treatment.length).toBeGreaterThan(0);
    expect(r.alternatives).toEqual([{ label: 'Tomato · Target spot', confidence: 0.05 }]);
  });

  it('healthy', () => {
    const r = interpret({ predictions: [p('Potato___healthy', 0.97)], isPlant: null, crop: null }, 0.55);
    expect(r).toMatchObject({ status: 'healthy', title: 'Healthy potato leaf', severity: 'none', condition: null });
  });

  it('low confidence → uncertain, with no treatment', () => {
    const r = interpret({ predictions: [p('Tomato___Late_blight', 0.31)], isPlant: null, crop: null }, 0.55);
    expect(r.status).toBe('uncertain');
    expect(r.summary).toMatch(/31 %/);
    expect(r.treatment).toEqual([]);
  });

  it('not a plant', () => {
    expect(interpret({ predictions: [p('early blight', 0.9)], isPlant: false, crop: null }, 0.5).status).toBe('not_plant');
    expect(interpret({ predictions: [p('Background_without_leaves', 0.99)], isPlant: null, crop: null }, 0.5).status).toBe('not_plant');
  });

  it('labels without a score are trusted', () => {
    expect(interpret({ predictions: [p('Grape___Black_rot', null)], isPlant: null, crop: null }, 0.55).status).toBe('disease');
  });
});

describe('sensor tips', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const device = (latest: Partial<NonNullable<DevicePublic['latest']>> | null, mode: 'auto' | 'manual' = 'manual'): DevicePublic =>
    ({
      id: 'a'.repeat(24),
      name: 'Xeno 1',
      desired: { version: 1, mode, settings: { ...defaultSettings }, manual: null },
      latest: latest && { ts: '2026-10-07T11:55:00.000Z', soilMoisture: 40, temperature: 25, humidity: 60, rain: false, pump: false, ...latest },
    }) as unknown as DevicePublic;

  it('fungal disease + humid, wet, rainy garden → specific warnings', () => {
    const tips = sensorTips('fungal', 'disease', device({ humidity: 88, soilMoisture: 70, rain: true }), now);
    expect(tips.map((t) => t.code)).toEqual(['humid_air', 'rain', 'soil_too_wet']);
    expect(tips[2]!.message).toMatch(/Switch Xeno to Auto/);
  });

  it('dry soil and heat', () => {
    const tips = sensorTips('healthy', 'healthy', device({ soilMoisture: 12, temperature: 40 }, 'auto'), now);
    expect(tips.map((t) => t.code)).toEqual(['soil_dry', 'heat']);
  });

  it('all good → one positive tip; disease with normal sensors → follow treatment', () => {
    expect(sensorTips('healthy', 'healthy', device({}), now)).toEqual([{ code: 'conditions_good', tone: 'good', message: expect.stringMatching(/soil 40 %/) }]);
    expect(sensorTips('viral', 'disease', device({}), now)[0]!.code).toBe('conditions_normal');
  });

  it('stale or missing data, and no device', () => {
    expect(sensorTips('fungal', 'disease', device(null), now)[0]!.code).toBe('no_recent_data');
    expect(sensorTips('fungal', 'disease', { ...device({}), latest: { ...device({})!.latest!, ts: '2026-10-07T09:00:00.000Z' } }, now)[0]!.code).toBe('no_recent_data');
    expect(sensorTips('fungal', 'disease', null, now)).toEqual([]);
  });
});
