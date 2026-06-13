// __tests__/water-balance.test.js — Tests for Water Balance model
const { WaterBalance } = require('../lib/water-balance');

describe('WaterBalance', () => {
  let wb;

  beforeEach(() => {
    wb = new WaterBalance({
      zoneId: 'zone-A',
      initialMoisture: 55,
      fieldCapacity: 65,
      wiltingPoint: 25,
      rootDepth: 0.5,
      availableWater: 100
    });
  });

  test('initializes with correct moisture', () => {
    expect(wb.moisture).toBe(55);
    expect(wb.zoneId).toBe('zone-A');
  });

  test('moisture decreases with ET (no rain/irrigation)', () => {
    const result = wb.update({ ETc: 5, rainfall: 0, irrigation: 0, hoursElapsed: 24 });
    expect(result.moisture).toBeLessThan(55);
  });

  test('moisture increases with rainfall', () => {
    const result = wb.update({ ETc: 0, rainfall: 20, irrigation: 0, hoursElapsed: 24 });
    expect(result.moisture).toBeGreaterThan(55);
  });

  test('moisture does not exceed field capacity', () => {
    wb.update({ ETc: 0, rainfall: 200, irrigation: 200, hoursElapsed: 24 });
    expect(wb.moisture).toBeLessThanOrEqual(65);
  });

  test('moisture does not go below wilting point', () => {
    wb.update({ ETc: 100, rainfall: 0, irrigation: 0, hoursElapsed: 24 });
    expect(wb.moisture).toBeGreaterThanOrEqual(25);
  });

  test('predict returns future moisture', () => {
    const pred = wb.predict(5, 0, 24);
    expect(pred).toHaveProperty('predictedMoisture');
    expect(pred).toHaveProperty('needsIrrigation');
    expect(pred).toHaveProperty('daysToWilting');
    expect(typeof pred.predictedMoisture).toBe('number');
  });

  test('predict shows irrigation needed when moisture will drop low', () => {
    // Start at low moisture, high ET, no rain
    wb.moisture = 38;
    const pred = wb.predict(6, 0, 48);
    expect(pred.needsIrrigation).toBe(true);
  });

  test('history accumulates and respects limit', () => {
    for (let i = 0; i < 5; i++) {
      wb.update({ ETc: 3, rainfall: 0, hoursElapsed: 1 });
    }
    expect(wb.history.length).toBe(5);
  });

  test('getState returns correct structure', () => {
    const state = wb.getState();
    expect(state).toHaveProperty('zoneId', 'zone-A');
    expect(state).toHaveProperty('moisture');
    expect(state).toHaveProperty('fieldCapacity');
    expect(state).toHaveProperty('wiltingPoint');
  });

  test('getHistory filters by hours', () => {
    wb.update({ ETc: 3, rainfall: 0, hoursElapsed: 1 });
    const recent = wb.getHistory(1);
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });
});
