import { loadEnv } from './config/env.js';
import { startRuntime } from './runtime.js';

async function main() {
  const env = loadEnv();
  const rt = await startRuntime(env);
  rt.deps.log.info({ url: rt.url, mqttPort: rt.mqttPort }, 'Xeno Garden backend ready');

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    rt.deps.log.info({ signal }, 'shutting down');
    await rt.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('unhandledRejection', (err) => rt.deps.log.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
