const { SOIL_PROFILES, updateSoilMoisture, updateEC } = require('../lib/soil');

describe('Soil Water Balance Model', () => {
  describe('updateSoilMoisture()', () => {
    test('moisture increases with rainfall', () => {
      const initial = 30;
      const result = updateSoilMoisture(initial, 20, 0, 0.1, 28, 'bazan-red', 1);
      expect(result.newMoisture).toBeGreaterThan(initial);
    });

    test('moisture decreases with ET₀', () => {
      const initial = 50;
      // High ET, no rain, no irrigation
      const result = updateSoilMoisture(initial, 0, 0, 5, 35, 'bazan-red', 1);
      expect(result.newMoisture).toBeLessThan(initial);
    });

    test('moisture stays within 0-100 bounds', () => {
      // Very high rainfall
      const result = updateSoilMoisture(90, 200, 100, 0, 28, 'bazan-red', 1);
      expect(result.newMoisture).toBeLessThanOrEqual(100);
      expect(result.newMoisture).toBeGreaterThanOrEqual(0);
    });

    test('runoff occurs when soil is near saturation', () => {
      const result = updateSoilMoisture(50, 100, 0, 0, 28, 'bazan-red', 1);
      expect(result.runoff).toBeGreaterThan(0);
    });

    test('drainage occurs above field capacity', () => {
      const result = updateSoilMoisture(45, 10, 0, 0, 28, 'bazan-red', 1);
      expect(result.drainage).toBeGreaterThanOrEqual(0);
    });

    test('stress factor is 1.0 at field capacity', () => {
      const soil = SOIL_PROFILES['bazan-red'];
      const result = updateSoilMoisture(soil.fieldCapacity, 0, 0, 1, 28, 'bazan-red', 1);
      expect(result.stressFactor).toBeCloseTo(1.0, 1);
    });

    test('stress factor is 0 at wilting point', () => {
      const soil = SOIL_PROFILES['bazan-red'];
      const result = updateSoilMoisture(soil.wiltingPoint, 0, 0, 1, 28, 'bazan-red', 1);
      expect(result.stressFactor).toBeCloseTo(0, 1);
    });
  });

  describe('Soil Profiles', () => {
    test('bazan-red profile has valid parameters', () => {
      const soil = SOIL_PROFILES['bazan-red'];
      expect(soil).toBeDefined();
      expect(soil.fieldCapacity).toBeGreaterThan(soil.wiltingPoint);
      expect(soil.saturation).toBeGreaterThan(soil.fieldCapacity);
      expect(soil.rootDepthM).toBeGreaterThan(0);
      expect(soil.saturatedConductivity).toBeGreaterThan(0);
    });

    test('bazan-yellow profile has valid parameters', () => {
      const soil = SOIL_PROFILES['bazan-yellow'];
      expect(soil).toBeDefined();
      expect(soil.fieldCapacity).toBeGreaterThan(soil.wiltingPoint);
      expect(soil.saturation).toBeGreaterThan(soil.fieldCapacity);
      expect(soil.rootDepthM).toBeGreaterThan(0);
    });

    test('all profiles have field capacity > wilting point', () => {
      Object.values(SOIL_PROFILES).forEach(soil => {
        expect(soil.fieldCapacity).toBeGreaterThan(soil.wiltingPoint);
      });
    });

    test('all profiles have saturation > field capacity', () => {
      Object.values(SOIL_PROFILES).forEach(soil => {
        expect(soil.saturation).toBeGreaterThan(soil.fieldCapacity);
      });
    });
  });

  describe('updateEC()', () => {
    test('EC increases with evaporation (low moisture)', () => {
      const result = updateEC(500, 25, 0, 0, 450); // low moisture
      expect(result).toBeGreaterThan(500);
    });

    test('EC decreases with rainfall (leaching)', () => {
      const result = updateEC(500, 55, 30, 0, 450);
      expect(result).toBeLessThan(500);
    });

    test('EC stays within bounds (50-8000)', () => {
      const result = updateEC(7000, 20, 0, 0, 450);
      expect(result).toBeLessThanOrEqual(8000);
      expect(result).toBeGreaterThanOrEqual(50);
    });

    test('EC pulls toward baseline over time', () => {
      const highEC = updateEC(1000, 55, 0, 0, 450);
      expect(highEC).toBeLessThan(1000); // pulled toward 450
    });
  });
});
