import { buildApp, type App } from '../../src/app.js';
import { createDeps, type ContainerOptions } from '../../src/container.js';
import type { Deps } from '../../src/deps.js';
import { testEnv } from './env.js';

export interface TestApp {
  app: App;
  deps: Deps;
  /** Registers a user and returns auth headers + ids. */
  signUp: (
    email?: string,
    password?: string,
  ) => Promise<{ headers: { authorization: string }; userId: string; refreshToken: string }>;
}

let counter = 0;

/** Builds the app against the already-connected in-memory Mongo (see helpers/mongo.ts). */
export async function createTestApp(
  envOverrides: Record<string, string> = {},
  opts: ContainerOptions = {},
): Promise<TestApp> {
  const deps = createDeps(testEnv(envOverrides), {
    onBusError: (err) => {
      throw err;
    },
    ...opts,
  });
  const app = await buildApp(deps);
  await app.ready();

  return {
    app,
    deps,
    async signUp(email = `user${++counter}@example.com`, password = 'correct-horse-1') {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email, password, name: 'Test User' },
      });
      if (res.statusCode !== 201) throw new Error(`signUp failed: ${res.body}`);
      const body = res.json();
      return {
        headers: { authorization: `Bearer ${body.accessToken}` },
        userId: body.user.id,
        refreshToken: body.refreshToken,
      };
    },
  };
}
