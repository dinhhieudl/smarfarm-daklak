const { getET0 } = require('../lib/environment');

describe('ET0 Calculation', () => {
    test('produces positive values for tropical conditions', () => {
        const et0 = getET0(30, 70, 2, 500);
        expect(et0).toBeGreaterThan(0);
        expect(et0).toBeLessThan(15);
    });

    test('increases with temperature', () => {
        const et0_cold = getET0(20, 70, 2, 300);
        const et0_hot = getET0(40, 70, 2, 800);
        expect(et0_hot).toBeGreaterThan(et0_cold);
    });

    test('decreases with humidity', () => {
        const et0_dry = getET0(30, 30, 2, 500);
        const et0_humid = getET0(30, 90, 2, 500);
        expect(et0_dry).toBeGreaterThan(et0_humid);
    });

    test('returns 0 or null for missing temperature', () => {
        const et0 = getET0(null, 70, 2, 500);
        expect(et0 === null || et0 === 0).toBe(true);
    });
});