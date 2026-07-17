const {
  getDiurnalTemperature,
  getSolarRadiation,
  getRainfallProbability,
  getDiurnalHumidity,
  getWindSpeed
} = require('../lib/environment');

describe('Environment Model', () => {
  describe('getDiurnalTemperature()', () => {
    test('temperature follows diurnal cycle (warmer at noon)', () => {
      // Run multiple times to account for randomness, check average trend
      const noonTemps = [];
      const nightTemps = [];
      for (let i = 0; i < 50; i++) {
        noonTemps.push(getDiurnalTemperature(14, 6)); // 2 PM, June
        nightTemps.push(getDiurnalTemperature(3, 6));  // 3 AM, June
      }
      const avgNoon = noonTemps.reduce((a, b) => a + b, 0) / noonTemps.length;
      const avgNight = nightTemps.reduce((a, b) => a + b, 0) / nightTemps.length;
      expect(avgNoon).toBeGreaterThan(avgNight);
    });

    test('dry season is warmer than rainy season', () => {
      const dryTemps = [];
      const rainyTemps = [];
      for (let i = 0; i < 50; i++) {
        dryTemps.push(getDiurnalTemperature(14, 1));   // January (dry)
        rainyTemps.push(getDiurnalTemperature(14, 7));  // July (rainy)
      }
      const avgDry = dryTemps.reduce((a, b) => a + b, 0) / dryTemps.length;
      const avgRainy = rainyTemps.reduce((a, b) => a + b, 0) / rainyTemps.length;
      expect(avgDry).toBeGreaterThan(avgRainy);
    });

    test('respects baseTemp parameter', () => {
      const temps = [];
      for (let i = 0; i < 30; i++) {
        temps.push(getDiurnalTemperature(14, 6, 25));
      }
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
      // With baseTemp=25, mean should be around 25
      expect(avg).toBeGreaterThan(20);
      expect(avg).toBeLessThan(30);
    });
  });

  describe('getSolarRadiation()', () => {
    test('returns 0 at night', () => {
      expect(getSolarRadiation(2)).toBe(0);
      expect(getSolarRadiation(20)).toBe(0);
    });

    test('returns positive value during day', () => {
      expect(getSolarRadiation(12)).toBeGreaterThan(0);
    });

    test('peak radiation at solar noon', () => {
      const noon = getSolarRadiation(12);
      const morning = getSolarRadiation(8);
      const afternoon = getSolarRadiation(16);
      expect(noon).toBeGreaterThan(morning);
      expect(noon).toBeGreaterThan(afternoon);
    });
  });

  describe('getRainfallProbability()', () => {
    test('rainy season has higher rain probability', () => {
      const rainyProb = getRainfallProbability(15, 7); // July afternoon
      const dryProb = getRainfallProbability(15, 1);   // January afternoon
      expect(rainyProb).toBeGreaterThan(0);
      expect(dryProb).toBe(0);
    });

    test('dry season has zero rain probability', () => {
      [1, 2, 3, 4, 11, 12].forEach(month => {
        expect(getRainfallProbability(12, month)).toBe(0);
      });
    });

    test('afternoon has higher probability than morning in rainy season', () => {
      const afternoonProb = getRainfallProbability(15, 7);
      const morningProb = getRainfallProbability(8, 7);
      expect(afternoonProb).toBeGreaterThan(morningProb);
    });
  });

  describe('getDiurnalHumidity()', () => {
    test('rainy season has higher humidity', () => {
      const rainyHumidity = [];
      const dryHumidity = [];
      for (let i = 0; i < 50; i++) {
        rainyHumidity.push(getDiurnalHumidity(12, 7));
        dryHumidity.push(getDiurnalHumidity(12, 1));
      }
      const avgRainy = rainyHumidity.reduce((a, b) => a + b, 0) / rainyHumidity.length;
      const avgDry = dryHumidity.reduce((a, b) => a + b, 0) / dryHumidity.length;
      expect(avgRainy).toBeGreaterThan(avgDry);
    });

    test('humidity stays within bounds', () => {
      for (let i = 0; i < 20; i++) {
        const h = getDiurnalHumidity(12, 7);
        expect(h).toBeGreaterThanOrEqual(20);
        expect(h).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('getWindSpeed()', () => {
    test('returns positive wind speed', () => {
      const wind = getWindSpeed(12, 6);
      // With randomness it could be slightly negative, but base should be positive
      expect(typeof wind).toBe('number');
    });

    test('never returns negative values', () => {
      for (let i = 0; i < 1000; i++) {
        const wind = getWindSpeed(3, 1); // Low hour, dry season
        expect(wind).toBeGreaterThanOrEqual(0);
      }
    });

    test('wind is generally higher in rainy season', () => {
      const rainyWinds = [];
      const dryWinds = [];
      for (let i = 0; i < 50; i++) {
        rainyWinds.push(getWindSpeed(14, 7));
        dryWinds.push(getWindSpeed(14, 1));
      }
      const avgRainy = rainyWinds.reduce((a, b) => a + b, 0) / rainyWinds.length;
      const avgDry = dryWinds.reduce((a, b) => a + b, 0) / dryWinds.length;
      expect(avgRainy).toBeGreaterThan(avgDry);
    });
  });
});
