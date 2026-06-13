// SmartFarm DakLak — Telegram Notification Module
// Send alerts and summaries to Telegram via Bot API

const https = require('https');

let config = {
  botToken: null,
  chatId: null,
  enabled: false,
  silentHours: { start: 22, end: 6 }, // Don't send non-critical during these hours
  throttleMs: 60000, // Min gap between same alert type
  lastSent: new Map()
};

function init(envConfig = {}) {
  config.botToken = envConfig.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || null;
  config.chatId = envConfig.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || null;
  config.enabled = !!(config.botToken && config.chatId);

  if (config.enabled) {
    console.log(`[Telegram] Enabled — chat_id=${config.chatId}`);
  } else {
    console.log('[Telegram] Disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable');
  }
}

function isSilentHour() {
  const hour = new Date().getHours();
  return hour >= config.silentHours.start || hour < config.silentHours.end;
}

function shouldThrottle(key) {
  const last = config.lastSent.get(key);
  if (!last) return false;
  return (Date.now() - last) < config.throttleMs;
}

function markSent(key) {
  config.lastSent.set(key, Date.now());
  // Cleanup old entries
  if (config.lastSent.size > 100) {
    const cutoff = Date.now() - 3600000;
    for (const [k, v] of config.lastSent) {
      if (v < cutoff) config.lastSent.delete(k);
    }
  }
}

function sendMessage(text, options = {}) {
  if (!config.enabled) return Promise.resolve(false);

  const { silent = false, parseMode = 'HTML' } = options;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: parseMode,
      disable_notification: silent
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${config.botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.ok) {
            resolve(true);
          } else {
            console.warn('[Telegram] API error:', json.description);
            resolve(false);
          }
        } catch (e) {
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[Telegram] Request error:', err.message);
      resolve(false);
    });

    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
    req.write(payload);
    req.end();
  });
}

function formatAlert(severity, title, message, zoneName) {
  const icons = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };
  const icon = icons[severity] || '📢';
  const zone = zoneName ? `📍 ${zoneName}\n` : '';
  return `${icon} <b>${title}</b>\n${zone}${message}`;
}

function formatSensorSummary(zoneName, sensor, stage) {
  let text = `📊 <b>${zoneName}</b>\n`;
  if (stage) text += `🌱 ${stage.name}\n`;
  text += `\n💧 Độ ẩm: <b>${sensor.moisture?.toFixed(1) ?? '--'}%</b>`;
  text += `\n🌡️ Nhiệt độ: <b>${sensor.temperature?.toFixed(1) ?? '--'}°C</b>`;
  text += `\n⚡ EC: <b>${sensor.ec ?? '--'}</b> µS/cm`;
  text += `\n🧪 pH: <b>${sensor.ph?.toFixed(1) ?? '--'}</b>`;
  text += `\n🌿 N: ${sensor.nitrogen ?? '--'} | P: ${sensor.phosphorus ?? '--'} | K: ${sensor.potassium ?? '--'}`;
  return text;
}

function formatDailySummary(zones, zoneSensorData, weather, advisories) {
  let text = `📋 <b>BÁO CÁO NGÀY — SmartFarm DakLak</b>\n`;
  text += `🕐 ${new Date().toLocaleDateString('vi-VN')}\n`;

  if (weather) {
    text += `\n🌤️ <b>Thời tiết:</b> ${weather.temperature?.toFixed(0) ?? '--'}°C, `;
    text += `💧 ${weather.humidity?.toFixed(0) ?? '--'}%, `;
    text += `🌧️ ${weather.rainfall?.toFixed(0) ?? '0'}mm`;
  }

  text += `\n\n─── <b>Khu vực</b> ───`;
  for (const zone of zones) {
    const sensor = zoneSensorData[zone.id] || {};
    const advisory = advisories?.[zone.id];
    const urgencyIcon = advisory?.urgency === 'critical' ? '🔴' : advisory?.urgency === 'warning' ? '🟡' : '🟢';
    text += `\n\n${urgencyIcon} <b>${zone.name}</b>`;
    text += `\n   💧 ${sensor.moisture?.toFixed(1) ?? '--'}% · 🌡️ ${sensor.temperature?.toFixed(1) ?? '--'}°C`;
    if (advisory?.advices?.[0]) {
      text += `\n   ${advisory.advices[0].icon} ${advisory.advices[0].message.substring(0, 60)}`;
    }
  }

  return text;
}

async function sendAlert(severity, title, message, zoneName) {
  // Throttle non-critical alerts
  const key = `${severity}:${title}`;
  if (severity !== 'critical' && shouldThrottle(key)) return false;
  if (severity !== 'critical' && isSilentHour()) return false;

  const text = formatAlert(severity, title, message, zoneName);
  const sent = await sendMessage(text, { silent: severity === 'info' });
  if (sent) markSent(key);
  return sent;
}

async function sendSensorUpdate(zoneName, sensor, stage) {
  if (isSilentHour()) return false;
  const text = formatSensorSummary(zoneName, sensor, stage);
  return sendMessage(text, { silent: true });
}

async function sendDailySummary(zones, zoneSensorData, weather, advisories) {
  const text = formatDailySummary(zones, zoneSensorData, weather, advisories);
  return sendMessage(text);
}

async function sendActivityNotification(activity, zoneName) {
  const typeDef = require('./activity-log').ACTIVITY_TYPES[activity.type] || { icon: '📝', label: activity.type };
  let text = `${typeDef.icon} <b>${typeDef.label}</b>`;
  if (zoneName) text += ` — ${zoneName}`;
  text += `\n${activity.title}`;
  if (activity.description) text += `\n${activity.description}`;
  if (activity.quantity) text += `\n📦 ${activity.quantity} ${activity.unit || ''}`;
  if (activity.product) text += `\n🏷️ ${activity.product}`;
  return sendMessage(text, { silent: true });
}

function getStatus() {
  return {
    enabled: config.enabled,
    chatId: config.chatId ? `${config.chatId.substring(0, 4)}...` : null,
    silentHours: config.silentHours
  };
}

module.exports = {
  init,
  sendMessage,
  sendAlert,
  sendSensorUpdate,
  sendDailySummary,
  sendActivityNotification,
  getStatus
};
