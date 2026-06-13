// Advisory logic - extracted for testability

const CROP_STAGES = {
  robusta: {
    name: 'Cà phê Robusta',
    stages: [
      {
        id: 'dormant', name: 'Nghỉ (Rụng lá)', months: [11, 12, 1], durationDays: 90,
        description: 'Cây rụng lá, nghỉ sinh dưỡng sau vụ thu hoạch',
        irrigation: { target: 30, frequency: '2 tuần/lần', notes: 'Giữ ẩm nhẹ, không tưới nhiều' },
        fertilization: { N: 0, P: 0, K: 0, notes: 'Bón phân chuồng hoai mục + vôi bột' },
        risks: ['Sâu bệnh ẩn trong vỏ cây', 'Đất khô nứt nếu không tưới duy trì']
      },
      {
        id: 'flowering', name: 'Ra hoa', months: [2, 3], durationDays: 45,
        description: 'Cây ra hoa trắng, cần nước kích thích nở hoa đồng đều',
        irrigation: { target: 55, frequency: '1 lần/tuần', notes: 'Tưới đẫm kích thích ra hoa.' },
        fertilization: { N: 40, P: 60, K: 40, notes: 'Bón phân lân (P) để kích thích ra hoa' },
        risks: ['Mưa trái mùa gây rụng hoa', 'Thiếu nước = hoa không nở']
      },
      {
        id: 'fruit-set', name: 'Đậu quả', months: [3, 4, 5], durationDays: 60,
        description: 'Quả non bắt đầu phát triển',
        irrigation: { target: 60, frequency: '1 lần/tuần', notes: 'Tưới đều đặn' },
        fertilization: { N: 60, P: 30, K: 60, notes: 'Bón NPK 20-10-10 + phân bón lá' },
        risks: ['Rụng quả non nếu stress nước', 'Thiếu Kali = quả nhỏ']
      },
      {
        id: 'fruit-growth', name: 'Phát triển quả', months: [5, 6, 7, 8], durationDays: 120,
        description: 'Quả lớn dần, tích lũy chất khô',
        irrigation: { target: 55, frequency: '1-2 lần/tuần', notes: 'Tưới duy trì' },
        fertilization: { N: 30, P: 20, K: 80, notes: 'Bón Kali (K) cao' },
        risks: ['Mưa nhiều → ngập úng', 'Bệnh thán thư']
      },
      {
        id: 'ripening', name: 'Chín', months: [9, 10], durationDays: 60,
        description: 'Quả chuyển từ xanh → đỏ',
        irrigation: { target: 40, frequency: 'Giảm tưới', notes: 'Giảm nước để quả chín đều' },
        fertilization: { N: 0, P: 0, K: 40, notes: 'Bón Kali nhẹ' },
        risks: ['Mưa nhiều → quả thối', 'Chín không đều']
      },
      {
        id: 'harvest', name: 'Thu hoạch', months: [10, 11], durationDays: 45,
        description: 'Thu hoạch quả chín đỏ',
        irrigation: { target: 35, frequency: 'Tưới nhẹ sau thu hoạch', notes: 'Tưới phục hồi' },
        fertilization: { N: 20, P: 20, K: 20, notes: 'Bón phân phục hồi' },
        risks: ['Thiếu nhân công thu hoạch', 'Quả rụng mất']
      }
    ]
  },
  arabica: {
    name: 'Cà phê Arabica',
    stages: [
      {
        id: 'dormant', name: 'Nghỉ', months: [11, 12, 1], durationDays: 90,
        description: 'Giai đoạn nghỉ sau thu hoạch',
        irrigation: { target: 30, frequency: '2 tuần/lần', notes: 'Giữ ẩm nhẹ' },
        fertilization: { N: 0, P: 0, K: 0, notes: 'Bón phân chuồng + vôi' },
        risks: ['Sâu bệnh', 'Đất khô']
      },
      {
        id: 'flowering', name: 'Ra hoa', months: [2, 3], durationDays: 40,
        description: 'Hoa trắng, thơm',
        irrigation: { target: 55, frequency: '1 lần/tuần', notes: 'Tưới đẫm' },
        fertilization: { N: 30, P: 50, K: 30, notes: 'Bón lân kích thích ra hoa' },
        risks: ['Mưa trái mùa', 'Thiếu nước']
      },
      {
        id: 'fruit-set', name: 'Đậu quả', months: [3, 4], durationDays: 50,
        description: 'Quả non phát triển',
        irrigation: { target: 60, frequency: '1 lần/tuần', notes: 'Tưới đều' },
        fertilization: { N: 50, P: 25, K: 50, notes: 'NPK 20-10-10' },
        risks: ['Rụng quả non', 'Bệnh gỉ sắt']
      },
      {
        id: 'fruit-growth', name: 'Phát triển quả', months: [4, 5, 6, 7, 8], durationDays: 150,
        description: 'Quả lớn',
        irrigation: { target: 60, frequency: '2 lần/tuần', notes: 'Arabica nhạy cảm thiếu nước hơn' },
        fertilization: { N: 30, P: 20, K: 70, notes: 'Kali cao cho quả to' },
        risks: ['Nhiệt độ cao → stress', 'Thiếu nước → quả nhỏ']
      },
      {
        id: 'ripening', name: 'Chín', months: [9, 10], durationDays: 60,
        description: 'Quả chín đỏ',
        irrigation: { target: 45, frequency: 'Giảm', notes: 'Giảm nước cho quả chín đều' },
        fertilization: { N: 0, P: 0, K: 30, notes: 'Kali nhẹ' },
        risks: ['Quả thối nếu mưa']
      },
      {
        id: 'harvest', name: 'Thu hoạch', months: [10, 11], durationDays: 45,
        description: 'Thu hái chọn lọc',
        irrigation: { target: 35, frequency: 'Phục hồi', notes: 'Tưới phục hồi' },
        fertilization: { N: 20, P: 20, K: 20, notes: 'Phục hồi sau thu hoạch' },
        risks: ['Nhân công', 'Chín không đều']
      }
    ]
  }
};

function getCurrentStage(crop, date = new Date()) {
  const month = date.getMonth() + 1;
  const cropData = CROP_STAGES[crop];
  if (!cropData) return null;
  return cropData.stages.find(s => s.months.includes(month)) || cropData.stages[0];
}

function getPlantAge(plantDate) {
  const planted = new Date(plantDate);
  const now = new Date();
  if (isNaN(planted.getTime())) return { months: 0, years: 0 };
  const months = (now.getFullYear() - planted.getFullYear()) * 12 + (now.getMonth() - planted.getMonth());
  return { months, years: Math.floor(months / 12) };
}

function generateAdvisory(zone, sensorData, irrigationRule, weatherData) {
  const sensor = sensorData;
  const rule = irrigationRule;
  const stage = getCurrentStage(zone.crop);
  const age = getPlantAge(zone.plantDate);
  const advices = [];
  let urgency = 'info';

  if (!stage) {
    advices.push({ type: 'error', message: 'Không xác định được giai đoạn cây trồng' });
    return { advices, urgency, stage: null };
  }

  // Moisture Advisory
  if (sensor.moisture < rule.moistureMin) {
    urgency = 'critical';
    advices.push({
      type: 'irrigation', icon: '💧',
      message: `Độ ẩm đất thấp (${sensor.moisture.toFixed(1)}% < ${rule.moistureMin}%). Cần tưới NGAY cho ${zone.name}.`,
      action: `Tưới ${stage.irrigation.frequency} — ${stage.irrigation.notes}`
    });
  } else if (sensor.moisture > rule.moistureMax) {
    urgency = 'warning';
    advices.push({
      type: 'drainage', icon: '🌊',
      message: `Độ ẩm đất cao (${sensor.moisture.toFixed(1)}% > ${rule.moistureMax}%). Kiểm tra thoát nước.`,
      action: 'Mở van thoát nước, kiểm tra hệ thống cống'
    });
  } else {
    advices.push({
      type: 'irrigation', icon: '✅',
      message: `Độ ẩm đất ổn định (${sensor.moisture.toFixed(1)}%). ${stage.irrigation.notes}`,
      action: `Duy trì tưới ${stage.irrigation.frequency}`
    });
  }

  // EC/Salinity Advisory
  if (sensor.ec > 2000) {
    urgency = 'critical';
    advices.push({ type: 'salinity', icon: '🧂', message: `EC cao (${sensor.ec} µS/cm) — đất nhiễm mặn!`, action: 'Tưới xả mặn (leaching), kiểm tra nguồn nước tưới.' });
  }

  // pH Advisory
  if (sensor.ph < 4.5) {
    if (urgency === 'info') urgency = 'warning';
    advices.push({ type: 'soil', icon: '⚗️', message: `Đất chua (pH ${sensor.ph.toFixed(1)}). Cà phê cần pH 5.0-6.5.`, action: 'Bón vôi bột (dolomite) 2-3 tấn/ha.' });
  } else if (sensor.ph > 7.0) {
    if (urgency === 'info') urgency = 'warning';
    advices.push({ type: 'soil', icon: '⚗️', message: `Đất kiềm (pH ${sensor.ph.toFixed(1)}). Cà phê cần pH 5.0-6.5.`, action: 'Bón lưu huỳnh (S) hoặc phân chua.' });
  }

  // Temperature Advisory
  if (sensor.temperature > 38) {
    if (urgency === 'info') urgency = 'warning';
    advices.push({ type: 'temperature', icon: '🌡️', message: `Nhiệt độ đất cao (${sensor.temperature.toFixed(1)}°C). Cây có thể bị stress nhiệt.`, action: 'Tưới làm mát, phủ rơm rạ.' });
  }

  // Weather-based Advisory
  if (weatherData && weatherData.rainfall > 20) {
    advices.push({ type: 'weather', icon: '🌧️', message: `Mưa lớn (${weatherData.rainfall}mm). Tạm dừng tưới.`, action: 'Kiểm tra thoát nước.' });
  }

  // Stage-specific risks
  if (stage.risks && stage.risks.length > 0) {
    advices.push({ type: 'risk', icon: '⚠️', message: `Rủi ro giai đoạn ${stage.name}:`, details: stage.risks });
  }

  // Plant age advisory
  if (age.months < 12) {
    advices.push({ type: 'info', icon: '🌱', message: `Cây còn non (${age.months} tháng). Chăm sóc đặc biệt.` });
  }

  return { advices, urgency, stage };
}

module.exports = {
  CROP_STAGES,
  getCurrentStage,
  getPlantAge,
  generateAdvisory
};
