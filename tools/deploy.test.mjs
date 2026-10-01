// npm run test:tools
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedSecret, planDeploy, validMongoUri } from './deploy.mjs';

const base = { app: 'xeno-garden-asha', region: 'sin', appExists: false, volumeExists: false, secretNames: [], haveMongoUri: false };

test('fresh account: create app + volume, ask for Mongo, set all secrets, deploy, health', () => {
  const kinds = planDeploy(base).map((s) => s.kind);
  assert.deepEqual(kinds, ['create-app', 'create-volume', 'ask-mongo', 'set-secrets', 'deploy', 'health']);
  const secrets = planDeploy(base).find((s) => s.kind === 'set-secrets');
  assert.deepEqual(secrets.names, ['JWT_ACCESS_SECRET', 'METRICS_TOKEN', 'MONGO_URI']);
});

test('re-run: never recreates or overwrites what exists', () => {
  const plan = planDeploy({
    ...base,
    appExists: true,
    volumeExists: true,
    secretNames: ['JWT_ACCESS_SECRET', 'METRICS_TOKEN', 'MONGO_URI'],
  });
  assert.deepEqual(plan.map((s) => s.kind), ['deploy', 'health']);
});

test('the device broker host always follows the app name', () => {
  const deploy = planDeploy(base).find((s) => s.kind === 'deploy');
  assert.ok(deploy.args.includes('DEVICE_BROKER_HOST=xeno-garden-asha.fly.dev'));
  assert.ok(deploy.args.includes('--remote-only'));
  assert.equal(planDeploy(base).at(-1).url, 'https://xeno-garden-asha.fly.dev/v1/health');
});

test('MONGO_URI from the environment skips the question', () => {
  const kinds = planDeploy({ ...base, haveMongoUri: true }).map((s) => s.kind);
  assert.ok(!kinds.includes('ask-mongo'));
});

test('the plan never contains secret values', () => {
  const text = JSON.stringify(planDeploy(base));
  assert.ok(!/mongodb|[A-Za-z0-9_-]{40,}/.test(text));
});

test('rejects invalid app names', () => {
  assert.throws(() => planDeploy({ ...base, app: 'Xeno_Garden' }));
});

test('helpers', () => {
  assert.ok(generatedSecret('JWT_ACCESS_SECRET').length >= 60);
  assert.notEqual(generatedSecret('METRICS_TOKEN'), generatedSecret('METRICS_TOKEN'));
  assert.ok(validMongoUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/xeno_garden'));
  assert.ok(!validMongoUri('http://example.com'));
});
