import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../../generated/prisma/client';
import { PrismaIotService } from '../../../../infrastructure/database/prisma/prisma-iot.service';
import { RealtimeEventsService } from '../../../realtime/realtime-events.service';
import { MqttRuntimeService } from './mqtt-runtime.service';
import { FlespiShellyStatusRpcClient } from './flespi-shelly-status-rpc.client';

type DeviceState = {
  id_device: string;
  id_home: string;
  is_on: boolean;
  connectivity_status: string;
  updated_at: Date;
  last_seen_at: Date | null;
};

type Snapshot = {
  id: string;
  homeId: string;
  fingerprint: string;
  watermark: string | null;
};

export type ShellyReconciliationResult = 'updated' | 'unchanged' | 'stale' | 'not_found' | 'disabled';

function fingerprint(device: DeviceState): string {
  // No client-provided timestamps. Capture the database state under row lock.
  return JSON.stringify([
    device.updated_at.getTime(),
    device.last_seen_at?.getTime() ?? null,
    device.is_on,
    device.connectivity_status,
  ]);
}

/**
 * On-demand only. Never schedules requests or controls the relay.
 * A separately gated DEV worker invokes reconcile() at a bounded interval.
 * PostgreSQL row locks and the SQL036 watermark prevent a delayed RPC reply
 * from overwriting concurrent MQTT telemetry or a newer reconciliation.
 */
@Injectable()
export class FlespiShellyStateReconciler {
  private inFlight: Promise<ShellyReconciliationResult> | null = null;

  constructor(
    private readonly mqtt: MqttRuntimeService,
    private readonly rpc: FlespiShellyStatusRpcClient,
    private readonly prisma: PrismaIotService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  reconcile(): Promise<ShellyReconciliationResult> {
    if (!this.mqtt.config.flespiDeviceId ||
        this.mqtt.config.brokerUrl !== 'mqtts://mqtt.flespi.io:8883') {
      return Promise.resolve('disabled');
    }
    if (this.inFlight) return this.inFlight;

    const operation = this.reconcileOnce();
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    }).catch(() => { /* Do not create an unhandled rejection in cleanup. */ });
    return operation;
  }

  private async reconcileOnce(): Promise<ShellyReconciliationResult> {
    const deviceId = this.mqtt.config.flespiDeviceId!;
    const device = await this.prisma.device.findFirst({
      where: { manufacturer_device_id: deviceId, status: 'ACTIVE', deleted_at: null },
      select: { id_device: true, id_home: true },
    });
    if (!device) return 'not_found';

    const before = await this.prisma.$transaction(async (tx): Promise<Snapshot | null> => {
      const locks = await tx.$queryRaw<Array<{ id_device: string }>>`
        SELECT id_device FROM devices.device
        WHERE id_device = ${device.id_device}::uuid
          AND id_home = ${device.id_home}::uuid
          AND status = 'ACTIVE' AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (locks.length !== 1) return null;
      const state = await tx.device.findFirst({
        where: {
          id_device: device.id_device, id_home: device.id_home,
          manufacturer_device_id: deviceId,
          status: 'ACTIVE', deleted_at: null,
        },
        select: {
          id_device: true, id_home: true, is_on: true,
          connectivity_status: true, updated_at: true, last_seen_at: true,
        },
      });
      if (!state) return null;
      const watermark = await this.readWatermark(tx, device.id_device);
      return { id: state.id_device, homeId: state.id_home,
        fingerprint: fingerprint(state), watermark };
    });
    if (!before) return 'stale';

    // Network call MUST remain outside the PostgreSQL transaction.
    const status = await this.rpc.getSwitchStatus();
    const after = await this.prisma.$transaction(async (tx) => {
      const locks = await tx.$queryRaw<Array<{ id_device: string }>>`
        SELECT id_device FROM devices.device
        WHERE id_device = ${before.id}::uuid
          AND id_home = ${before.homeId}::uuid
          AND status = 'ACTIVE' AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (locks.length !== 1) return null;
      const current = await tx.device.findFirst({
        where: {
          id_device: before.id, id_home: before.homeId,
          manufacturer_device_id: deviceId,
          status: 'ACTIVE', deleted_at: null,
        },
        select: {
          id_device: true, id_home: true, is_on: true,
          connectivity_status: true, updated_at: true, last_seen_at: true,
        },
      });
      if (!current || fingerprint(current) !== before.fingerprint ||
          (await this.readWatermark(tx, before.id)) !== before.watermark) {
        return null;
      }
      // Refresh the heartbeat when the relay state is unchanged; otherwise
      // DeviceOfflineWatcherService may mark a reachable Shelly OFFLINE.
      // Avoid an UPDATE on every poll, and never move last_seen_at backwards.
      const lastSeenMillis = current.last_seen_at?.getTime() ?? 0;
      const receivedMillis = status.receivedAt.getTime();
      const safeLastSeen = new Date(Math.max(receivedMillis, lastSeenMillis));
      if (current.is_on === status.output && current.connectivity_status === 'ONLINE') {
        if (receivedMillis - lastSeenMillis >= 30_000) {
          await tx.device.update({
            where: { id_device: before.id },
            data: { last_seen_at: safeLastSeen },
          });
        }
        // Heartbeat-only updates never generate user-facing state events.
        return { unchanged: true as const };
      }
      // State-only write: never write power, SQL035, consumption or metrics.
      const updated = await tx.device.update({
        where: { id_device: before.id },
        data: {
          is_on: status.output,
          connectivity_status: 'ONLINE',
          last_seen_at: safeLastSeen,
        },
        select: {
          id_device: true, id_home: true, is_on: true,
          connectivity_status: true, current_power_w: true, updated_at: true,
        },
      });
      const recipients = await tx.$queryRaw<Array<{ id_user: string }>>`
        SELECT id_user FROM homes.fn_mqtt_realtime_recipients(
          ${before.id}::uuid, ${before.homeId}::uuid
        )
      `;
      return { unchanged: false as const, updated, recipients };
    });
    if (!after) return 'stale';
    if (after.unchanged) return 'unchanged';

    // Emit ONLY after successful COMMIT, as in the MQTT telemetry subscriber.
    for (const recipient of after.recipients) {
      this.realtime.emitToUser(recipient.id_user, 'device.status.updated', {
        id: after.updated.id_device,
        homeId: after.updated.id_home,
        connectivityStatus: after.updated.connectivity_status,
        isOn: after.updated.is_on,
        currentPowerW: after.updated.current_power_w === null
          ? null : Number(after.updated.current_power_w),
        updatedAt: after.updated.updated_at,
      });
    }
    return 'updated';
  }

  private async readWatermark(
    tx: Prisma.TransactionClient,
    deviceId: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ device_event_ts: unknown }>>`
      SELECT device_event_ts FROM consumption.mqtt_ingest_dedup
      WHERE id_device = ${deviceId}::uuid
      ORDER BY device_event_ts DESC LIMIT 1
    `;
    return rows.length ? String(rows[0].device_event_ts) : null;
  }
}
