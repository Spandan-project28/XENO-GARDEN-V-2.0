/**
 * Real Bluetooth transport (react-native-ble-plx). Requires a development/production build —
 * the native module isn't in Expo Go, so it is loaded lazily and reports `unsupported` there.
 */
import {
  BLE,
  bleInfoPayload,
  provisioningStatePayload,
  toFrames,
  wifiScanFrame,
  type CloudCredsPayload,
  type ProvisioningStatePayload,
  type WifiNetwork,
} from '@xeno/shared';
import { PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device } from 'react-native-ble-plx';
import { base64ToUtf8, utf8ToBase64 } from './codec';
import { BleError, type FoundDevice, type ProvisioningSession, type ProvisioningTransport } from './types';

const C = BLE.characteristics;
const SVC = BLE.serviceUuid;

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (manager) return manager;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager: Manager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    manager = new Manager();
    return manager;
  } catch {
    throw new BleError('unsupported', 'Bluetooth setup needs the Xeno Garden app build (not Expo Go).');
  }
}

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perms =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  return perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

class PlxSession implements ProvisioningSession {
  readonly simulated = false;
  constructor(private readonly device: Device) {}

  private async read(uuid: string) {
    const c = await this.device.readCharacteristicForService(SVC, uuid);
    return base64ToUtf8(c.value ?? '');
  }

  private async write(uuid: string, message: string) {
    for (const frame of toFrames(message)) {
      await this.device.writeCharacteristicWithResponseForService(SVC, uuid, utf8ToBase64(frame));
    }
  }

  private monitor(uuid: string, onMessage: (json: unknown) => void) {
    const sub = this.device.monitorCharacteristicForService(SVC, uuid, (err, c) => {
      if (err || !c?.value) return;
      try {
        onMessage(JSON.parse(base64ToUtf8(c.value)));
      } catch {
        /* ignore malformed notification */
      }
    });
    return () => sub.remove();
  }

  async readInfo() {
    return bleInfoPayload.parse(JSON.parse(await this.read(C.info)));
  }

  async writeCloudCreds(creds: CloudCredsPayload) {
    await this.write(C.cloudCreds, JSON.stringify(creds));
  }

  scanWifi(timeoutMs = 15_000): Promise<WifiNetwork[]> {
    return new Promise((resolve, reject) => {
      const found = new Map<string, WifiNetwork>();
      const finish = () => {
        stop();
        clearTimeout(timer);
        resolve([...found.values()].sort((a, b) => b.rssi - a.rssi));
      };
      const stop = this.monitor(C.wifiScan, (json) => {
        const f = wifiScanFrame.safeParse(json);
        if (!f.success) return;
        if (f.data.t === 'net') {
          const prev = found.get(f.data.ssid);
          if (!prev || prev.rssi < f.data.rssi) found.set(f.data.ssid, { ssid: f.data.ssid, rssi: f.data.rssi, secure: f.data.sec });
        } else finish();
      });
      const timer = setTimeout(finish, timeoutMs);
      this.write(C.wifiScan, '{"scan":1}').catch((err) => {
        stop();
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async writeWifiCreds(ssid: string, password: string) {
    await this.write(C.wifiCreds, JSON.stringify({ ssid, pw: password }));
  }

  onState(cb: (s: ProvisioningStatePayload) => void) {
    return this.monitor(C.state, (json) => {
      const s = provisioningStatePayload.safeParse(json);
      if (s.success) cb(s.data);
    });
  }

  async disconnect() {
    await this.device.cancelConnection().catch(() => undefined);
  }
}

export class PlxTransport implements ProvisioningTransport {
  async ensureReady() {
    if (Platform.OS === 'web') throw new BleError('unsupported', 'Bluetooth setup works in the phone app.');
    const m = getManager();
    if (!(await requestAndroidPermissions())) {
      throw new BleError('permission_denied', 'Allow Bluetooth access so the app can find your device.');
    }
    const state = await new Promise<string>((resolve) => {
      const sub = m.onStateChange((s) => {
        if (s !== 'Unknown' && s !== 'Resetting') {
          sub.remove();
          resolve(s);
        }
      }, true);
      setTimeout(() => {
        sub.remove();
        resolve('Unknown');
      }, 4000);
    });
    if (state === 'Unauthorized') throw new BleError('permission_denied', 'Allow Bluetooth access in Settings.');
    if (state !== 'PoweredOn') throw new BleError('bluetooth_off', 'Turn on Bluetooth to set up your device.');
  }

  scan(onFound: (d: FoundDevice) => void) {
    const m = getManager();
    void m.startDeviceScan([SVC], { allowDuplicates: false }, (err, d) => {
      if (err || !d) return;
      const name = d.localName ?? d.name ?? '';
      if (!name.startsWith(BLE.deviceNamePrefix)) return;
      onFound({ id: d.id, name, rssi: d.rssi ?? null });
    });
    return () => void m.stopDeviceScan();
  }

  async connect(id: string) {
    const m = getManager();
    try {
      const device = await m.connectToDevice(id, { timeout: 12_000 });
      await device.discoverAllServicesAndCharacteristics();
      if (Platform.OS === 'android') await device.requestMTU(185).catch(() => device);
      return new PlxSession(device);
    } catch {
      throw new BleError('connect_failed', "Couldn't connect. Move closer to the device and try again.");
    }
  }
}
