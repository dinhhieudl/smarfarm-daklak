// ─── Scenario Engine ──────────────────────────────────
// Kịch bản mô phỏng tự động: chạy chuỗi sự kiện theo timeline

const { FAULT_SCENARIOS } = require('./faults');

/**
 * Scenario: A time-based sequence of simulation parameters
 * Each scenario has phases that execute in order
 */
const SCENARIOS = {
  // ─── Drought 10 Days ────────────────────────────────
  drought_10day: {
    name: '☀️ Hạn hán cực đoan — 10 ngày',
    description: 'Mô phỏng 10 ngày không mưa, nhiệt độ cao, độ ẩm đất giảm sâu. Kiểm tra ngưỡng cảnh báo và logic tưới tự động.',
    duration: '10 days (accelerated)',
    timeAcceleration: 1440, // 1 day = 1 minute real time
    phases: [
      {
        name: 'Day 1-2: Drought begins',
        durationTicks: 2,
        setWeather: { rainfall: 0, temperature: 33, humidity: 45, windSpeed: 12 },
        setSoil: { moisture: 50 },
        notes: 'Bắt đầu khô hạn, đất còn ẩm'
      },
      {
        name: 'Day 3-4: Soil drying',
        durationTicks: 2,
        setWeather: { rainfall: 0, temperature: 35, humidity: 40, windSpeed: 15 },
        notes: 'Đất bắt đầu khô, EC tăng'
      },
      {
        name: 'Day 5-6: Critical moisture',
        durationTicks: 2,
        setWeather: { rainfall: 0, temperature: 37, humidity: 35, windSpeed: 18 },
        notes: 'Độ ẩm đất xuống dưới ngưỡng, cảnh báo cấp bách'
      },
      {
        name: 'Day 7-8: Severe drought',
        durationTicks: 2,
        setWeather: { rainfall: 0, temperature: 39, humidity: 30, windSpeed: 20 },
        notes: 'Hạn hán nghiêm trọng, cây héo'
      },
      {
        name: 'Day 9-10: Extreme drought',
        durationTicks: 2,
        setWeather: { rainfall: 0, temperature: 40, humidity: 25, windSpeed: 22 },
        notes: 'Hạn hán cực đoan, EC đất nhiễm mặn'
      }
    ]
  },

  // ─── Monsoon / Flooding ─────────────────────────────
  monsoon_5day: {
    name: '🌧️ Mùa mưa — 5 ngày mưa liên tục',
    description: 'Mô phỏng mưa lớn liên tục 5 ngày, kiểm tra ngập úng và thoát nước.',
    timeAcceleration: 1440,
    phases: [
      {
        name: 'Day 1: Light rain',
        durationTicks: 1,
        setWeather: { rainfall: 15, temperature: 25, humidity: 85 },
        notes: 'Mưa nhẹ bắt đầu'
      },
      {
        name: 'Day 2-3: Heavy rain',
        durationTicks: 2,
        setWeather: { rainfall: 45, temperature: 24, humidity: 92 },
        notes: 'Mưa to liên tục'
      },
      {
        name: 'Day 4: Flooding risk',
        durationTicks: 1,
        setWeather: { rainfall: 60, temperature: 23, humidity: 95 },
        notes: 'Nguy cơ ngập úng cao'
      },
      {
        name: 'Day 5: Rain eases',
        durationTicks: 1,
        setWeather: { rainfall: 10, temperature: 26, humidity: 80 },
        notes: 'Mưa giảm dần'
      }
    ]
  },

  // ─── Heatwave ───────────────────────────────────────
  heatwave_3day: {
    name: '🌡️ Nắng nóng cực đoan — 3 ngày',
    description: 'Nhiệt độ trên 40°C, kiểm tra stress nhiệt và nhu cầu tưới tăng.',
    timeAcceleration: 1440,
    phases: [
      {
        name: 'Day 1: Heat builds',
        durationTicks: 1,
        setWeather: { temperature: 38, humidity: 35, rainfall: 0, windSpeed: 5 },
        notes: 'Nhiệt độ bắt đầu tăng'
      },
      {
        name: 'Day 2: Peak heat',
        durationTicks: 1,
        setWeather: { temperature: 42, humidity: 25, rainfall: 0, windSpeed: 3 },
        notes: 'Đỉnh nắng nóng'
      },
      {
        name: 'Day 3: Slight relief',
        durationTicks: 1,
        setWeather: { temperature: 40, humidity: 30, rainfall: 0, windSpeed: 8 },
        notes: 'Nóng nhưng giảm nhẹ'
      }
    ]
  },

  // ─── Sensor Fault Sequence ──────────────────────────
  sensor_fault_sequence: {
    name: '🔧 Chuỗi lỗi cảm biến',
    description: 'Mô phỏng nhiều loại lỗi cảm biến liên tiếp: treo → trôi → dữ liệu rác → phục hồi.',
    timeAcceleration: 60, // 1 tick = 1 real minute
    phases: [
      {
        name: 'Normal operation',
        durationTicks: 5,
        notes: 'Hoạt động bình thường'
      },
      {
        name: 'Sensor freeze',
        durationTicks: 8,
        applyFault: 'sensor_stuck',
        notes: 'Cảm biến bị treo, giá trị đứng yên'
      },
      {
        name: 'Sensor drift',
        durationTicks: 8,
        applyFault: 'sensor_drift',
        notes: 'Cảm biến trôi giá trị sau khi "thaw"'
      },
      {
        name: 'Garbage data',
        durationTicks: 5,
        applyFault: 'garbage_data',
        notes: 'Cảm biến gửi dữ liệu rác'
      },
      {
        name: 'Recovery',
        durationTicks: 5,
        notes: 'Cảm biến phục hồi sau reset'
      }
    ]
  },

  // ─── Gateway Failure ────────────────────────────────
  gateway_failure: {
    name: '💥 Lỗi Gateway',
    description: 'E870 gateway bị crash, mất kết nối 20 phút, sau đó phục hồi.',
    timeAcceleration: 60,
    phases: [
      {
        name: 'Normal',
        durationTicks: 5,
        notes: 'Gateway hoạt động bình thường'
      },
      {
        name: 'Gateway down',
        durationTicks: 20,
        applyFault: 'gateway_failure',
        notes: 'Gateway bị crash — mất toàn bộ dữ liệu'
      },
      {
        name: 'Gateway recovery',
        durationTicks: 10,
        notes: 'Gateway khởi động lại, kết nối phục hồi'
      }
    ]
  },

  // ─── Deep Sleep (E90 Energy Optimization) ──────────
  deep_sleep_cycle: {
    name: '💤 Chu kỳ Deep Sleep — E90 Node',
    description: 'Mô phỏng E90-DTU ở chế độ ngủ sâu 95% thời gian (wake 5 phút/giờ). Kiểm tra data gap và interpolation.',
    timeAcceleration: 360, // 1 tick = 6 real minutes
    phases: [
      {
        name: 'Active transmission',
        durationTicks: 1,
        notes: 'Node thức dậy, gửi data trong 5 phút'
      },
      {
        name: 'Deep sleep',
        durationTicks: 9,
        applyFault: 'gateway_down', // reuse: no data during sleep
        notes: 'Node ngủ sâu 55 phút — không có data'
      }
    ],
    loop: true // Repeat this cycle
  },

  // ─── Full Day Simulation ────────────────────────────
  full_day_daklak: {
    name: '☕ 1 ngày đầy đủ tại DakLak',
    description: 'Mô phỏng 24h với chu kỳ ngày/đêm thực tế, mưa chiều, và tưới sáng sớm.',
    timeAcceleration: 3600, // 1 day = 24 seconds real time
    phases: [
      {
        name: '00:00-06:00 Night',
        durationTicks: 6,
        setWeather: { temperature: 22, humidity: 85, rainfall: 0 },
        notes: 'Đêm lạnh, độ ẩm cao'
      },
      {
        name: '06:00-10:00 Morning',
        durationTicks: 4,
        setWeather: { temperature: 26, humidity: 70, rainfall: 0 },
        notes: 'Sáng sớm, tưới tự động có thể kích hoạt'
      },
      {
        name: '10:00-14:00 Hot noon',
        durationTicks: 4,
        setWeather: { temperature: 35, humidity: 50, rainfall: 0 },
        notes: 'Trưa nóng, ET₀ cao'
      },
      {
        name: '14:00-18:00 Afternoon rain',
        durationTicks: 4,
        setWeather: { temperature: 30, humidity: 75, rainfall: 25 },
        notes: 'Chiều mưa rào (typical DakLak)'
      },
      {
        name: '18:00-24:00 Evening',
        durationTicks: 6,
        setWeather: { temperature: 25, humidity: 80, rainfall: 5 },
        notes: 'Tối mát, mưa nhỏ'
      }
    ]
  },

  // ─── Nutrient Depletion ─────────────────────────────
  nutrient_depletion: {
    name: '🍂 Cạn kiệt dinh dưỡng — 30 ngày',
    description: 'Đất mất dần NPK do mưa lớn và không bón phân. Kiểm tra cảnh báo thiếu dinh dưỡng.',
    timeAcceleration: 1440,
    phases: [
      {
        name: 'Heavy rain leaching',
        durationTicks: 15,
        setWeather: { rainfall: 35, temperature: 25, humidity: 85 },
        setSoil: { nitrogen: 80, phosphorus: 25, potassium: 120 },
        notes: 'Mưa lớn rửa trôi dinh dưỡng'
      },
      {
        name: 'Continued depletion',
        durationTicks: 15,
        setWeather: { rainfall: 20, temperature: 26, humidity: 80 },
        notes: 'Dinh dưỡng tiếp tục giảm, cây thiếu NPK'
      }
    ]
  }
};

module.exports = { SCENARIOS };
