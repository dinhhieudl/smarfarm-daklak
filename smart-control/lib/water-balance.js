// lib/water-balance.js — Soil Water Balance Model
// Tracks moisture depletion over time using ET₀ and rainfall

/**
 * Soil water balance for a zone
 */
class WaterBalance {
  /**
   * @param {object} config
   * @param {string} config.zoneId
   * @param {number} config.initialMoisture - Starting soil moisture (%)
   * @param {number} config.fieldCapacity - Field capacity moisture (%). Default 65%.
   * @param {number} config.wiltingPoint - Wilting point moisture (%). Default 25%.
   * @param {number} config.rootDepth - Effective root zone depth (m). Default 0.5.
   * @param {number} config.availableWater - Available water capacity (mm/m). Default 100.
   */
  constructor(config) {
    this.zoneId = config.zoneId;
    this.moisture = config.initialMoisture ?? 55;
    this.fieldCapacity = config.fieldCapacity ?? 65;
    this.wiltingPoint = config.wiltingPoint ?? 25;
    this.rootDepth = config.rootDepth ?? 0.5;
    this.availableWater = config.availableWater ?? 100;
    this.lastUpdate = new Date();
    this.history = []; // { time, moisture, ETc, rainfall, irrigation }
  }

  /**
   * Update water balance for a time step
   * @param {object} input
   * @param {number} input.ETc - Crop evapotranspiration (mm/day)
   * @param {number} input.rainfall - Rainfall (mm)
   * @param {number} input.irrigation - Irrigation applied (mm)
   * @param {number} input.hoursElapsed - Hours since last update (default 1)
   * @returns {object} { moisture, depletion, deficit }
   */
  update({ ETc = 0, rainfall = 0, irrigation = 0, hoursElapsed = 1 }) {
    const daysElapsed = hoursElapsed / 24;

    // Water lost to ET (mm)
    const etLoss = ETc * daysElapsed;

    // Water gained (mm)
    const waterGain = rainfall + irrigation;

    // Net water change (mm)
    const netWater = waterGain - etLoss;

    // Convert mm to moisture percentage change
    // Total water capacity in root zone (mm)
    const totalCapacity = this.availableWater * this.rootDepth;
    const moistureChange = (netWater / totalCapacity) * 100;

    // Update moisture
    this.moisture += moistureChange;

    // Clamp to physical limits
    this.moisture = Math.max(this.wiltingPoint, Math.min(this.fieldCapacity, this.moisture));

    // Round to 1 decimal
    this.moisture = Math.round(this.moisture * 10) / 10;

    this.lastUpdate = new Date();

    // Record history (keep last 168 entries = 7 days at hourly)
    this.history.push({
      time: this.lastUpdate.toISOString(),
      moisture: this.moisture,
      ETc,
      rainfall,
      irrigation,
      netWater: Math.round(netWater * 100) / 100
    });

    if (this.history.length > 168) {
      this.history.shift();
    }

    return {
      moisture: this.moisture,
      depletion: Math.round((this.fieldCapacity - this.moisture) * 10) / 10,
      deficit: this.moisture < this.wiltingPoint + 5 ? 'critical' : 'normal'
    };
  }

  /**
   * Predict moisture at future time given expected ET and rain
   * @param {number} ETc - Expected crop ET (mm/day)
   * @param {number} expectedRain - Expected rainfall (mm)
   * @param {number} hoursAhead - Hours to predict ahead
   * @returns {object} { predictedMoisture, needsIrrigation, daysToWilting }
   */
  predict(ETc, expectedRain = 0, hoursAhead = 24) {
    const daysAhead = hoursAhead / 24;
    const totalCapacity = this.availableWater * this.rootDepth;
    const etLoss = ETc * daysAhead;
    const netChange = ((expectedRain - etLoss) / totalCapacity) * 100;
    const predictedMoisture = Math.max(this.wiltingPoint, Math.min(this.fieldCapacity, this.moisture + netChange));

    // Days until wilting point (if no rain/irrigation)
    let daysToWilting = Infinity;
    if (ETc > 0) {
      const moistureAboveWilting = this.moisture - this.wiltingPoint;
      const daysOfWater = (moistureAboveWilting / 100) * totalCapacity / ETc;
      daysToWilting = Math.round(daysOfWater * 10) / 10;
    }

    return {
      predictedMoisture: Math.round(predictedMoisture * 10) / 10,
      needsIrrigation: predictedMoisture < 35,
      daysToWilting
    };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      zoneId: this.zoneId,
      moisture: this.moisture,
      fieldCapacity: this.fieldCapacity,
      wiltingPoint: this.wiltingPoint,
      lastUpdate: this.lastUpdate.toISOString(),
      historyLength: this.history.length
    };
  }

  /**
   * Get recent history
   * @param {number} hours - Number of hours of history
   */
  getHistory(hours = 24) {
    const cutoff = Date.now() - hours * 3600000;
    return this.history.filter(h => new Date(h.time).getTime() > cutoff);
  }
}

module.exports = { WaterBalance };
