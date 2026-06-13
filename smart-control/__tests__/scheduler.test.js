const {
  calculatePriority,
  calculateUrgency,
  calculateWaterStress,
  selectIrrigationWindow,
  getScheduleHistory,
  IRRIGATION_WINDOWS,
  CROP_VALUE_FACTORS,
  PUMP_CONSTRAINTS
} = require('../lib/scheduler');

describe('Scheduler Module', () => {
  describe('calculateWaterStress()', () => {
    test('returns 0 when moisture at or above target', () => {
      expect(calculateWaterStress(60, 60)).toBe(0);
      expect(calculateWaterStress(70, 60)).toBe(0);
    });

    test('returns higher stress for lower moisture', () => {
      const low = calculateWaterStress(20, 60);
      const mid = calculateWaterStress(40, 60);
      expect(low).toBeGreaterThan(mid);
    });

    test('caps at 2', () => {
      const stress = calculateWaterStress(0, 100);
      expect(stress).toBeLessThanOrEqual(2);
    });
  });

  describe('calculateUrgency()', () => {
    test('returns higher urgency for stressed zone', () => {
      const high = calculateUrgency({
        currentMoisture: 20, targetMoisture: 60,
        etc: 6, lastIrrigation: null, cooldownMin: 120
      });
      const low = calculateUrgency({
        currentMoisture: 55, targetMoisture: 60,
        etc: 2, lastIrrigation: null, cooldownMin: 120
      });
      expect(high).toBeGreaterThan(low);
    });

    test('returns reduced urgency during cooldown (moisture near target)', () => {
      const urgency = calculateUrgency({
        currentMoisture: 55, targetMoisture: 60,
        etc: 3, lastIrrigation: Date.now() - 30 * 60000, cooldownMin: 120
      });
      expect(urgency).toBeLessThan(1); // reduced: moisture near target + in cooldown
    });
  });

  describe('calculatePriority()', () => {
    const zone = { id: 'zone-C', name: 'Khu C', crop: 'arabica', area: 2000 };
    const sensor = { moisture: 30 };
    const rule = { lastIrrigation: null, cooldownMin: 90, enabled: true, moistureMin: 35 };
    const weather = { temperature: 28, humidity: 70, windSpeed: 2, rainfall: 0, cloudCover: 40 };

    test('returns positive priority', () => {
      const result = calculatePriority(zone, sensor, rule, weather);
      expect(result.priority).toBeGreaterThan(0);
    });

    test('Arabica (zone-C) gets higher priority than Robusta for same conditions', () => {
      const robustaZone = { ...zone, crop: 'robusta', id: 'zone-A' };
      const arabicaResult = calculatePriority(zone, sensor, rule, weather);
      const robustaResult = calculatePriority(robustaZone, sensor, rule, weather);
      expect(arabicaResult.priority).toBeGreaterThan(robustaResult.priority);
    });

    test('breakdown contains all factors', () => {
      const result = calculatePriority(zone, sensor, rule, weather);
      expect(result.breakdown).toHaveProperty('urgency');
      expect(result.breakdown).toHaveProperty('cropValueFactor');
      expect(result.breakdown).toHaveProperty('waterStressFactor');
      expect(result.breakdown).toHaveProperty('ET0');
      expect(result.breakdown).toHaveProperty('Kc');
      expect(result.breakdown).toHaveProperty('ETc');
    });
  });

  describe('selectIrrigationWindow()', () => {
    test('returns a window object', () => {
      const window = selectIrrigationWindow();
      expect(window).toHaveProperty('start');
      expect(window).toHaveProperty('end');
      expect(window).toHaveProperty('label');
      expect(window).toHaveProperty('status');
      expect(window).toHaveProperty('efficiency');
    });

    test('efficiency is defined for all windows', () => {
      IRRIGATION_WINDOWS.forEach(w => {
        expect(w.efficiency).toBeGreaterThan(0);
        expect(w.efficiency).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('getScheduleHistory()', () => {
    test('returns array of specified length', () => {
      const history = getScheduleHistory(3);
      expect(history).toHaveLength(3);
    });

    test('entries have date field', () => {
      const history = getScheduleHistory(1);
      expect(history[0]).toHaveProperty('date');
    });
  });

  describe('Constants', () => {
    test('CROP_VALUE_FACTORS has arabica > robusta', () => {
      expect(CROP_VALUE_FACTORS.arabica).toBeGreaterThan(CROP_VALUE_FACTORS.robusta);
    });

    test('PUMP_CONSTRAINTS defines both pumps', () => {
      expect(PUMP_CONSTRAINTS['pump-1']).toBeDefined();
      expect(PUMP_CONSTRAINTS['pump-2']).toBeDefined();
      expect(PUMP_CONSTRAINTS['pump-1'].zones).toContain('zone-A');
      expect(PUMP_CONSTRAINTS['pump-1'].zones).toContain('zone-B');
      expect(PUMP_CONSTRAINTS['pump-2'].zones).toContain('zone-C');
    });

    test('IRRIGATION_WINDOWS has morning and afternoon slots', () => {
      expect(IRRIGATION_WINDOWS).toHaveLength(2);
      expect(IRRIGATION_WINDOWS[0].start).toBe(5);
      expect(IRRIGATION_WINDOWS[1].start).toBe(16);
    });
  });
});
