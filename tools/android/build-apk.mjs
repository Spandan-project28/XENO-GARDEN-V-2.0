#!/usr/bin/env node
/**
 * Builds an installable Xeno Garden Android app (development build) on this PC — no Expo account
 * needed (implementation_plan P10.10, ADR-019).
 *
 *   npm run android:setup     once: portable JDK 17 + Android SDK in %LOCALAPPDATA%\xeno-android
 *   npm run android:apk       → dist/xeno-garden-dev.apk
 *   npm run android:apk -- --all-abis   also older 32-bit phones (slower build)
 *   npm run android:apk -- --release --api https://your-app.fly.dev
 *                             → dist/xeno-garden.apk: the finished app, works on any internet
 *
 * It's a development build: Bluetooth setup, notifications and every native feature work, and
 * the JavaScript comes from `npm run dev` + `npx expo start` on this PC — so no server address
 * is baked into the APK. Install it on the phone, open it, and pick this PC's dev server.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mobile = join(root, 'apps', 'mobile');
const androidDir = join(mobile, 'android');
const log = (m) => console.log(`\x1b[32m[apk]\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m[apk]\x1b[0m ${m}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const release = argv.includes('--release');
const apiArg = argv[argv.indexOf('--api') + 1];
if (release && (!argv.includes('--api') || !/^https:\/\/[^\s/]+/.test(apiArg ?? ''))) {
  fail('A release app needs the public server address:  --release --api https://your-app.fly.dev');
}

// 1. Toolchain (from tools/android/setup.ps1, or an existing JAVA_HOME / ANDROID_HOME)
const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
const pathsFile = join(local, 'xeno-android', 'paths.json');
let javaHome = process.env.JAVA_HOME;
let androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (existsSync(pathsFile)) {
  // PowerShell writes UTF-8 with a BOM.
  const p = JSON.parse(readFileSync(pathsFile, 'utf8').replace(/^﻿/, ''));
  javaHome = p.javaHome;
  androidHome = p.androidHome;
}
if (!javaHome || !androidHome) fail('Android toolchain not found. Run: npm run android:setup');
log(`JDK ${javaHome}`);
log(`SDK ${androidHome}`);

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  PATH: `${join(javaHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
  NODE_ENV: release ? 'production' : 'development',
  // Release: the server address is baked into the app (a public hostname, never an IP).
  ...(release ? { EXPO_PUBLIC_API_URL: apiArg.replace(/\/+$/, '') } : {}),
};
const run = (cmd, args, cwd) => {
  log(`${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`${cmd} failed (exit ${r.status})`);
};

// 2. Generate the native project from app.json (Continuous Native Generation; android/ is ignored)
// (prebuild also rewrites the `android`/`ios` npm scripts; keep ours, which run Expo Go.)
const pkgFile = join(mobile, 'package.json');
const pkg = readFileSync(pkgFile, 'utf8');
try {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], mobile);
} finally {
  writeFileSync(pkgFile, pkg);
}
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${androidHome.replace(/\\/g, '\\\\')}\n`);

// 3. Build
const abis = argv.includes('--all-abis') ? 'arm64-v8a,armeabi-v7a,x86_64' : 'arm64-v8a';
const gradlew = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(gradlew, [release ? 'assembleRelease' : 'assembleDebug', `-PreactNativeArchitectures=${abis}`, '--no-daemon'], androidDir);

// 4. Hand over the APK
const variant = release ? 'release' : 'debug';
const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
if (!existsSync(apk)) fail(`build finished but ${apk} is missing`);
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', release ? 'xeno-garden.apk' : 'xeno-garden-dev.apk');
copyFileSync(apk, out);
log(`Done → ${out}`);
log(`Install: copy it to the phone and open it (allow "install unknown apps"), or  adb install -r ${out}`);
if (release) {
  log(`This app talks to ${apiArg} from any WiFi or mobile data. Signed with the local debug key:`);
  log('fine for your own phones; use EAS or your own keystore before publishing to the Play Store.');
} else {
  log('Then on this PC: `npm run dev` and, in another terminal, `npx -w apps/mobile expo start --dev-client`.');
}
