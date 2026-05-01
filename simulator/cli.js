#!/usr/bin/env node
// ─── SmartFarm Simulator CLI ──────────────────────────
// Usage: node cli.js <command> [args]

const http = require('http');

const BASE_URL = process.env.SIMULATOR_URL || 'http://localhost:3001';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function printTable(items, keys) {
  if (!items || items.length === 0) {
    console.log('  (empty)');
    return;
  }
  const widths = {};
  keys.forEach(k => {
    widths[k] = Math.max(k.length, ...items.map(i => String(i[k] || '').length));
  });
  const header = keys.map(k => k.padEnd(widths[k])).join(' | ');
  const sep = keys.map(k => '-'.repeat(widths[k])).join('-+-');
  console.log('  ' + header);
  console.log('  ' + sep);
  items.forEach(item => {
    const row = keys.map(k => String(item[k] ?? '').padEnd(widths[k])).join(' | ');
    console.log('  ' + row);
  });
}

const commands = {
  async status() {
    const s = await request('GET', '/api/status');
    console.log('\n🌱 Simulator Status');
    console.log('─'.repeat(40));
    console.log(`  MQTT:     ${s.mqttConnected ? '✅ Connected' : '❌ Disconnected'}`);
    console.log(`  Sent:     ${s.totalSent} messages`);
    console.log(`  Uptime:   ${Math.round(s.uptime)}s`);
    console.log(`  Scenario: ${s.config.scenario}`);
    console.log(`  Auto:     ${s.config.autoMode ? 'ON' : 'OFF'}`);
    console.log(`  Interval: ${s.config.intervalSec}s`);
    console.log('\n📊 Sensor Data:');
    Object.entries(s.data).forEach(([k, v]) => {
      console.log(`  ${k.padEnd(14)} ${typeof v === 'number' ? v.toFixed(1) : v}`);
    });
    console.log();
  },

  async scenarios() {
    const s = await request('GET', '/api/scenarios');
    console.log('\n📋 Available Scenarios');
    console.log('─'.repeat(60));
    Object.entries(s.scenarios).forEach(([key, sc]) => {
      console.log(`\n  🔑 ${key}`);
      console.log(`     ${sc.name}`);
      console.log(`     ${sc.description}`);
      console.log(`     Phases: ${sc.phases?.length || 0}`);
    });
    console.log();
  },

  async faults() {
    const s = await request('GET', '/api/faults');
    console.log('\n🔧 Available Fault Types');
    console.log('─'.repeat(60));
    Object.entries(s.faultScenarios).forEach(([key, f]) => {
      console.log(`\n  🔑 ${key}`);
      console.log(`     ${f.name}`);
      console.log(`     ${f.description}`);
    });
    console.log('\n📌 Active Faults:');
    if (s.activeFaults.length === 0) {
      console.log('  (none)');
    } else {
      printTable(s.activeFaults, ['id', 'type', 'description', 'tickCount', 'remainingTicks']);
    }
    console.log();
  },

  async 'scenario-start'(args) {
    const name = args[0];
    if (!name) {
      console.error('Usage: cli.js scenario-start <scenario-name>');
      console.error('Run "cli.js scenarios" to see available scenarios');
      process.exit(1);
    }
    const r = await request('POST', '/api/scenario/start', { scenario: name });
    if (r.error) {
      console.error('❌ Error:', r.error);
    } else {
      console.log(`✅ Scenario "${r.scenario}" started`);
      console.log(`   Time acceleration: ${r.timeAcceleration || 'default'}x`);
    }
  },

  async 'scenario-stop'() {
    const r = await request('POST', '/api/scenario/stop');
    console.log(r.message || '✅ Scenario stopped');
  },

  async 'fault-inject'(args) {
    const type = args[0];
    if (!type) {
      console.error('Usage: cli.js fault-inject <type> [duration]');
      console.error('Types: packet_loss, sensor_stuck, sensor_offset, gateway_down, garbage_data, intermittent, drift');
      process.exit(1);
    }
    const duration = parseInt(args[1]) || 30;
    const r = await request('POST', '/api/fault/inject', { type, durationTicks: duration });
    if (r.error) {
      console.error('❌ Error:', r.error);
    } else {
      console.log(`✅ Fault "${type}" injected (id: ${r.faultId}, duration: ${duration} ticks)`);
    }
  },

  async 'fault-clear'() {
    const r = await request('POST', '/api/fault/clear');
    console.log('✅ All faults cleared');
  },

  async 'preset'(args) {
    const name = args[0];
    if (!name) {
      console.error('Usage: cli.js preset <name>');
      console.error('Presets: normal, drought, flooding, nutrient_deficient, saline, acidic');
      process.exit(1);
    }
    const r = await request('POST', '/api/preset', { preset: name });
    console.log(r.ok ? `✅ Preset "${name}" applied` : `❌ Error: ${r.error}`);
  },

  async 'auto'(args) {
    const state = args[0];
    const r = await request('POST', '/api/auto', { enabled: state !== 'off' });
    console.log(`✅ Auto mode: ${state !== 'off' ? 'ON' : 'OFF'}`);
  },

  async 'publish'() {
    const r = await request('POST', '/api/publish');
    console.log(`✅ Published (total: ${r.sent})`);
  },

  help() {
    console.log(`
🌱 SmartFarm Simulator CLI

Usage: node cli.js <command> [args]

Commands:
  status                    Show simulator status
  scenarios                 List available scenarios
  scenario-start <name>     Start a scenario
  scenario-stop             Stop current scenario
  faults                    List fault types and active faults
  fault-inject <type> [dur] Inject a fault (duration in ticks)
  fault-clear               Clear all faults
  preset <name>             Apply a sensor preset
  auto [on|off]             Toggle auto mode
  publish                   Send one MQTT message
  help                      Show this help

Examples:
  node cli.js scenario-start drought_10day
  node cli.js fault-inject packet_loss 50
  node cli.js preset drought
  node cli.js status
    `);
  }
};

// Parse args
const [cmd, ...args] = process.argv.slice(2);

if (!cmd || !commands[cmd]) {
  commands.help();
  process.exit(cmd ? 1 : 0);
}

commands[cmd](args).catch(err => {
  console.error('❌ Error:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('   Is the simulator running? Start with: npm start');
  }
  process.exit(1);
});
