const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

const mqttMessagesTotal = new client.Counter({
  name: 'mqtt_messages_total',
  help: 'Total MQTT messages received',
  labelNames: ['topic']
});

const sensorReadings = new client.Gauge({
  name: 'sensor_reading_value',
  help: 'Current sensor reading values',
  labelNames: ['zone', 'parameter']
});

const irrigationEvents = new client.Counter({
  name: 'irrigation_events_total',
  help: 'Total irrigation events',
  labelNames: ['zone', 'type']
});

const activeConnections = new client.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections'
});

register.registerMetric(httpRequestDuration);
register.registerMetric(mqttMessagesTotal);
register.registerMetric(sensorReadings);
register.registerMetric(irrigationEvents);
register.registerMetric(activeConnections);

module.exports = {
  register,
  httpRequestDuration,
  mqttMessagesTotal,
  sensorReadings,
  irrigationEvents,
  activeConnections,

  middleware: (req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
      end({ method: req.method, route: req.route?.path || req.path, status_code: res.statusCode });
    });
    next();
  },

  metricsEndpoint: async (req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  }
};
