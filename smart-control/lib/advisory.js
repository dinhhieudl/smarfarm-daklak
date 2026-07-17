const { CROP_STAGES, getCurrentStage } = require('./crop-data');

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
