export default () => ({
  // ===========================================================================
  // Application
  // ===========================================================================

  app: {
    name:
      process.env.APP_NAME ??
      "sms-gateway-routing-service",

    version:
      process.env.APP_VERSION ??
      "1.0.0",

    environment:
      process.env.NODE_ENV ??
      "development",

    host:
      process.env.APP_HOST ??
      "0.0.0.0",

    port:
      Number.parseInt(
        process.env.APP_PORT ??
        "9003",
        10,
      ),
  },

  // ===========================================================================
  // Database
  // ===========================================================================

  database: {
    url:
      process.env.DATABASE_URL!,
  },

  // ===========================================================================
  // RabbitMQ
  // ===========================================================================

  rabbitmq: {
    url:
      process.env.RABBITMQ_URL!,

    connectionName:
      process.env.RABBITMQ_CONNECTION_NAME ??
      "sms-gateway-routing-service",

    heartbeat:
      Number.parseInt(
        process.env.RABBITMQ_HEARTBEAT ??
        "60",
        10,
      ),

    reconnectDelay:
      Number.parseInt(
        process.env.RABBITMQ_RECONNECT_DELAY ??
        "1000",
        10,
      ),

    maxReconnectDelay:
      Number.parseInt(
        process.env.RABBITMQ_MAX_RECONNECT_DELAY ??
        "30000",
        10,
      ),

    maxReconnectAttempts:
      process.env.RABBITMQ_MAX_RECONNECT_ATTEMPTS
        ? Number.parseInt(
          process.env.RABBITMQ_MAX_RECONNECT_ATTEMPTS,
          10,
        )
        : undefined,

    autoRecover:
      process.env.RABBITMQ_AUTO_RECOVER !==
      "false",
  },

  // ===========================================================================
  // Telemetry
  // ===========================================================================

  telemetry: {
    enabled:
      process.env.OTEL_ENABLED !==
      "false",

    serviceName:
      process.env.OTEL_SERVICE_NAME ??
      "sms-gateway-routing-service",

    serviceVersion:
      process.env.OTEL_SERVICE_VERSION ??
      "1.0.0",

    tracesEndpoint:
      process.env.OTEL_TRACES_ENDPOINT ??
      "",

    metricsEndpoint:
      process.env.OTEL_METRICS_ENDPOINT ??
      "",

    logsEndpoint:
      process.env.OTEL_LOGS_ENDPOINT ??
      "",

    exportIntervalMillis:
      Number.parseInt(
        process.env.OTEL_EXPORT_INTERVAL_MILLIS ??
        "10000",
        10,
      ),

    disableFsInstrumentation:
      process.env.OTEL_DISABLE_FS_INSTRUMENTATION ===
      "true",
  },

  // ===========================================================================
  // Logging
  // ===========================================================================

  log: {
    level:
      process.env.LOG_LEVEL ??
      "info",

    stdout:
      process.env.LOG_STDOUT !==
      "false",

    file: {
      enabled:
        process.env.LOG_FILE_ENABLED ===
        "true",

      path:
        process.env.LOG_FILE_PATH ??
        "/var/log/pague/sms-gateway-routing-service/application.log",
    },
  },

  // ===========================================================================
  // Routing
  // ===========================================================================

  routing: {
    consumerQueue:
      process.env.ROUTING_CONSUMER_QUEUE ??
      "sms.queued",

    httpQueue:
      process.env.ROUTING_HTTP_QUEUE ??
      "sms.route.http",

    smppQueue:
      process.env.ROUTING_SMPP_QUEUE ??
      "sms.route.smpp",

    resultQueue:
      process.env.ROUTING_RESULT_QUEUE ??
      "sms.route.result",
    deliveryReceiptQueue:
      process.env.ROUTING_DELIVERY_RECEIPT_QUEUE ??
      "sms.route.delivery-receipt",
    clientDlrQueue:
      process.env.ROUTING_CLIENT_DLR_QUEUE ??
      "sms.client.dlr",
  },
});