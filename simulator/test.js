#!/usr/bin/env node
// ─── SmartFarm Simulator — Automated Test Suite ───────
// Usage: node test.js
// Requires simulator running on localhost:3001

const http = require('http');

const BASE = 'http://localhost:3001';
let passed = 0, failed = 0;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port,
      path: url.pathname, method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function run() {
  console.log('\n🧪 SmartFarm Simulator — Test Suite\n');

  // ── Health ──
  await test('Health check returns ok', async () => {
    const r = await request('GET', '/api/health');
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.body.status === 'ok', `Body: ${JSON.stringify(r.body)}`);
  });

  // ── Status ──
  await test('Status returns sensor data', async () => {
    const r = await request('GET', '/api/status');
    assert(r.status === 200);
    assert(r.body.data, 'Missing data');
    assert(typeof r.body.data.temperature === 'number', 'Missing temperature');
    assert(typeof r.body.data.moisture === 'number', 'Missing moisture');
  });

  // ── Presets ──
  await test('Apply preset drought', async () => {
    const r = await request('POST', '/api/preset', { preset: 'drought' });
    assert(r.status === 200);
    assert(r.body.ok === true);
    assert(r.body.data.moisture <= 20, `Moisture should be low: ${r.body.data.moisture}`);
  });

  await test('Apply preset flooding', async () => {
    const r = await request('POST', '/api/preset', { preset: 'flooding' });
    assert(r.status === 200);
    assert(r.body.data.moisture >= 80, `Moisture should be high: ${r.body.data.moisture}`);
  });

  await test('Invalid preset returns 400', async () => {
    const r = await request('POST', '/api/preset', { preset: 'nonexistent' });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ── Scenarios ──
  await test('List scenarios', async () => {
    const r = await request('GET', '/api/scenarios');
    assert(r.status === 200);
    assert(r.body.scenarios, 'Missing scenarios');
    assert(Object.keys(r.body.scenarios).length >= 5, 'Should have 5+ scenarios');
  });

  await test('Start scenario drought_10day', async () => {
    const r = await request('POST', '/api/scenario/start', { scenario: 'drought_10day' });
    assert(r.status === 200);
    assert(r.body.ok === true);
  });

  await test('Stop scenario', async () => {
    const r = await request('POST', '/api/scenario/stop');
    assert(r.status === 200);
  });

  await test('Invalid scenario returns 400', async () => {
    const r = await request('POST', '/api/scenario/start', { scenario: 'nonexistent' });
    assert(r.status === 400);
  });

  // ── Faults ──
  await test('List fault types', async () => {
    const r = await request('GET', '/api/faults');
    assert(r.status === 200);
    assert(r.body.faultScenarios, 'Missing faultScenarios');
    assert(Object.keys(r.body.faultScenarios).length >= 5, 'Should have 5+ fault types');
  });

  await test('Inject packet_loss fault', async () => {
    const r = await request('POST', '/api/fault/inject', { type: 'packet_loss', durationTicks: 5, params: { rate: 0.5 } });
    assert(r.status === 200);
    assert(r.body.ok === true);
    assert(r.body.faultId, 'Missing faultId');
  });

  await test('Clear faults', async () => {
    const r = await request('POST', '/api/fault/clear');
    assert(r.status === 200);
  });

  // ── Publish ──
  await test('Manual publish', async () => {
    const r = await request('POST', '/api/publish');
    assert(r.status === 200);
    assert(r.body.ok === true);
    assert(r.body.sent > 0, 'Sent count should be > 0');
  });

  // ── Actuator feedback ──
  await test('Set actuator feedback', async () => {
    const r = await request('POST', '/api/actuator', { key: 'irrigation', value: true });
    assert(r.status === 200);
    assert(r.body.actuators.irrigation === true);
  });

  // ── Auto mode ──
  await test('Toggle auto mode', async () => {
    const r = await request('POST', '/api/auto', { enabled: true });
    assert(r.status === 200);
    assert(r.body.autoMode === true);
  });

  // ── Reset to normal ──
  await test('Reset to normal preset', async () => {
    const r = await request('POST', '/api/preset', { preset: 'normal' });
    assert(r.status === 200);
  });

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('❌ Test suite error:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('   Is the simulator running? Start with: npm start');
  }
  process.exit(1);
});
