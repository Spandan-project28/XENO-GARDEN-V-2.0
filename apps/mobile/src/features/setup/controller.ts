/**
 * One shared AutoSetup for the whole app: the Garden screen discovers nearby devices quietly, and
 * the setup screen continues with the very same list when the user taps Connect.
 */
import type { DevicePublic } from '@xeno/shared';
import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { createTransport } from '@/lib/ble';
import { upsertDevice } from '@/lib/deviceCache';
import { queryClient } from '@/lib/queryClient';
import { qk } from '@/lib/queryKeys';
import { onSignOut } from '@/lib/session';
import { currentPhoneWifi, wifiVault } from '@/lib/wifi';
import { AutoSetup, type AutoSetupState } from './autoSetup';

const myDevices = () => queryClient.getQueryData<DevicePublic[]>(qk.devices) ?? [];

function createDefault(): AutoSetup {
  return new AutoSetup({
    transport: createTransport({ isSetUp: (hw) => myDevices().some((d) => d.hardwareId === hw && d.online) }),
    claim: async (hardwareId, claimCode) => {
      const res = await api.devices.claim({ hardwareId, claimCode });
      upsertDevice(queryClient, res.device);
      return res;
    },
    getDevice: (id) => api.devices.get(id),
    myDevices,
    phoneWifi: () => currentPhoneWifi({ ask: true }),
    vault: wifiVault,
  });
}

let factory: () => AutoSetup = createDefault;
let instance: AutoSetup | null = null;
const listeners = new Set<() => void>();

function current(): AutoSetup {
  instance ??= factory();
  return instance;
}

/** Throws away the current run (after "Done", or when signing out) and starts fresh next time. */
export function resetAutoSetup() {
  const old = instance;
  instance = null;
  void old?.dispose();
  void queryClient.invalidateQueries({ queryKey: qk.devices });
  listeners.forEach((l) => l());
}

onSignOut(resetAutoSetup);

/** Tests inject a setup wired to the mock transport. */
export function setAutoSetupFactory(f: (() => AutoSetup) | null) {
  factory = f ?? createDefault;
  resetAutoSetup();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const noopSubscribe = () => () => undefined;

export function useAutoSetup(): [AutoSetup, AutoSetupState] {
  const setup = useSyncExternalStore(subscribe, current);
  const state = useSyncExternalStore(setup.subscribe ?? noopSubscribe, setup.getState);
  return [setup, state];
}
