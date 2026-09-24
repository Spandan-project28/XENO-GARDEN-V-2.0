import { EventEmitter } from 'node:events';
import type {
  AlertPublic,
  CommandAckPayload,
  DesiredState,
  EventPayload,
  ReportedState,
  TelemetryPayload,
} from '@xeno/shared';

/**
 * In-process domain events. Modules publish facts here; other modules (alerts, realtime,
 * notifications, insights) subscribe. Adding a feature = adding a listener, not editing ingest.
 */
export interface BusEvents {
  'device.telemetry': { deviceId: string; ownerId: string; ts: Date; payload: TelemetryPayload };
  'device.reported': { deviceId: string; ownerId: string; reported: ReportedState; at: Date };
  'device.desired': { deviceId: string; ownerId: string; desired: DesiredState };
  'device.status': { deviceId: string; ownerId: string; online: boolean; at: Date };
  'device.event': { deviceId: string; ownerId: string; event: EventPayload; at: Date };
  'device.cmdAck': { deviceId: string; ownerId: string; ack: CommandAckPayload };
  'device.removed': { deviceId: string; ownerId: string; hardwareId: string };
  'alert.opened': { ownerId: string; alert: AlertPublic };
  'alert.updated': { ownerId: string; alert: AlertPublic };
}

export class AppBus {
  private readonly ee = new EventEmitter({ captureRejections: true });

  constructor(private readonly onListenerError: (err: unknown, event: string) => void) {
    this.ee.setMaxListeners(50);
  }

  emit<K extends keyof BusEvents>(event: K, data: BusEvents[K]): void {
    this.ee.emit(event, data);
  }

  /** Listener errors (sync or async) are reported, never crash the emitter. */
  on<K extends keyof BusEvents>(
    event: K,
    listener: (data: BusEvents[K]) => void | Promise<void>,
  ): () => void {
    const wrapped = (data: BusEvents[K]) => {
      try {
        const r = listener(data);
        if (r instanceof Promise) r.catch((err) => this.onListenerError(err, event));
      } catch (err) {
        this.onListenerError(err, event);
      }
    };
    this.ee.on(event, wrapped);
    return () => this.ee.off(event, wrapped);
  }

  removeAll(): void {
    this.ee.removeAllListeners();
  }
}
