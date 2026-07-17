// lib/predictive-irrigation.js — Predictive Irrigation Scheduler
// Uses ET₀, crop coefficients, weather forecast, and water balance
// to predict optimal irrigation timing

const { calculateET0, calculateETc, getCropCoefficient, estimateDaysToIrrigation } = require('./eto');
const { WaterBalance } = require('./water-balance');

class PredictiveIrrigation {
  /**
   * @param {object} config
   * @param {Array} config.zones - Zone definitions
   * @param {object} config.rules - Irrigation rules per zone
   * @param {number} config.altitude - Farm altitude (m). Default 500.
   */
  constructor({ zones, rules, altitude = 500 }) {
    this.altitude = altitude;
    this.zones = zones;
    this.rules = rules;

    // Initialize water balance for each zone
    this.balances = {};
    zones.forEach(zone => {
      const rule = rules[zone.id] || {};
      this.balances[zone.id] = new WaterBalance({
        zoneId: zone.id,
        initialMoisture: rule.moistureMax ? (rule.moistureMin + rule.moistureMax) / 2 : 55,
        fieldCapacity: rule.moistureMax ?? 65,
        wiltingPoint: (rule.moistureMin ?? 35) - 10,
        moistureMin: rule.moistureMin ?? 35,
        rootDepth: 0.5,
        availableWater: 100
      });
    });
  }

  /**
   * Process sensor data and update water balance for a zone
   * @param {string} zoneId
   * @param {object} sensorData - { moisture, temperature, ... }
   * @param {object} weather - { temperature, humidity, windSpeed, rainfall, cloudCover }
   * @param {string} cropType - 'robusta' or 'arabica'
   * @param {string} stageId - Current growth stage id
   */
  processSensorData(zoneId, sensorData, weather, cropType, stageId) {
    const balance = this.balances[zoneId];
    if (!balance) return null;

    // Calculate ET₀ from weather
    const ET0 = calculateET0({
      temperature: weather.temperature,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      cloudCover: weather.cloudCover,
      altitude: this.altitude
    });

    // Get crop coefficient for current stage
    const Kc = getCropCoefficient(cropType, stageId);

    // Calculate crop ET
    const ETc = calculateETc(ET0, Kc);

    // Update water balance (hourly step)
    const result = balance.update({
      ETc: ETc ?? 0,
      rainfall: weather.rainfall ?? 0,
      irrigation: 0,
      hoursElapsed: 1
    });

    return {
      ET0,
      Kc,
      ETc,
      ...result
    };
  }

  /**
   * Get irrigation recommendation for a zone
   * @param {string} zoneId
   * @param {object} sensorData - Current sensor data
   * @param {object} weather - Current weather + forecast
   * @param {string} cropType - 'robusta' or 'arabica'
   * @param {string} stageId - Current growth stage
   * @returns {object} Irrigation recommendation
   */
  getRecommendation(zoneId, sensorData, weather, cropType, stageId) {
    const balance = this.balances[zoneId];
    const rule = this.rules[zoneId];
    if (!balance || !rule) return null;

    const ET0 = calculateET0({
      temperature: weather.temperature,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      cloudCover: weather.cloudCover,
      altitude: this.altitude
    });

    const Kc = getCropCoefficient(cropType, stageId);
    const ETc = calculateETc(ET0, Kc);

    // Current state
    const currentMoisture = sensorData.moisture;
    const moistureDeficit = rule.moistureMax - currentMoisture;

    // Predict moisture in 24h (assuming no irrigation, with forecast rain)
    const forecastRain = weather.forecast && weather.forecast[0] ? weather.forecast[0].rain : 0;
    const prediction24h = balance.predict(ETc ?? 0, forecastRain, 24);

    // Estimate days until irrigation needed
    const daysToIrrigation = estimateDaysToIrrigation(
      currentMoisture,
      rule.moistureMin,
      ETc ?? 0.5
    );

    // Decision logic
    let urgency = 'none'; // none, soon, needed, critical
    let reason = '';
    let recommendedAction = null;

    if (currentMoisture < rule.moistureMin) {
      urgency = 'critical';
      reason = `Độ ẩm (${currentMoisture.toFixed(1)}%) dưới ngưỡng tối thiểu (${rule.moistureMin}%)`;
      recommendedAction = {
        action: 'irrigate-now',
        durationMin: Math.ceil(moistureDeficit / ((ETc ?? 1) * 2)), // Rough estimate
        zone: zoneId
      };
    } else if (prediction24h.needsIrrigation) {
      urgency = 'needed';
      reason = `Dự báo độ ẩm sẽ xuống ${prediction24h.predictedMoisture}% trong 24h (ET₀=${ET0?.toFixed(1)}mm, mưa=${forecastRain}mm)`;
      recommendedAction = {
        action: 'irrigate-soon',
        durationMin: Math.ceil(moistureDeficit / ((ETc ?? 1) * 2)),
        zone: zoneId,
        deadline: '24h'
      };
    } else if (daysToIrrigation <= 2) {
      urgency = 'soon';
      reason = `Còn ~${daysToIrrigation} ngày trước khi cần tưới (ET₀=${ET0?.toFixed(1)}mm/ngày)`;
      recommendedAction = {
        action: 'monitor',
        zone: zoneId,
        estimatedDays: daysToIrrigation
      };
    } else {
      reason = `Độ ẩm ổn định, còn ~${daysToIrrigation} ngày trước khi cần tưới`;
    }

    // Check rain forecast - might delay irrigation
    let rainDelay = false;
    if (weather.forecast && weather.forecast.length > 0) {
      const tomorrowRain = weather.forecast[1] ? weather.forecast[1].rain : 0;
      const totalForecastRain = forecastRain + tomorrowRain;
      if (totalForecastRain > (rule.rainThreshold ?? 5)) {
        rainDelay = true;
        if (recommendedAction) {
          recommendedAction.action = 'delay-rain';
          recommendedAction.reason = `Dự báo mưa ${totalForecastRain.toFixed(1)}mm trong 2 ngày tới`;
        }
      }
    }

    return {
      zoneId,
      urgency,
      reason,
      rainDelay,
      recommendedAction,
      metrics: {
        ET0: ET0 ?? null,
        Kc,
        ETc: ETc ?? null,
        currentMoisture,
        predictedMoisture24h: prediction24h.predictedMoisture,
        daysToWilting: prediction24h.daysToWilting,
        daysToIrrigation
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get recommendations for all zones
   * @param {object} zoneSensorData - { zoneId: sensorData }
   * @param {object} weather - Current weather
   * @param {Array} zones - Zone definitions
   * @returns {Array} Recommendations for each zone
   */
  getAllRecommendations(zoneSensorData, weather, zones) {
    return zones.map(zone => {
      const sensor = zoneSensorData[zone.id];
      if (!sensor) return null;
      return this.getRecommendation(zone.id, sensor, weather, zone.crop, this.getCurrentStage(zone.crop));
    }).filter(Boolean);
  }

  /**
   * Get current growth stage for a crop
   */
  getCurrentStage(crop, date = new Date()) {
    const month = date.getMonth() + 1;
    const stages = {
      robusta: [
        { id: 'dormant', months: [11, 12, 1] },
        { id: 'flowering', months: [2, 3] },
        { id: 'fruit-set', months: [3, 4, 5] },
        { id: 'fruit-growth', months: [5, 6, 7, 8] },
        { id: 'ripening', months: [9, 10] },
        { id: 'harvest', months: [10, 11] }
      ],
      arabica: [
        { id: 'dormant', months: [11, 12, 1] },
        { id: 'flowering', months: [2, 3] },
        { id: 'fruit-set', months: [3, 4] },
        { id: 'fruit-growth', months: [4, 5, 6, 7, 8] },
        { id: 'ripening', months: [9, 10] },
        { id: 'harvest', months: [10, 11] }
      ]
    };

    const cropStages = stages[crop] || stages.robusta;
    return cropStages.find(s => s.months.includes(month))?.id || 'dormant';
  }

  /**
   * Get water balance state for a zone
   */
  getBalanceState(zoneId) {
    const balance = this.balances[zoneId];
    return balance ? balance.getState() : null;
  }

  /**
   * Get water balance history for a zone
   */
  getBalanceHistory(zoneId, hours = 24) {
    const balance = this.balances[zoneId];
    return balance ? balance.getHistory(hours) : [];
  }
}

module.exports = { PredictiveIrrigation };
