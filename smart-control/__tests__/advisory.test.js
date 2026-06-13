const { getCurrentStage, generateAdvisory, CROP_STAGES } = require('../lib/advisory');

describe('Advisory Module', () => {
  const defaultZone = { id: 'zone-A', name: 'Khu A', crop: 'robusta', plantDate: '2020-01-01' };
  const defaultRule = { moistureMin: 35, moistureMax: 65 };
  const defaultWeather = { rainfall: 0, temperature: 30, humidity: 70 };

  describe('generateAdvisory()', () => {
    test('moisture below min → critical advisory', () => {
      const sensor = { moisture: 20, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(defaultZone, sensor, defaultRule, defaultWeather);
      expect(result.urgency).toBe('critical');
      const irrigationAdvice = result.advices.find(a => a.type === 'irrigation');
      expect(irrigationAdvice).toBeDefined();
      expect(irrigationAdvice.message).toContain('thấp');
    });

    test('moisture above max → drainage advisory', () => {
      const sensor = { moisture: 80, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(defaultZone, sensor, defaultRule, defaultWeather);
      expect(result.urgency).toBe('warning');
      const drainageAdvice = result.advices.find(a => a.type === 'drainage');
      expect(drainageAdvice).toBeDefined();
      expect(drainageAdvice.message).toContain('cao');
    });

    test('moisture in range → ok advisory', () => {
      const sensor = { moisture: 50, ec: 450, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(defaultZone, sensor, defaultRule, defaultWeather);
      expect(result.urgency).toBe('info');
      const irrigationAdvice = result.advices.find(a => a.type === 'irrigation');
      expect(irrigationAdvice).toBeDefined();
      expect(irrigationAdvice.icon).toBe('✅');
    });

    test('high EC → salinity warning', () => {
      const sensor = { moisture: 50, ec: 2500, ph: 5.8, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(defaultZone, sensor, defaultRule, defaultWeather);
      const salinityAdvice = result.advices.find(a => a.type === 'salinity');
      expect(salinityAdvice).toBeDefined();
      expect(salinityAdvice.message).toContain('mặn');
      expect(result.urgency).toBe('critical');
    });

    test('low pH → soil acidity warning', () => {
      const sensor = { moisture: 50, ec: 450, ph: 4.0, temperature: 27, nitrogen: 120, phosphorus: 35, potassium: 180 };
      const result = generateAdvisory(defaultZone, sensor, defaultRule, defaultWeather);
      const soilAdvice = result.advices.find(a => a.type === 'soil');
      expect(soilAdvice).toBeDefined();
      expect(soilAdvice.message).toContain('chua');
    });

    test('correct stage detection for robusta by month (February = flowering)', () => {
      const feb = new Date(2025, 1, 15); // February
      const stage = getCurrentStage('robusta', feb);
      expect(stage).toBeDefined();
      expect(stage.id).toBe('flowering');
    });

    test('correct stage detection for arabica by month (June = fruit-growth)', () => {
      const june = new Date(2025, 5, 15); // June
      const stage = getCurrentStage('arabica', june);
      expect(stage).toBeDefined();
      expect(stage.id).toBe('fruit-growth');
    });

    test('correct stage detection for robusta by month (September = ripening)', () => {
      const sept = new Date(2025, 8, 15); // September
      const stage = getCurrentStage('robusta', sept);
      expect(stage).toBeDefined();
      expect(stage.id).toBe('ripening');
    });

    test('returns null for unknown crop', () => {
      const stage = getCurrentStage('unknown-crop');
      expect(stage).toBeNull();
    });

    test('returns all crop stages for robusta and arabica', () => {
      expect(CROP_STAGES.robusta).toBeDefined();
      expect(CROP_STAGES.robusta.stages.length).toBe(6);
      expect(CROP_STAGES.arabica).toBeDefined();
      expect(CROP_STAGES.arabica.stages.length).toBe(6);
    });
  });
});
