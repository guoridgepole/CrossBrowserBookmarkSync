import { describe, it, expect } from 'vitest';
import {
  setupPeriodicSync,
  clearPeriodicSync,
  isPeriodicSyncActive,
  getPeriodicSyncAlarmName,
  MIN_SYNC_INTERVAL_MINUTES,
} from '@/platform/alarms';

describe('alarms - periodic sync scheduling', () => {
  it('should create alarm with given interval', async () => {
    await setupPeriodicSync(15);

    const alarm = await browser.alarms.get(getPeriodicSyncAlarmName());
    expect(alarm).toBeDefined();
    expect(alarm!.periodInMinutes).toBe(15);
  });

  it('should clamp interval to minimum (1 minute)', async () => {
    await setupPeriodicSync(0.5);

    const alarm = await browser.alarms.get(getPeriodicSyncAlarmName());
    expect(alarm!.periodInMinutes).toBe(MIN_SYNC_INTERVAL_MINUTES);
  });

  it('should clamp negative interval to minimum', async () => {
    await setupPeriodicSync(-10);

    const alarm = await browser.alarms.get(getPeriodicSyncAlarmName());
    expect(alarm!.periodInMinutes).toBe(MIN_SYNC_INTERVAL_MINUTES);
  });

  it('should replace existing alarm on re-setup', async () => {
    await setupPeriodicSync(15);
    await setupPeriodicSync(60);

    const alarm = await browser.alarms.get(getPeriodicSyncAlarmName());
    expect(alarm!.periodInMinutes).toBe(60);

    // Should only have one alarm with this name
    const allAlarms = await browser.alarms.getAll();
    const syncAlarms = allAlarms.filter((a) => a.name === getPeriodicSyncAlarmName());
    expect(syncAlarms).toHaveLength(1);
  });

  it('should clear alarm', async () => {
    await setupPeriodicSync(30);
    await clearPeriodicSync();

    const alarm = await browser.alarms.get(getPeriodicSyncAlarmName());
    expect(alarm).toBeUndefined();
  });

  it('should report active state correctly', async () => {
    expect(await isPeriodicSyncActive()).toBe(false);

    await setupPeriodicSync(30);
    expect(await isPeriodicSyncActive()).toBe(true);

    await clearPeriodicSync();
    expect(await isPeriodicSyncActive()).toBe(false);
  });

  it('should have a stable alarm name', () => {
    expect(getPeriodicSyncAlarmName()).toBe('periodic-sync');
  });
});
