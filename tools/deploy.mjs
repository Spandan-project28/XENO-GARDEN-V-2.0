#!/usr/bin/env node
/**
 * One-command cloud deploy to Fly.io (implementation_plan P10.11, docs/DEPLOY.md §A).
 *
 *   npm run deploy:cloud -- --app my-xeno-garden [--region sin] [--dry-run]
 *
 * Does everything that can be automated:
 *   1. checks the Fly CLI is installed and you're logged in (opens the browser login if not)
 *   2. creates the app and its storage volume if they don't exist yet
 *   3. generates the JWT + metrics secrets (once — never overwrites existing ones)
 *   4. asks for the one thing it can't create for you: the MongoDB Atlas connection string
 *      (or takes it from $MONGO_URI)
 *   5. deploys (built on Fly's servers — no Docker needed here) and checks /v1/health
 * and then prints the exact next steps for the app and the firmware.
 *
 * Nothing secret is written to disk or printed. --dry-run shows the plan without touching anything.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const VOLUME = 'xg_data';
export const APP_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * Pure: given what already exists on Fly, the list of steps to run. Secret *values* never appear
 * here — only their names — so the plan is safe to print.
 */
export function planDeploy({ app, region, appExists, volumeExists, secretNames, haveMongoUri }) {
  if (!APP_NAME.test(app)) throw new Error(`"${app}" isn't a valid Fly app name (lowercase letters, digits, dashes)`);
  const steps = [];
  if (!appExists) steps.push({ kind: 'create-app', args: ['apps', 'create', app] });
  if (!volumeExists) {
    steps.push({ kind: 'create-volume', args: ['volumes', 'create', VOLUME, '--app', app, '--region', region, '--size', '1', '--yes'] });
  }
  const missing = ['JWT_ACCESS_SECRET', 'METRICS_TOKEN', 'MONGO_URI'].filter((s) => !secretNames.includes(s));
  if (missing.includes('MONGO_URI') && !haveMongoUri) steps.push({ kind: 'ask-mongo' });
  if (missing.length) steps.push({ kind: 'set-secrets', names: missing });
  steps.push({
    kind: 'deploy',
    args: ['deploy', '--app', app, '--primary-region', region, '--remote-only', '--env', `DEVICE_BROKER_HOST=${app}.fly.dev`],
  });
  steps.push({ kind: 'health', url: `https://${app}.fly.dev/v1/health` });
  return steps;
}

export function generatedSecret(name) {
  return name === 'JWT_ACCESS_SECRET' ? randomBytes(48).toString('base64url') : randomBytes(24).toString('hex');
}

export const validMongoUri = (s) => /^mongodb(\+srv)?:\/\/\S+$/.test(s.trim());

// ── runner ───────────────────────────────────────────────────────────────────

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => console.log(`\x1b[32m[deploy]\x1b[0m ${m}`);
const die = (m) => {
  console.error(`\x1b[31m[deploy]\x1b[0m ${m}`);
  process.exit(1);
};

function fly(args, { capture = false, input } = {}) {
  const r = spawnSync('fly', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

async function main() {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      region: { type: 'string', default: 'sin' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const dry = values['dry-run'];
  if (!values.app) die('Choose a globally unique app name, e.g.  npm run deploy:cloud -- --app xeno-garden-yourname');
  const app = values.app;
  const region = values.region;

  if (!fly(['version'], { capture: true }).ok) {
    die(
      'The Fly CLI is not installed. Install it (PowerShell):  iwr https://fly.io/install.ps1 -useb | iex\n' +
        '         then open a new terminal and run this again.',
    );
  }
  if (!fly(['auth', 'whoami'], { capture: true }).ok) {
    if (dry) die('Not logged in to Fly (run `fly auth login`).');
    log('Opening the Fly login in your browser…');
    if (!fly(['auth', 'login']).ok) die('Fly login failed.');
  }

  const appExists = fly(['status', '--app', app], { capture: true }).ok;
  const vols = appExists ? fly(['volumes', 'list', '--app', app, '--json'], { capture: true }) : { ok: false, out: '[]' };
  const volumeExists = vols.ok && JSON.parse(vols.out || '[]').some((v) => v.name === VOLUME);
  const sec = appExists ? fly(['secrets', 'list', '--app', app, '--json'], { capture: true }) : { ok: false, out: '[]' };
  const secretNames = sec.ok ? JSON.parse(sec.out || '[]').map((s) => s.Name ?? s.name) : [];

  const steps = planDeploy({
    app,
    region,
    appExists,
    volumeExists,
    secretNames,
    haveMongoUri: !!process.env.MONGO_URI,
  });

  if (dry) {
    log(`Plan for ${app} (${region}):`);
    for (const s of steps) console.log('  •', s.kind, s.args ? `fly ${s.args.join(' ')}` : s.names ? s.names.join(', ') : s.url ?? '');
    return;
  }

  let mongoUri = process.env.MONGO_URI ?? '';
  for (const s of steps) {
    if (s.kind === 'ask-mongo') {
      log('Paste your MongoDB Atlas connection string (Atlas → Connect → Drivers), e.g.');
      log('  mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/xeno_garden');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      mongoUri = (await rl.question('MONGO_URI: ')).trim();
      rl.close();
      if (!validMongoUri(mongoUri)) die('That does not look like a mongodb:// or mongodb+srv:// URI.');
    } else if (s.kind === 'set-secrets') {
      // Values go through stdin (`fly secrets import`), never the command line or the logs.
      const lines = s.names.map((n) => `${n}=${n === 'MONGO_URI' ? mongoUri : generatedSecret(n)}`).join('\n');
      log(`Setting secrets: ${s.names.join(', ')}`);
      if (!fly(['secrets', 'import', '--app', app, '--stage'], { input: `${lines}\n` }).ok) die('Setting secrets failed.');
    } else if (s.kind === 'health') {
      log(`Checking ${s.url}`);
      let ok = false;
      for (let i = 0; i < 30 && !ok; i++) {
        try {
          const r = await fetch(s.url);
          ok = r.ok;
        } catch {
          /* starting */
        }
        if (!ok) await new Promise((r) => setTimeout(r, 4000));
      }
      if (!ok) die(`The app did not become healthy. Look at the logs: fly logs --app ${app}`);
    } else {
      log(`fly ${s.args.join(' ')}`);
      if (!fly(s.args).ok) die(`Step "${s.kind}" failed.`);
    }
  }

  const url = `https://${app}.fly.dev`;
  log(`Your Xeno Garden server is live: ${url}`);
  console.log(`
Next:
  • App that works on any internet (no Expo account needed):
      npm run android:apk -- --release --api ${url}
    then install dist/xeno-garden.apk on your phones.
  • Devices: save the "ISRG Root X1" certificate (letsencrypt.org/certificates) as
      firmware/certs/ca.pem   and flash:  pio run -d firmware -e esp32dev -t upload
    Devices set up with the new app connect to mqtts://${app}.fly.dev:8883 automatically.
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => die(e.message));
}
