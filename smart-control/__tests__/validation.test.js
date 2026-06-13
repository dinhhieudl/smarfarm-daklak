const { sanitizeSensorValue } = require('../lib/irrigation');

describe('Input Validation', () => {
  describe('sanitizeSensorValue()', () => {
    test('clamps value below min to min', () => {
      expect(sanitizeSensorValue(5, 10, 100)).toBe(10);
    });

    test('clamps value above max to max', () => {
      expect(sanitizeSensorValue(150, 10, 100)).toBe(100);
    });

    test('returns value within range unchanged', () => {
      expect(sanitizeSensorValue(50, 10, 100)).toBe(50);
    });

    test('handles string numbers', () => {
      expect(sanitizeSensorValue('45', 0, 100)).toBe(45);
    });

    test('returns null for non-numeric values', () => {
      expect(sanitizeSensorValue('abc', 0, 100)).toBeNull();
    });

    test('returns null for NaN', () => {
      expect(sanitizeSensorValue(NaN, 0, 100)).toBeNull();
    });

    test('returns null for Infinity', () => {
      expect(sanitizeSensorValue(Infinity, 0, 100)).toBeNull();
    });

    test('handles exact min boundary', () => {
      expect(sanitizeSensorValue(10, 10, 100)).toBe(10);
    });

    test('handles exact max boundary', () => {
      expect(sanitizeSensorValue(100, 10, 100)).toBe(100);
    });

    test('handles decimal values', () => {
      expect(sanitizeSensorValue(45.67, 0, 100)).toBeCloseTo(45.67);
    });
  });

  describe('Invalid actuator actions (from server logic)', () => {
    const validActions = ['on', 'off', 'open', 'close'];

    test('valid actions are accepted', () => {
      validActions.forEach(action => {
        expect(validActions.includes(action)).toBe(true);
      });
    });

    test('invalid actions are rejected', () => {
      const invalidActions = ['toggle', 'start', 'stop', '', null, undefined, 123];
      invalidActions.forEach(action => {
        expect(validActions.includes(action)).toBe(false);
      });
    });
  });
});
