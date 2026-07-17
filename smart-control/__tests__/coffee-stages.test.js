// __tests__/coffee-stages.test.js — Coffee Domain Logic Tests
// Tests crop stage detection, fertilization rules, and irrigation targets

const { getCurrentStage, generateAdvisory, CROP_STAGES } = require('../lib/advisory');

describe('Coffee Domain Logic', () => {
  const defaultWeather = { rainfall: 0, temperature: 30, humidity: 70 };

  // ─── Stage Detection by Month ───────────────────────
  describe('Robusta stage detection', () => {
    // getCurrentStage uses Array.find() — first match wins
    // Overlapping months: flowering [2,3] before fruit-set [3,4,5]
    const expectedStages = [
      { month: 1, expected: 'dormant' },
      { month: 2, expected: 'flowering' },
      { month: 3, expected: 'flowering' },   // overlapping: flowering found first
      { month: 4, expected: 'fruit-set' },
      { month: 5, expected: 'fruit-set' },   // overlapping: fruit-set found first
      { month: 6, expected: 'fruit-growth' },
      { month: 7, expected: 'fruit-growth' },
      { month: 8, expected: 'fruit-growth' },
      { month: 9, expected: 'ripening' },
      { month: 10, expected: 'ripening' },   // overlapping: ripening found first
      { month: 11, expected: 'dormant' },
      { month: 12, expected: 'dormant' },
    ];

    expectedStages.forEach(({ month, expected }) => {
      test(`month ${month} → ${expected}`, () => {
        const date = new Date(2025, month - 1, 15);
        const stage = getCurrentStage('robusta', date);
        expect(stage.id).toBe(expected);
      });
    });
  });

  describe('Arabica stage detection', () => {
    const expectedStages = [
      { month: 1, expected: 'dormant' },
      { month: 2, expected: 'flowering' },
      { month: 3, expected: 'flowering' },   // overlapping: flowering found first
      { month: 4, expected: 'fruit-set' },   // arabica fruit-set starts at month 4
      { month: 5, expected: 'fruit-growth' },
      { month: 6, expected: 'fruit-growth' },
      { month: 7, expected: 'fruit-growth' },
      { month: 8, expected: 'fruit-growth' },
      { month: 9, expected: 'ripening' },
      { month: 10, expected: 'ripening' },   // overlapping: ripening found first
      { month: 11, expected: 'dormant' },
      { month: 12, expected: 'dormant' },
    ];

    expectedStages.forEach(({ month, expected }) => {
      test(`month ${month} → ${expected}`, () => {
        const date = new Date(2025, month - 1, 15);
        const stage = getCurrentStage('arabica', date);
        expect(stage.id).toBe(expected);
      });
    });
  });

  // ─── Stage Properties ───────────────────────────────
  describe('Stage properties', () => {
    test('each robusta stage has irrigation target', () => {
      CROP_STAGES.robusta.stages.forEach(stage => {
        expect(stage.irrigation).toBeDefined();
        expect(stage.irrigation.target).toBeGreaterThan(0);
        expect(stage.irrigation.target).toBeLessThanOrEqual(100);
        expect(stage.irrigation.frequency).toBeDefined();
      });
    });

    test('each robusta stage has fertilization rules', () => {
      CROP_STAGES.robusta.stages.forEach(stage => {
        expect(stage.fertilization).toBeDefined();
        expect(stage.fertilization.N).toBeGreaterThanOrEqual(0);
        expect(stage.fertilization.P).toBeGreaterThanOrEqual(0);
        expect(stage.fertilization.K).toBeGreaterThanOrEqual(0);
      });
    });

    test('each stage has risks array', () => {
      CROP_STAGES.robusta.stages.forEach(stage => {
        expect(Array.isArray(stage.risks)).toBe(true);
        expect(stage.risks.length).toBeGreaterThan(0);
      });
    });

    test('flowering stage has high P fertilization', () => {
      const flowering = CROP_STAGES.robusta.stages.find(s => s.id === 'flowering');
      expect(flowering.fertilization.P).toBeGreaterThanOrEqual(50);
    });

    test('fruit-growth stage has high K fertilization', () => {
      const fruitGrowth = CROP_STAGES.robusta.stages.find(s => s.id === 'fruit-growth');
      expect(fruitGrowth.fertilization.K).toBeGreaterThanOrEqual(70);
    });

    test('dormant stage has zero NPK fertilization', () => {
      const dormant = CROP_STAGES.robusta.stages.find(s => s.id === 'dormant');
      expect(dormant.fertilization.N).toBe(0);
      expect(dormant.fertilization.P).toBe(0);
      expect(dormant.fertilization.K).toBe(0);
    });
  });

  // ─── Advisory Scenarios ─────────────────────────────
  describe('Advisory scenarios', () => {
    const zone = { id: 'zone-A', name: 'Khu A', crop: 'robusta', plantDate: '2020-01-01' };
    const rule = { moistureMin: 35, moistureMax: 65 };

    test('all sensors at optimal values → info advisory', () => {
      const sensor = { moisture: 50, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(zone, sensor, rule, defaultWeather);
      expect(result.urgency).toBe('info');
    });

    test('multiple issues → highest urgency', () => {
      const sensor = { moisture: 20, ec: 2500, ph: 4.0, temperature: 40, nitrogen: 10, phosphorus: 5, potassium: 20 };
      const result = generateAdvisory(zone, sensor, rule, defaultWeather);
      expect(result.urgency).toBe('critical');
    });

    test('temperature above 38 → temperature advisory', () => {
      const sensor = { moisture: 50, ec: 450, ph: 5.8, temperature: 39, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(zone, sensor, rule, defaultWeather);
      const tempAdvice = result.advices.find(a => a.type === 'temperature');
      expect(tempAdvice).toBeDefined();
    });

    test('heavy rain → weather advisory', () => {
      const rainyWeather = { ...defaultWeather, rainfall: 25 };
      const sensor = { moisture: 50, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(zone, sensor, rule, rainyWeather);
      const weatherAdvice = result.advices.find(a => a.type === 'weather');
      expect(weatherAdvice).toBeDefined();
    });

    test('hot + dry — advisory module does NOT check this (only server.js does)', () => {
      const hotWeather = { rainfall: 0, temperature: 36, humidity: 35 };
      const sensor = { moisture: 50, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(zone, sensor, rule, hotWeather);
      // advisory.js only checks rainfall > 20, not hot+dry
      // hot+dry logic is in server.js updateWeather()
      const weatherAdvice = result.advices.find(a => a.type === 'weather');
      expect(weatherAdvice).toBeUndefined();
    });

    test('young plant (< 12 months) → age advisory', () => {
      const youngZone = { ...zone, plantDate: new Date(Date.now() - 6 * 30 * 24 * 3600000).toISOString().split('T')[0] };
      const sensor = { moisture: 50, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(youngZone, sensor, rule, defaultWeather);
      const ageAdvice = result.advices.find(a => a.type === 'info' && a.icon === '🌱');
      expect(ageAdvice).toBeDefined();
    });
  });

  // ─── Robusta vs Arabica Differences ─────────────────
  describe('Robusta vs Arabica', () => {
    test('Arabica fruit-growth lasts longer than Robusta', () => {
      const robustaGrowth = CROP_STAGES.robusta.stages.find(s => s.id === 'fruit-growth');
      const arabicaGrowth = CROP_STAGES.arabica.stages.find(s => s.id === 'fruit-growth');
      expect(arabicaGrowth.months.length).toBeGreaterThanOrEqual(robustaGrowth.months.length);
    });

    test('both have 6 stages', () => {
      expect(CROP_STAGES.robusta.stages).toHaveLength(6);
      expect(CROP_STAGES.arabica.stages).toHaveLength(6);
    });

    test('both have same stage IDs', () => {
      const robustaIds = CROP_STAGES.robusta.stages.map(s => s.id);
      const arabicaIds = CROP_STAGES.arabica.stages.map(s => s.id);
      expect(robustaIds).toEqual(arabicaIds);
    });
  });
});
