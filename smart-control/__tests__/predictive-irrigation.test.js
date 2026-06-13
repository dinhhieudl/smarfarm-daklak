// __tests__/predictive-irrigation.test.js — Tests for Predictive Irrigation
const { PredictiveIrrigation } = require('../lib/predictive-irrigation');

const zones = [
  { id: 'zone-A', crop: 'robusta', moistureSensor: 'sensor-a' },
  { id: 'zone-B', crop: 'robusta', moistureSensor: 'sensor-b' }
];

const rules = {
  'zone-A': { enabled: true, moistureMin: 35, moistureMax: 65, rainThreshold: 5 },
  'zone-B': { enabled: true, moistureMin: 35, moistureMax: 65, rainThreshold: 5 }
};

const weather = {
  temperature: 28,
  humidity: 70,
  windSpeed: 2,
  rainfall: 0,
  cloudCover: 40,
  forecast: [
    { day: 'Hôm nay', rain: 0 },
    { day: 'Ngày mai', rain: 5 },
    { day: 'Ngày kia', rain: 10 }
  ]
};

describe('PredictiveIrrigation', () => {
  let pi;

  beforeEach(() => {
    pi = new PredictiveIrrigation({ zones, rules, altitude: 500 });
  });

  test('initializes water balance for each zone', () => {
    expect(pi.balances['zone-A']).toBeDefined();
    expect(pi.balances['zone-B']).toBeDefined();
  });

  test('getRecommendation returns structured result', () => {
    const sensor = { moisture: 45, temperature: 27 };
    const rec = pi.getRecommendation('zone-A', sensor, weather, 'robusta', 'fruit-growth');

    expect(rec).toHaveProperty('zoneId', 'zone-A');
    expect(rec).toHaveProperty('urgency');
    expect(rec).toHaveProperty('reason');
    expect(rec).toHaveProperty('metrics');
    expect(rec.metrics).toHaveProperty('ET0');
    expect(rec.metrics).toHaveProperty('Kc');
    expect(rec.metrics).toHaveProperty('ETc');
  });

  test('returns critical when moisture below minimum', () => {
    const sensor = { moisture: 30 };
    const rec = pi.getRecommendation('zone-A', sensor, weather, 'robusta', 'dormant');
    expect(rec.urgency).toBe('critical');
    expect(rec.recommendedAction.action).toBe('irrigate-now');
  });

  test('returns none when moisture is well above minimum', () => {
    const sensor = { moisture: 60 };
    const rec = pi.getRecommendation('zone-A', sensor, weather, 'robusta', 'dormant');
    expect(['none', 'soon']).toContain(rec.urgency);
  });

  test('detects rain delay when forecast has heavy rain', () => {
    const rainyWeather = {
      ...weather,
      forecast: [
        { day: 'Hôm nay', rain: 15 },
        { day: 'Ngày mai', rain: 20 }
      ]
    };
    const sensor = { moisture: 38 };
    const rec = pi.getRecommendation('zone-A', sensor, rainyWeather, 'robusta', 'dormant');
    // With 35mm forecast rain, should delay
    expect(rec.rainDelay).toBe(true);
  });

  test('processSensorData returns ET metrics', () => {
    const sensor = { moisture: 50, temperature: 27 };
    const result = pi.processSensorData('zone-A', sensor, weather, 'robusta', 'fruit-growth');
    expect(result).toHaveProperty('ET0');
    expect(result).toHaveProperty('Kc');
    expect(result).toHaveProperty('ETc');
    expect(result).toHaveProperty('moisture');
  });

  test('getAllRecommendations returns array for all zones', () => {
    const sensorData = {
      'zone-A': { moisture: 50 },
      'zone-B': { moisture: 40 }
    };
    const recs = pi.getAllRecommendations(sensorData, weather, zones);
    expect(recs.length).toBe(2);
    expect(recs[0].zoneId).toBe('zone-A');
    expect(recs[1].zoneId).toBe('zone-B');
  });

  test('getBalanceState returns state for valid zone', () => {
    const state = pi.getBalanceState('zone-A');
    expect(state).toHaveProperty('zoneId', 'zone-A');
    expect(state).toHaveProperty('moisture');
  });

  test('getBalanceState returns null for invalid zone', () => {
    expect(pi.getBalanceState('zone-X')).toBeNull();
  });

  test('getCurrentStage returns valid stage id', () => {
    const stage = pi.getCurrentStage('robusta');
    expect(typeof stage).toBe('string');
    expect(stage.length).toBeGreaterThan(0);
  });
});
