import type { CommandPayload, DesiredState } from '@xeno/shared';

/** Outbound channel to devices. Implemented by the MQTT DeviceGateway; faked in tests. */
export interface DevicePublisher {
  publishDesired(hardwareId: string, desired: DesiredState): Promise<void>;
  clearDesired(hardwareId: string): Promise<void>;
  publishCommand(hardwareId: string, cmd: CommandPayload): Promise<void>;
}

/**
 * Late-bound publisher: services are created before the MQTT connection exists, so they hold this
 * proxy and the runtime attaches the real gateway once connected.
 */
export class PublisherProxy implements DevicePublisher {
  private target: DevicePublisher | null = null;

  attach(target: DevicePublisher | null) {
    this.target = target;
  }

  private get t(): DevicePublisher {
    if (!this.target) throw new Error('Device publisher not attached (MQTT not connected)');
    return this.target;
  }

  publishDesired(hardwareId: string, desired: DesiredState) {
    return this.t.publishDesired(hardwareId, desired);
  }
  clearDesired(hardwareId: string) {
    return this.t.clearDesired(hardwareId);
  }
  publishCommand(hardwareId: string, cmd: CommandPayload) {
    return this.t.publishCommand(hardwareId, cmd);
  }
}
