// __tests__/multi-zone.test.js — Multi-Zone Interaction Tests
// Tests cross-zone scenarios, priority conflicts, and shared resources

const { PredictiveIrrigation } = require('../lib/predictive-irrigation');
const { calculatePriority } = require('../lib/scheduler');

describe('Multi-Zone Interactions', () => {
  const zones = [
    { id: 'zone-A', name: 'Khu A', crop: 'robusta', area: 5000, moistureSensor: 'sensor-a' },
    { id: 'zone-B', name: 'Khu B', crop: 'robusta', area: 3000, moistureSensor: 'sensor-b' },
    { id: 'zone-C', name: 'Khu C', crop: 'arabica', area: 2000, moistureSensor: 'sensor-c' },
  ];

  const rules = {
    'zone-A': { enabled: true, moistureMin: 35, moistureMax: 65, rainThreshold: 5, cooldownMin: 120 },
    'zone-B': { enabled: true, moistureMin: 35, moistureMax: 65, rainThreshold: 5, cooldownMin: 120 },
    'zone-C': { enabled: true, moistureMin: 40, moistureMax: 70, rainThreshold: 5, cooldownMin: 90 },
  };

  const weather = {
    temperature: 28, humidity: 70, windSpeed: 2, rainfall: 0, cloudCover: 40,
    forecast: [{ day: 'Hom nay', rain: 0 }, { day: 'Ngay mai', rain: 0 }],
  };

  describe('Priority calculation across zones', () => {
    test('zone with lower moisture gets higher priority', () => {
      const zoneA = zones[0];
      const sensorA = { moisture: 25 }; // very low
      const sensorB = { moisture: 50 }; // OK
      const rule = rules['zone-A'];

      const priorityA = calculatePriority(zoneA, sensorA, rule, weather);
      const priorityB = calculatePriority(zoneA, sensorB, rule, weather);
      expect(priorityA.priority).toBeGreaterThan(priorityB.priority);
    });

    test('Arabica gets higher value factor than Robusta', () => {
      const robustaZone = zones[0];
      const arabicaZone = zones[2];
      const sensor = { moisture: 30 };
      const ruleA = rules['zone-A'];
      const ruleC = rules['zone-C'];

      const robustaPriority = calculatePriority(robustaZone, sensor, ruleA, weather);
      const arabicaPriority = calculatePriority(arabicaZone, sensor, ruleC, weather);
      expect(arabicaPriority.priority).toBeGreaterThan(robustaPriority.priority);
    });
  });

  describe('Predictive Irrigation multi-zone', () => {
    let pi;

    beforeEach(() => {
      pi = new PredictiveIrrigation({ zones, rules, altitude: 500 });
    });

    test('returns recommendations for all zones', () => {
      const sensorData = {
        'zone-A': { moisture: 50 },
        'zone-B': { moisture: 40 },
        'zone-C': { moisture: 45 },
      };
      const recs = pi.getAllRecommendations(sensorData, weather, zones);
      expect(recs).toHaveLength(3);
    });

    test('different zones can have different urgencies', () => {
      const sensorData = {
        'zone-A': { moisture: 20 }, // critical
        'zone-B': { moisture: 50 }, // OK
        'zone-C': { moisture: 38 }, // soon
      };
      const recs = pi.getAllRecommendations(sensorData, weather, zones);
      const urgencies = recs.map(r => r.urgency);
      expect(urgencies).toContain('critical');
      expect(urgencies).toContain('none');
    });

    test('missing sensor data for a zone is skipped', () => {
      const sensorData = {
        'zone-A': { moisture: 50 },
        // zone-B missing
        'zone-C': { moisture: 45 },
      };
      const recs = pi.getAllRecommendations(sensorData, weather, zones);
      expect(recs).toHaveLength(2);
    });

    test('all zones share same weather conditions', () => {
      const sensorData = {
        'zone-A': { moisture: 50 },
        'zone-B': { moisture: 50 },
        'zone-C': { moisture: 50 },
      };
      const recs = pi.getAllRecommendations(sensorData, weather, zones);
      // All should have same ET0 since same weather
      const et0Values = recs.map(r => r.metrics.ET0);
      expect(et0Values[0]).toBe(et0Values[1]);
    });
  });

  describe('Zone-specific configurations', () => {
    test('zone-C (arabica) has different moisture thresholds', () => {
      expect(rules['zone-C'].moistureMin).toBe(40);
      expect(rules['zone-A'].moistureMin).toBe(35);
      expect(rules['zone-C'].moistureMin).toBeGreaterThan(rules['zone-A'].moistureMin);
    });

    test('zone-C has shorter cooldown', () => {
      expect(rules['zone-C'].cooldownMin).toBe(90);
      expect(rules['zone-A'].cooldownMin).toBe(120);
    });
  });
});
