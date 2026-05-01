// ─── Fault Injection Layer ────────────────────────────
// Mô phỏng lỗi truyền thông, cảm biến sai số, gateway failure

/**
 * Fault types:
 * - packet_loss: Drop MQTT publish randomly
 * - sensor_stuck: Freeze sensor value for N ticks
 * - sensor_offset: Add constant bias to readings
 * - noise_multiplier: Amplify random noise
 * - gateway_down: Stop all publishing
 * - garbage_data: Send out-of-range values
 * - intermittent: Intermittent connection loss
 */

class FaultInjector {
  constructor() {
    this.activeFaults = new Map(); // faultId -> fault config
    this.faultCounter = 0;
    this.stats = {
      totalDropped: 0,
      totalStuckTicks: 0,
      totalGarbageSent: 0
    };
  }

  /**
   * Add a fault
   * @param {object} fault - { type, params, durationTicks, description }
   * @returns {string} faultId
   */
  addFault(fault) {
    const id = `fault-${++this.faultCounter}`;
    this.activeFaults.set(id, {
      ...fault,
      id,
      startTick: Date.now(),
      remainingTicks: fault.durationTicks || Infinity,
      tickCount: 0
    });
    return id;
  }

  /**
   * Remove a fault
   */
  removeFault(faultId) {
    this.activeFaults.delete(faultId);
  }

  /**
   * Clear all faults
   */
  clearAll() {
    this.activeFaults.clear();
  }

  /**
   * Get list of active faults
   */
  listFaults() {
    return Array.from(this.activeFaults.values()).map(f => ({
      id: f.id,
      type: f.type,
      description: f.description,
      params: f.params,
      tickCount: f.tickCount,
      remainingTicks: f.remainingTicks === Infinity ? 'unlimited' : f.remainingTicks
    }));
  }

  /**
   * Process a tick — apply faults and return modified behavior
   * @returns {object} { shouldPublish, modifiedData, faults }
   */
  processTick(originalData) {
    let shouldPublish = true;
    let modifiedData = { ...originalData };
    const appliedFaults = [];

    // Tick all faults, remove expired ones
    const toRemove = [];
    for (const [id, fault] of this.activeFaults) {
      fault.tickCount++;
      if (fault.remainingTicks !== Infinity) {
        fault.remainingTicks--;
        if (fault.remainingTicks <= 0) {
          toRemove.push(id);
          continue;
        }
      }

      switch (fault.type) {
        case 'packet_loss': {
          const rate = fault.params?.rate || 0.3; // 30% default
          if (Math.random() < rate) {
            shouldPublish = false;
            this.stats.totalDropped++;
            appliedFaults.push({ type: 'packet_loss', id });
          }
          break;
        }

        case 'sensor_stuck': {
          // Return the "stuck" value instead of current
          if (fault.params?.stuckValues) {
            modifiedData = { ...fault.params.stuckValues };
            this.stats.totalStuckTicks++;
            appliedFaults.push({ type: 'sensor_stuck', id });
          }
          break;
        }

        case 'sensor_offset': {
          // Add constant bias to specific parameters
          if (fault.params?.offsets) {
            for (const [param, offset] of Object.entries(fault.params.offsets)) {
              if (modifiedData[param] !== undefined) {
                modifiedData[param] += offset;
              }
            }
            appliedFaults.push({ type: 'sensor_offset', id });
          }
          break;
        }

        case 'noise_multiplier': {
          // Amplify noise (applied during variation step)
          if (fault.params?.multiplier) {
            modifiedData._noiseMultiplier = (modifiedData._noiseMultiplier || 1) * fault.params.multiplier;
            appliedFaults.push({ type: 'noise_multiplier', id });
          }
          break;
        }

        case 'gateway_down': {
          shouldPublish = false;
          this.stats.totalDropped++;
          appliedFaults.push({ type: 'gateway_down', id });
          break;
        }

        case 'garbage_data': {
          // Send out-of-range values
          modifiedData.temperature = 999;
          modifiedData.moisture = -50;
          modifiedData.ec = 99999;
          modifiedData.ph = -1;
          this.stats.totalGarbageSent++;
          appliedFaults.push({ type: 'garbage_data', id });
          break;
        }

        case 'intermittent': {
          // Intermittent connection: alternates between working and not
          const period = fault.params?.period || 6; // ticks
          if (fault.tickCount % period < Math.floor(period / 3)) {
            shouldPublish = false;
            this.stats.totalDropped++;
            appliedFaults.push({ type: 'intermittent', id });
          }
          break;
        }

        case 'drift': {
          // Gradual drift in sensor readings
          const rate = fault.params?.rate || 0.1; // per tick
          const param = fault.params?.param || 'temperature';
          if (modifiedData[param] !== undefined) {
            modifiedData[param] += rate * fault.tickCount;
          }
          appliedFaults.push({ type: 'drift', id });
          break;
        }
      }
    }

    // Remove expired faults
    toRemove.forEach(id => this.activeFaults.delete(id));

    return {
      shouldPublish,
      modifiedData,
      appliedFaults,
      stats: { ...this.stats }
    };
  }

  getStats() {
    return {
      activeFaults: this.activeFaults.size,
      ...this.stats
    };
  }
}

// ─── Pre-built Fault Scenarios ────────────────────────
const FAULT_SCENARIOS = {
  lora_packet_loss: {
    name: '📡 LoRa Packet Loss (30%)',
    description: 'Mất 30% gói tin LoRa do nhiễu tần số hoặc khoảng cách',
    faults: [
      { type: 'packet_loss', params: { rate: 0.3 }, durationTicks: 100, description: '30% packet loss' }
    ]
  },
  lora_heavy_loss: {
    name: '📡 LoRa Heavy Loss (70%)',
    description: 'Mất 70% gói tin — gateway bị che khuất hoặc nhiễu nặng',
    faults: [
      { type: 'packet_loss', params: { rate: 0.7 }, durationTicks: 50, description: '70% packet loss' }
    ]
  },
  sensor_stuck: {
    name: '🔧 Cảm biến bị treo',
    description: 'Cảm biến đứng giá trị (hardware freeze)',
    faults: [
      { type: 'sensor_stuck', params: { stuckValues: { temperature: 27.5, moisture: 55, ec: 450, salinity: 220, nitrogen: 120, phosphorus: 35, potassium: 180, ph: 5.8 } }, durationTicks: 30, description: 'Sensor frozen at normal values' }
    ]
  },
  sensor_drift: {
    name: '📏 Cảm biến trôi giá trị',
    description: 'Cảm biến nhiệt độ trôi dần +0.5°C mỗi tick (hiệu chuẩn sai)',
    faults: [
      { type: 'drift', params: { param: 'temperature', rate: 0.5 }, durationTicks: 60, description: 'Temperature drift +0.5°C/tick' }
    ]
  },
  gateway_failure: {
    name: '💥 Gateway lỗi hoàn toàn',
    description: 'E870 gateway bị crash, không gửi dữ liệu',
    faults: [
      { type: 'gateway_down', durationTicks: 20, description: 'Gateway down' }
    ]
  },
  garbage_data: {
    name: '🗑️ Cảm biến gửi dữ liệu rác',
    description: 'Cảm biến bị lỗi firmware, gửi giá trị out-of-range',
    faults: [
      { type: 'garbage_data', durationTicks: 10, description: 'Out-of-range sensor data' }
    ]
  },
  intermittent_gateway: {
    name: '🔌 Gateway chập chờn',
    description: 'Kết nối gateway không ổn định, mất tín hiệu định kỳ',
    faults: [
      { type: 'intermittent', params: { period: 8 }, durationTicks: 100, description: 'Intermittent connection every 8 ticks' }
    ]
  },
  ec_sensor_offset: {
    name: '⚡ EC sensor sai số +500',
    description: 'Cảm biến EC bị lệch +500 µS/cm do bẩn hoặc hỏng',
    faults: [
      { type: 'sensor_offset', params: { offsets: { ec: 500 } }, durationTicks: 50, description: 'EC offset +500' }
    ]
  }
};

module.exports = { FaultInjector, FAULT_SCENARIOS };
