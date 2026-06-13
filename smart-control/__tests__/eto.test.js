// __tests__/eto.test.js — Tests for ET₀ calculation
const {
  calculateET0,
  calculateETc,
  getCropCoefficient,
  estimateDaysToIrrigation,
  saturationVaporPressure,
  slopeVaporPressure,
  psychrometricConstant
} = require('../lib/eto');

describe('ET₀ Calculation (FAO Penman-Monteith)', () => {
  test('returns a positive number for typical DakLak conditions', () => {
    const ET0 = calculateET0({
      temperature: 28,
      humidity: 70,
      windSpeed: 2,
      cloudCover: 40,
      altitude: 500
    });
    expect(ET0).toBeGreaterThan(0);
    expect(ET0).toBeLessThan(15);
  });

  test('returns higher ET₀ for hot, dry, windy conditions', () => {
    const ET0_hot = calculateET0({ temperature: 38, humidity: 30, windSpeed: 5, cloudCover: 10 });
    const ET0_cool = calculateET0({ temperature: 20, humidity: 90, windSpeed: 1, cloudCover: 90 });
    expect(ET0_hot).toBeGreaterThan(ET0_cool);
  });

  test('returns null when temperature is missing', () => {
    expect(calculateET0({ humidity: 70 })).toBeNull();
  });

  test('returns null when humidity is missing', () => {
    expect(calculateET0({ temperature: 28 })).toBeNull();
  });

  test('clamps ET₀ to 0-15 range', () => {
    // Extreme conditions
    const ET0_extreme = calculateET0({ temperature: 50, humidity: 0, windSpeed: 20, cloudCover: 0 });
    expect(ET0_extreme).toBeLessThanOrEqual(15);
    expect(ET0_extreme).toBeGreaterThanOrEqual(0);
  });
});

describe('Saturation Vapor Pressure', () => {
  test('increases with temperature', () => {
    const es20 = saturationVaporPressure(20);
    const es30 = saturationVaporPressure(30);
    expect(es30).toBeGreaterThan(es20);
  });

  test('returns ~2.34 kPa at 20°C', () => {
    const es = saturationVaporPressure(20);
    expect(es).toBeCloseTo(2.34, 1);
  });
});

describe('Crop Coefficient (Kc)', () => {
  test('returns Kc for robusta at each stage', () => {
    const stages = ['dormant', 'flowering', 'fruit-set', 'fruit-growth', 'ripening', 'harvest'];
    stages.forEach(stage => {
      const kc = getCropCoefficient('robusta', stage);
      expect(kc).toBeGreaterThan(0);
      expect(kc).toBeLessThanOrEqual(1.2);
    });
  });

  test('fruit-growth has highest Kc for robusta', () => {
    const kc = getCropCoefficient('robusta', 'fruit-growth');
    expect(kc).toBe(1.05);
  });

  test('returns default 0.8 for unknown crop', () => {
    expect(getCropCoefficient('unknown', 'dormant')).toBe(0.8);
  });
});

describe('ETc Calculation', () => {
  test('ETc = ET₀ × Kc', () => {
    expect(calculateETc(5, 1.0)).toBe(5);
    expect(calculateETc(4, 0.8)).toBe(3.2);
  });

  test('returns null for null inputs', () => {
    expect(calculateETc(null, 1.0)).toBeNull();
    expect(calculateETc(5, null)).toBeNull();
  });
});

describe('Days to Irrigation Estimate', () => {
  test('returns 0 when already below threshold', () => {
    expect(estimateDaysToIrrigation(30, 35, 5)).toBe(0);
  });

  test('returns more days for higher moisture surplus', () => {
    const days60 = estimateDaysToIrrigation(60, 35, 5);
    const days45 = estimateDaysToIrrigation(45, 35, 5);
    expect(days60).toBeGreaterThan(days45);
  });

  test('returns 999 when ETc is 0', () => {
    expect(estimateDaysToIrrigation(60, 35, 0)).toBe(999);
  });
});

describe('Psychrometric Constant', () => {
  test('decreases with altitude', () => {
    const gamma0 = psychrometricConstant(0);
    const gamma500 = psychrometricConstant(500);
    const gamma1000 = psychrometricConstant(1000);
    expect(gamma0).toBeGreaterThan(gamma500);
    expect(gamma500).toBeGreaterThan(gamma1000);
  });
});
