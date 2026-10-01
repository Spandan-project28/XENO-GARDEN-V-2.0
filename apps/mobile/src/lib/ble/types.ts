import type { BleInfoPayload, CloudCredsPayload, ProvisioningStatePayload, WifiNetwork } from '@xeno/shared';

export interface FoundDevice {
  id: string;
  name: string;
  rssi: number | null;
  /** True for the built-in simulated device (demo / tests). */
  simulated?: boolean;
}

/** One BLE connection to a device in pairing mode. */
export interface ProvisioningSession {
  readonly simulated: boolean;
  readInfo(): Promise<BleInfoPayload>;
  writeCloudCreds(creds: CloudCredsPayload): Promise<void>;
  scanWifi(timeoutMs?: number): Promise<WifiNetwork[]>;
  writeWifiCreds(ssid: string, password: string): Promise<void>;
  onState(cb: (s: ProvisioningStatePayload) => void): () => void;
  disconnect(): Promise<void>;
}

export type BleErrorCode = 'unsupported' | 'permission_denied' | 'bluetooth_off' | 'connect_failed' | 'timeout';

export class BleError extends Error {
  constructor(
    readonly code: BleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BleError';
  }
}

export interface ProvisioningTransport {
  /** Permissions + adapter powered on. Throws BleError. */
  ensureReady(): Promise<void>;
  /**
   * True when scanning can start right now without showing any OS prompt (permission already
   * granted, Bluetooth on). Used for quiet background discovery on the Garden screen.
   */
  canScanQuietly?(): Promise<boolean>;
  /** Starts scanning; returns a stop function. */
  scan(onFound: (d: FoundDevice) => void): () => void;
  connect(id: string): Promise<ProvisioningSession>;
}
