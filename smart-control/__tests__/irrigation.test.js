const { shouldStartIrrigation, shouldStopIrrigation, shouldPauseForRain } = require('../lib/irrigation');

describe('Irrigation Module', () => {
  const defaultRule = {
    enabled: true,
    moistureMin: 35,
    moistureMax: 65,
    cooldownMin: 120,
    rainPause: true,
    rainThreshold: 5,
    lastIrrigation: null
  };

  describe('shouldStartIrrigation()', () => {
    test('moisture < min triggers irrigation', () => {
      const sensor = { moisture: 20 };
      const weather = { rainfall: 0 };
      const actuator = { state: 'closed' };
      const result = shouldStartIrrigation(sensor, defaultRule, weather, actuator);
      expect(result.shouldIrrigate).toBe(true);
      expect(result.reason).toBe('moisture-low');
    });

    test('rain pause prevents irrigation', () => {
      const sensor = { moisture: 20 };
      const weather = { rainfall: 15 }; // above threshold of 5
      const actuator = { state: 'closed' };
      const result = shouldStartIrrigation(sensor, defaultRule, weather, actuator);
      expect(result.shouldIrrigate).toBe(false);
      expect(result.reason).toBe('rain-pause');
    });

    test('cooldown prevents re-irrigation', () => {
      const sensor = { moisture: 20 };
      const weather = { rainfall: 0 };
      const actuator = { state: 'closed' };
      const ruleWithCooldown = {
        ...defaultRule,
        lastIrrigation: Date.now() - 30 * 60000 // 30 min ago, cooldown is 120 min
      };
      const result = shouldStartIrrigation(sensor, ruleWithCooldown, weather, actuator);
      expect(result.shouldIrrigate).toBe(false);
      expect(result.reason).toBe('cooldown');
    });

    test('moisture >= max does not trigger irrigation', () => {
      const sensor = { moisture: 70 };
      const weather = { rainfall: 0 };
      const actuator = { state: 'closed' };
      const result = shouldStartIrrigation(sensor, defaultRule, weather, actuator);
      expect(result.shouldIrrigate).toBe(false);
      expect(result.reason).toBe('moisture-ok');
    });

    test('disabled rule prevents irrigation', () => {
      const sensor = { moisture: 20 };
      const weather = { rainfall: 0 };
      const actuator = { state: 'closed' };
      const disabledRule = { ...defaultRule, enabled: false };
      const result = shouldStartIrrigation(sensor, disabledRule, weather, actuator);
      expect(result.shouldIrrigate).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    test('already open valve does not trigger irrigation', () => {
      const sensor = { moisture: 20 };
      const weather = { rainfall: 0 };
      const actuator = { state: 'open' };
      const result = shouldStartIrrigation(sensor, defaultRule, weather, actuator);
      expect(result.shouldIrrigate).toBe(false);
      expect(result.reason).toBe('moisture-ok');
    });
  });

  describe('shouldStopIrrigation()', () => {
    test('moisture >= max stops irrigation when valve is open', () => {
      const sensor = { moisture: 70 };
      const actuator = { state: 'open' };
      expect(shouldStopIrrigation(sensor, defaultRule, actuator)).toBe(true);
    });

    test('moisture < max does not stop irrigation', () => {
      const sensor = { moisture: 50 };
      const actuator = { state: 'open' };
      expect(shouldStopIrrigation(sensor, defaultRule, actuator)).toBe(false);
    });

    test('closed valve returns false even if moisture is high', () => {
      const sensor = { moisture: 70 };
      const actuator = { state: 'closed' };
      expect(shouldStopIrrigation(sensor, defaultRule, actuator)).toBe(false);
    });
  });

  describe('shouldPauseForRain()', () => {
    test('rain above threshold pauses active irrigation', () => {
      const weather = { rainfall: 15 };
      const actuator = { state: 'open' };
      expect(shouldPauseForRain(weather, defaultRule, actuator)).toBe(true);
    });

    test('rain below threshold does not pause', () => {
      const weather = { rainfall: 3 };
      const actuator = { state: 'open' };
      expect(shouldPauseForRain(weather, defaultRule, actuator)).toBe(false);
    });

    test('closed valve does not pause', () => {
      const weather = { rainfall: 15 };
      const actuator = { state: 'closed' };
      expect(shouldPauseForRain(weather, defaultRule, actuator)).toBe(false);
    });
  });
});
