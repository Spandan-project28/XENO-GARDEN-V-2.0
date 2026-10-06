/**
 * Reads predictions out of whatever JSON a model API returns. Known shapes are detected
 * automatically; SCAN_API_RESULTS_PATH / _LABEL_KEY / _CONFIDENCE_KEY override the guess.
 *
 *   [{label, score}]                               Hugging Face
 *   {predictions: [{class, confidence}], top}      Roboflow (single label)
 *   {predictions: {Leaf_Mold: {confidence}}}       Roboflow (multi label)
 *   {result: {disease: {suggestions: [{name, probability}]}}}   crop.health
 *   {label, confidence} / {prediction, probability} / {disease, score} / "Tomato___healthy"
 */
export interface Prediction {
  label: string;
  /** 0..1, or null when the API gives no score. */
  confidence: number | null;
}

export interface ParsedResponse {
  predictions: Prediction[];
  /** From an explicit is-plant flag, when the API has one. */
  isPlant: boolean | null;
  crop: string | null;
}

export interface ParseOptions {
  resultsPath?: string | null;
  labelKey?: string | null;
  confidenceKey?: string | null;
  cropPath?: string | null;
  isPlantPath?: string | null;
}

const LABEL_KEYS = ['label', 'class', 'class_name', 'className', 'name', 'disease', 'prediction', 'predicted_class', 'predicted_label', 'top', 'category', 'title'];
const SCORE_KEYS = ['confidence', 'score', 'probability', 'prob', 'likelihood', 'certainty', 'accuracy'];
const LIST_KEYS = ['predictions', 'results', 'result', 'suggestions', 'outputs', 'output', 'data', 'classes', 'probabilities', 'scores', 'labels', 'disease'];

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

/** "a.b.0.c" → value, or undefined. */
export function getPath(obj: Json, path: string): Json {
  let cur: Json = obj;
  for (const part of path.split('.').filter(Boolean)) {
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (isObj(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

/** Scores may be 0..1 or percentages. */
export function toConfidence(v: Json): number | null {
  const n = typeof v === 'string' ? Number(v.replace('%', '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

function pick(o: Record<string, Json>, preferred: string | null | undefined, keys: string[]): Json {
  if (preferred) return getPath(o, preferred);
  for (const k of keys) if (k in o) return o[k];
  return undefined;
}

/** One object → a prediction, if it looks like one. */
function asPrediction(o: Record<string, Json>, opts: ParseOptions): Prediction | null {
  const label = pick(o, opts.labelKey, LABEL_KEYS);
  if (typeof label !== 'string' || !label.trim()) return null;
  return { label: label.trim(), confidence: toConfidence(pick(o, opts.confidenceKey, SCORE_KEYS)) };
}

function fromArray(arr: Json[], opts: ParseOptions): Prediction[] {
  const out: Prediction[] = [];
  for (const item of arr) {
    if (typeof item === 'string') out.push({ label: item, confidence: null });
    else if (isObj(item)) {
      const p = asPrediction(item, opts);
      if (p) out.push(p);
    }
  }
  return out;
}

/** {"Leaf_Mold": {confidence: 0.9}, "healthy": 0.1} → predictions. */
function fromMap(map: Record<string, Json>, opts: ParseOptions): Prediction[] {
  const out: Prediction[] = [];
  for (const [label, v] of Object.entries(map)) {
    const c = isObj(v) ? toConfidence(pick(v, opts.confidenceKey, SCORE_KEYS)) : toConfidence(v);
    if (c === null) return [];
    out.push({ label, confidence: c });
  }
  return out;
}

function search(v: Json, opts: ParseOptions, depth: number): Prediction[] {
  if (depth > 5 || v === null || v === undefined) return [];
  if (typeof v === 'string') return v.trim() ? [{ label: v.trim(), confidence: null }] : [];
  if (Array.isArray(v)) {
    const direct = fromArray(v, opts);
    if (direct.length) return direct;
    for (const item of v) {
      const nested = search(item, opts, depth + 1);
      if (nested.length) return nested;
    }
    return [];
  }
  if (!isObj(v)) return [];
  // Lists of candidates win over a single top label: they carry the alternatives too.
  for (const k of LIST_KEYS) {
    const child = v[k];
    if (Array.isArray(child)) {
      const found = fromArray(child, opts);
      if (found.length) return found;
    }
  }
  for (const k of LIST_KEYS) {
    const child = v[k];
    if (isObj(child) && !asPrediction(child, opts)) {
      const map = fromMap(child, opts);
      if (map.length) return map;
    }
  }
  const single = asPrediction(v, opts);
  if (single) return [single];
  for (const child of Object.values(v)) {
    if (typeof child === 'string') continue;
    const nested = search(child, opts, depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function findIsPlant(v: Json, opts: ParseOptions): boolean | null {
  const raw = opts.isPlantPath ? getPath(v, opts.isPlantPath) : isObj(v) ? (v.is_plant ?? (isObj(v.result) ? v.result.is_plant : undefined)) : undefined;
  if (typeof raw === 'boolean') return raw;
  if (isObj(raw)) {
    if (typeof raw.binary === 'boolean') return raw.binary;
    const p = toConfidence(raw.probability);
    if (p !== null) return p >= 0.5;
  }
  return null;
}

export function parseModelResponse(body: Json, opts: ParseOptions = {}): ParsedResponse {
  const root = opts.resultsPath ? getPath(body, opts.resultsPath) : body;
  const predictions = search(root, opts, 0)
    .filter((p) => p.label.length <= 200)
    .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  const crop = opts.cropPath ? getPath(body, opts.cropPath) : undefined;
  return { predictions, isPlant: findIsPlant(body, opts), crop: typeof crop === 'string' ? crop : null };
}
