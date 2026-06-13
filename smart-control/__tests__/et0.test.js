const { calculateET0, calculateETc, calculateIrrigationNeed, getIrrigationPlan, calculateRa, KC_VALUES } = require('../lib/et0');

describe('ET₀ Module (Hargreaves-Samani)', () => {
  describe('calculateRa()', () => {
    test('returns positive value for DakLak latitude', () => {
      const ra = calculateRa(12.75, 172); // summer solstice
      expect(ra).toBeGreaterThan(0);
      expect(ra).toBeLessThan(45); // max ~42 MJ/m²/day near equator
    });

    test('returns higher Ra in summer than winter', () => {
      const raSummer = calculateRa(12.75, 172); // June
      const raWinter = calculateRa(12.75, 1);   // January
      expect(raSummer).toBeGreaterThan(raWinter);
    });
  });

  describe('calculateET0()', () => {
    test('returns positive ET₀ for typical conditions', () => {
      const result = calculateET0({ temperature: 30, humidity: 65, windSpeed: 3 });
      expect(result.et0).toBeGreaterThan(0);
      expect(result.et0).toBeLessThan(15);
      expect(result.method).toBe('hargreaves-samani');
    });

    test('returns higher ET₀ for hotter conditions', () => {
      const cool = calculateET0({ temperature: 20, tempMin: 15, tempMax: 25 });
      const hot = calculateET0({ temperature: 35, tempMin: 30, tempMax: 40 });
      expect(hot.et0).toBeGreaterThan(cool.et0);
    });

    test('returns 0 for missing temperature', () => {
      const result = calculateET0({});
      expect(result.et0).toBe(0);
      expect(result.method).toBe('invalid');
    });

    test('handles tempMax <= tempMin gracefully', () => {
      const result = calculateET0({ temperature: 30, tempMax: 25, tempMin: 35 });
      expect(result.et0).toBeGreaterThanOrEqual(0);
    });

    test('breakdown contains all components', () => {
      const result = calculateET0({ temperature: 28 });
      expect(result.breakdown).toHaveProperty('tempTerm');
      expect(result.breakdown).toHaveProperty('rangeTerm');
      expect(result.breakdown).toHaveProperty('radiation');
      expect(result.breakdown).toHaveProperty('rawET0');
      expect(result.inputs).toHaveProperty('latitude');
      expect(result.inputs).toHaveProperty('dayOfYear');
      expect(result.inputs).toHaveProperty('Ra');
    });
  });

  describe('calculateETc()', () => {
    test('ETc = ET₀ × Kc', () => {
      const result = calculateETc(5, 'flowering');
      expect(result.etc).toBe(5 * KC_VALUES.flowering);
      expect(result.kc).toBe(KC_VALUES.flowering);
    });

    test('all growth stages have Kc values', () => {
      const stages = ['dormant', 'flowering', 'fruit-set', 'fruit-growth', 'ripening', 'harvest'];
      stages.forEach(stage => {
        const result = calculateETc(4, stage);
        expect(result.kc).toBeGreaterThan(0);
        expect(result.kcSource).toBe('table');
      });
    });

    test('unknown stage uses default Kc', () => {
      const result = calculateETc(4, 'unknown-stage');
      expect(result.kc).toBe(0.85);
      expect(result.kcSource).toBe('default');
    });
  });

  describe('calculateIrrigationNeed()', () => {
    test('returns positive need when moisture below target', () => {
      const result = calculateIrrigationNeed({
        etc: 5, effectiveRainfall: 0,
        currentMoisture: 30, targetMoisture: 60
      });
      expect(result.irrigationNeed).toBeGreaterThan(0);
    });

    test('returns 0 when ETc covered by rainfall', () => {
      const result = calculateIrrigationNeed({
        etc: 5, effectiveRainfall: 10,
        currentMoisture: 60, targetMoisture: 60
      });
      expect(result.irrigationNeed).toBe(0);
    });
  });

  describe('getIrrigationPlan()', () => {
    const zone = { id: 'zone-A', name: 'Khu A', crop: 'robusta', area: 5000 };
    const sensor = { temperature: 30, moisture: 35 };
    const weather = { rainfall: 0, humidity: 60, windSpeed: 5, temperature: 30 };

    test('returns complete plan structure', () => {
      const plan = getIrrigationPlan(zone, sensor, weather, 'fruit-set');
      expect(plan).toHaveProperty('zoneId', 'zone-A');
      expect(plan).toHaveProperty('et0');
      expect(plan).toHaveProperty('etc');
      expect(plan).toHaveProperty('irrigation');
      expect(plan).toHaveProperty('recommendation');
      expect(plan.irrigation).toHaveProperty('volumeLiters');
    });

    test('skips when raining heavily', () => {
      const rainyWeather = { ...weather, rainfall: 30 };
      const plan = getIrrigationPlan(zone, sensor, rainyWeather, 'fruit-set');
      expect(plan.recommendation.action).toBe('skip');
    });

    test('returns no action when moisture above target', () => {
      const wetSensor = { ...sensor, moisture: 70 };
      const plan = getIrrigationPlan(zone, wetSensor, weather, 'dormant');
      expect(plan.recommendation.action).toBe('none');
    });
  });
});
