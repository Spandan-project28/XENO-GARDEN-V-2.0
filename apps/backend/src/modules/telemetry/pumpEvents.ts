/**
 * Derives watering sessions ("pump events") from reported pump transitions.
 * ON transition → open event (source from pumpReason); OFF transition → close it.
 * Called in-order from the MQTT reported handler (not via the bus) so transitions never race.
 */
import type { PumpEvent as PumpEventDto, PumpReason } from '@xeno/shared';
import { Types } from 'mongoose';
import { PumpEvent, type PumpEventDoc } from '../../db/models.js';

const sourceFor = (reason: PumpReason): PumpEventDoc['source'] =>
  reason === 'manual' ? 'manual' : 'auto';

export const toPumpEventDto = (e: PumpEventDoc): PumpEventDto => ({
  id: e._id.toHexString(),
  deviceId: e.deviceId.toHexString(),
  source: e.source,
  reason: e.reason,
  stopReason: e.stopReason,
  startedAt: e.startedAt.toISOString(),
  endedAt: e.endedAt ? e.endedAt.toISOString() : null,
  durationSec: e.durationSec,
});

export function createPumpEventService() {
  const service = {
    async onReported(deviceId: string, pump: boolean, reason: PumpReason, at: Date) {
      const devId = new Types.ObjectId(deviceId);
      const open = await PumpEvent.findOne({ deviceId: devId, endedAt: null }).sort({ startedAt: -1 });
      if (pump && !open) {
        await PumpEvent.create({ deviceId: devId, source: sourceFor(reason), reason, startedAt: at });
      } else if (!pump && open) {
        const durationSec = Math.max(0, Math.round((at.getTime() - open.startedAt.getTime()) / 1000));
        await PumpEvent.updateOne({ _id: open._id }, { $set: { endedAt: at, durationSec, stopReason: reason } });
      }
    },

    async list(deviceId: string, from: Date, to: Date): Promise<PumpEventDto[]> {
      const docs = await PumpEvent.find({
        deviceId: new Types.ObjectId(deviceId),
        startedAt: { $lte: to },
        $or: [{ endedAt: null }, { endedAt: { $gte: from } }],
      })
        .sort({ startedAt: -1 })
        .limit(500)
        .lean<PumpEventDoc[]>();
      return docs.map(toPumpEventDto);
    },
  };
  return service;
}
export type PumpEventService = ReturnType<typeof createPumpEventService>;
