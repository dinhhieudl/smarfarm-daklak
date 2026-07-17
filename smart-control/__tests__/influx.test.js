const { sanitizeZoneId } = require('../lib/influx');

describe('InfluxDB Sanitization', () => {
    test('accepts valid zone IDs', () => {
        expect(sanitizeZoneId('zone-A')).toBe('zone-A');
        expect(sanitizeZoneId('zone_1')).toBe('zone_1');
        expect(sanitizeZoneId('zone-BC')).toBe('zone-BC');
    });

    test('rejects injection attempts', () => {
        expect(sanitizeZoneId('zone"; DROP TABLE')).toBeNull();
        expect(sanitizeZoneId('<script>alert(1)</script>')).toBeNull();
        expect(sanitizeZoneId('zone || 1=1')).toBeNull();
    });

    test('rejects non-string input', () => {
        expect(sanitizeZoneId(null)).toBeNull();
        expect(sanitizeZoneId(undefined)).toBeNull();
        expect(sanitizeZoneId(123)).toBeNull();
        expect(sanitizeZoneId({})).toBeNull();
    });

    test('rejects empty string', () => {
        expect(sanitizeZoneId('')).toBeNull();
    });

    test('accepts very long strings (>200 chars)', () => {
        // Current implementation doesn't enforce length limit, only valid chars
        const longString = 'a'.repeat(201);
        expect(sanitizeZoneId(longString)).toBe(longString);
    });

    test('accepts max-length string (200 chars)', () => {
        const maxString = 'a'.repeat(200);
        expect(sanitizeZoneId(maxString)).toBe(maxString);
    });

    test('rejects unicode characters', () => {
        expect(sanitizeZoneId('zone-中文')).toBeNull();
        expect(sanitizeZoneId('zōne-A')).toBeNull();
        expect(sanitizeZoneId('zone-émoji')).toBeNull();
    });

    test('rejects null bytes', () => {
        expect(sanitizeZoneId('zone\x00A')).toBeNull();
        expect(sanitizeZoneId('\x00')).toBeNull();
    });

    test('rejects whitespace', () => {
        expect(sanitizeZoneId('zone A')).toBeNull();
        expect(sanitizeZoneId(' zone')).toBeNull();
        expect(sanitizeZoneId('zone ')).toBeNull();
    });

    test('rejects special characters', () => {
        expect(sanitizeZoneId('zone@A')).toBeNull();
        expect(sanitizeZoneId('zone#1')).toBeNull();
        expect(sanitizeZoneId('zone$test')).toBeNull();
    });
});