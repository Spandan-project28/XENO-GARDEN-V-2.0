import type { CommandPayload, DesiredState } from '@xeno/shared';
import type { DevicePublisher } from '../../src/modules/control/publisher.js';

export class FakePublisher implements DevicePublisher {
  desired: { hw: string; desired: DesiredState }[] = [];
  cleared: string[] = [];
  commands: { hw: string; cmd: CommandPayload }[] = [];

  async publishDesired(hw: string, desired: DesiredState) {
    this.desired.push({ hw, desired: structuredClone(desired) });
  }
  async clearDesired(hw: string) {
    this.cleared.push(hw);
  }
  async publishCommand(hw: string, cmd: CommandPayload) {
    this.commands.push({ hw, cmd });
  }
  reset() {
    this.desired = [];
    this.cleared = [];
    this.commands = [];
  }
  lastDesired() {
    return this.desired.at(-1)?.desired;
  }
}
