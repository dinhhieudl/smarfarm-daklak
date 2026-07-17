// __tests__/fault-injection.test.js — Fault Injection & Scenario Tests

const { FaultInjector, FAULT_SCENARIOS } = require('../lib/faults');
const { SCENARIOS } = require('../lib/scenarios');

describe('Fault Injection System', () => {
  let injector;

  beforeEach(() => {
    injector = new FaultInjector();
  });

  describe('FaultInjector', () => {
    test('initializes with no active faults', () => {
      expect(injector.listFaults()).toHaveLength(0);
    });

    test('adds a fault', () => {
      const id = injector.addFault({ type: 'sensor-drift', params: { factor: 1.5 }, durationTicks: 10 });
      expect(typeof id).toBe('string');
      expect(injector.listFaults().length).toBeGreaterThan(0);
    });

    test('processes tick with active fault', () => {
      injector.addFault({ type: 'sensor-drift', params: { factor: 1.5 }, durationTicks: 5 });
      const data = { moisture: 50, temperature: 27, ec: 450, ph: 5.8 };
      const result = injector.processTick(data);
      expect(result).toHaveProperty('shouldPublish');
      expect(result).toHaveProperty('modifiedData');
    });

    test('removes expired faults', () => {
      injector.addFault({ type: 'sensor-drift', params: { factor: 1.5 }, durationTicks: 1 });
      injector.processTick({ moisture: 50, temperature: 27, ec: 450, ph: 5.8 }); // tick 1
      injector.processTick({ moisture: 50, temperature: 27, ec: 450, ph: 5.8 }); // tick 2 (expired)
      expect(injector.listFaults()).toHaveLength(0);
    });

    test('clearAll removes all faults', () => {
      injector.addFault({ type: 'sensor-drift', params: {}, durationTicks: 10 });
      injector.addFault({ type: 'signal-loss', params: {}, durationTicks: 10 });
      expect(injector.listFaults().length).toBe(2);
      injector.clearAll();
      expect(injector.listFaults()).toHaveLength(0);
    });

    test('getStats returns fault statistics', () => {
      injector.addFault({ type: 'packet_loss', params: {}, durationTicks: 5 });
      const stats = injector.getStats();
      expect(stats).toHaveProperty('activeFaults');
      expect(stats).toHaveProperty('totalDropped');
    });

    test('rejects unknown fault types - processTick ignores them', () => {
      const id = injector.addFault({ type: 'unknown_type', params: {}, durationTicks: 5 });
      expect(id).toBeTruthy();
      const result = injector.processTick({ temperature: 25, moisture: 50, ec: 450, ph: 5.8 });
      expect(result.shouldPublish).toBe(true);
      expect(result.modifiedData.temperature).toBe(25); // Unchanged
    });
  });

  describe('FAULT_SCENARIOS', () => {
    test('has multiple fault types', () => {
      expect(Object.keys(FAULT_SCENARIOS).length).toBeGreaterThan(0);
    });

    test('each scenario has name and faults array', () => {
      Object.values(FAULT_SCENARIOS).forEach(scenario => {
        expect(scenario).toHaveProperty('name');
        expect(Array.isArray(scenario.faults)).toBe(true);
        expect(scenario.faults.length).toBeGreaterThan(0);
      });
    });

    test('lora_packet_loss scenario exists', () => {
      const scenario = FAULT_SCENARIOS['lora_packet_loss'];
      expect(scenario).toBeDefined();
      expect(scenario).toHaveProperty('name');
      expect(Array.isArray(scenario.faults)).toBe(true);
    });
  });
});

describe('Scenario Engine', () => {
  test('SCENARIOS has multiple scenarios', () => {
    expect(Object.keys(SCENARIOS).length).toBeGreaterThan(0);
  });

  test('each scenario has name, description, and phases', () => {
    Object.values(SCENARIOS).forEach(scenario => {
      expect(scenario).toHaveProperty('name');
      expect(scenario).toHaveProperty('description');
      expect(Array.isArray(scenario.phases)).toBe(true);
      expect(scenario.phases.length).toBeGreaterThan(0);
    });
  });

  test('each phase has name and durationTicks', () => {
    Object.values(SCENARIOS).forEach(scenario => {
      scenario.phases.forEach(phase => {
        expect(phase).toHaveProperty('name');
        expect(phase).toHaveProperty('durationTicks');
        expect(phase.durationTicks).toBeGreaterThan(0);
      });
    });
  });

  test('drought_10day scenario exists', () => {
    expect(SCENARIOS['drought_10day']).toBeDefined();
    expect(SCENARIOS['drought_10day'].name).toContain('H\u1EA1n');
  });

  test('monsoon_5day scenario exists', () => {
    expect(SCENARIOS['monsoon_5day']).toBeDefined();
  });
});
