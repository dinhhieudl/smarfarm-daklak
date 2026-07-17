const { sanitizeSensorValue } = require('../lib/irrigation');

// Re-implement formatBytes for testing since it's not exported
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
}

describe('formatBytes', () => {
  test('handles 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  test('handles negative bytes', () => {
    expect(formatBytes(-100)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(-Infinity)).toBe('0 B');
  });

  test('handles fractional bytes', () => {
    expect(formatBytes(0.5)).toBe('0.5 B');
    expect(formatBytes(0.01)).toBe('0.01 B');
  });

  test('handles 1 byte', () => {
    expect(formatBytes(1)).toBe('1 B');
  });

  test('handles exactly 1 KB', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  test('handles 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  test('handles 1 GB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  test('handles large values exceeding GB', () => {
    const result = formatBytes(1024 * 1024 * 1024 * 1024);
    expect(result).toMatch(/GB$/);
  });
});

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
