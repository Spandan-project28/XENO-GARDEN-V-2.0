/**
 * Turns any model's label into crop + condition. Models word things differently:
 *   PlantVillage   "Tomato___Early_blight", "Corn_(maize)___Common_rust_"
 *   Hugging Face   "Tomato with Early Blight", "Healthy Apple"
 *   crop.health    "early blight"
 * so matching works on whole words, in catalogue order (most specific first).
 */
import type { ScanCategory } from '@xeno/shared';
import { CONDITIONS, type ConditionInfo } from './catalog.js';

const CROPS: [string, string[]][] = [
  ['Apple', ['apple']],
  ['Blueberry', ['blueberry']],
  ['Cherry', ['cherry']],
  ['Corn', ['corn', 'maize']],
  ['Grape', ['grape', 'grapevine']],
  ['Orange', ['orange', 'citrus']],
  ['Peach', ['peach']],
  ['Pepper', ['pepper', 'capsicum', 'chilli', 'chili']],
  ['Potato', ['potato']],
  ['Raspberry', ['raspberry']],
  ['Soybean', ['soybean', 'soya', 'soy']],
  ['Squash', ['squash', 'pumpkin', 'zucchini']],
  ['Strawberry', ['strawberry']],
  ['Tomato', ['tomato']],
  ['Rice', ['rice', 'paddy']],
  ['Wheat', ['wheat']],
  ['Cotton', ['cotton']],
  ['Mango', ['mango']],
  ['Banana', ['banana']],
  ['Cucumber', ['cucumber']],
  ['Bean', ['bean', 'beans']],
  ['Cassava', ['cassava']],
  ['Coffee', ['coffee']],
  ['Tea', ['tea']],
  ['Rose', ['rose']],
  ['Lettuce', ['lettuce']],
  ['Onion', ['onion']],
  ['Okra', ['okra']],
  ['Eggplant', ['eggplant', 'brinjal', 'aubergine']],
  ['Guava', ['guava']],
];

const NOT_PLANT = [['background'], ['not', 'plant'], ['no', 'plant'], ['non', 'plant'], ['no', 'leaf'], ['not', 'leaf'], ['non', 'leaf']];

export function tokens(label: string): Set<string> {
  const words = label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return new Set(words);
}

const hasAll = (t: Set<string>, words: string[]) => words.every((w) => t.has(w));

export interface LabelMatch {
  crop: string | null;
  condition: ConditionInfo | null;
  /** Category, also guessed for labels the catalogue doesn't know. */
  category: ScanCategory;
  notPlant: boolean;
  /** Readable form of an unknown label ("Tomato Spotted Wilt" → "Spotted wilt"). */
  displayName: string;
}

function guessCategory(t: Set<string>): ScanCategory {
  const s = ` ${[...t].join(' ')} `;
  if (t.has('healthy')) return 'healthy';
  if (/virus|viral|mosaic|curl/.test(s)) return 'viral';
  if (/bacteri/.test(s)) return 'bacterial';
  if (/mite|aphid|insect|beetle|worm|caterpillar|whitefl|thrip|mealybug|pest|borer|weevil|scale /.test(s)) return 'pest';
  if (/deficien|chlorosis|nitrogen|potassium|magnesium|iron|nutrient/.test(s)) return 'nutrient';
  if (/blight|rot|mildew|rust|spot|mold|mould|scab|fung|anthracnose|wilt|canker|smut|blast/.test(s)) return 'fungal';
  return 'unknown';
}

function readable(label: string, crop: string | null): string {
  let words = label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (crop) {
    const drop = new Set([...(CROPS.find(([name]) => name === crop)?.[1] ?? []), 'with', 'including', 'sour', 'on']);
    const kept = words.filter((w) => !drop.has(w.toLowerCase()));
    if (kept.length) words = kept;
  }
  const text = words.join(' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown condition';
}

export function matchLabel(label: string, cropHint?: string | null): LabelMatch {
  const t = tokens(label);
  const notPlant = NOT_PLANT.some((w) => hasAll(t, w));
  const cropFromLabel = CROPS.find(([, aliases]) => aliases.some((a) => t.has(a)))?.[0] ?? null;
  const cropFromHint = cropHint ? CROPS.find(([, aliases]) => aliases.some((a) => tokens(cropHint).has(a)))?.[0] ?? cleanCrop(cropHint) : null;
  const crop = cropFromLabel ?? cropFromHint;
  if (notPlant) return { crop: null, condition: null, category: 'unknown', notPlant: true, displayName: 'Not a plant' };
  const condition = CONDITIONS.find((c) => c.match.some((w) => hasAll(t, w))) ?? null;
  return {
    crop,
    condition,
    category: condition?.category ?? guessCategory(t),
    notPlant: false,
    displayName: condition?.name ?? readable(label, cropFromLabel),
  };
}

function cleanCrop(hint: string): string | null {
  const s = hint.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
}
