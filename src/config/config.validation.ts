import Joi from "joi";

export const configValidationSchema =
  Joi.object({
    // =========================================================================
    // Application
    // =========================================================================

    NODE_ENV:
      Joi.string()
        .valid(
          "development",
          "test",
          "production",
        )
        .default("development"),

    APP_NAME:
      Joi.string()
        .default(
          "sms-gateway-routing-service",
        ),

    APP_VERSION:
      Joi.string()
        .default("1.0.0"),

    APP_HOST:
      Joi.string()
        .default("0.0.0.0"),

    APP_PORT:
      Joi.number()
        .integer()
        .min(1)
        .max(65535)
        .default(9003),

    // =========================================================================
    // Database
    // =========================================================================

    DATABASE_URL:
      Joi.string()
        .required(),

    // =========================================================================
    // RabbitMQ
    // =========================================================================

    RABBITMQ_URL:
      Joi.string()
        .required(),

    RABBITMQ_CONNECTION_NAME:
      Joi.string()
        .default(
          "sms-gateway-routing-service",
        ),

    RABBITMQ_HEARTBEAT:
      Joi.number()
        .integer()
        .min(1)
        .default(60),

    RABBITMQ_RECONNECT_DELAY:
      Joi.number()
        .integer()
        .min(100)
        .default(1000),

    RABBITMQ_MAX_RECONNECT_DELAY:
      Joi.number()
        .integer()
        .min(100)
        .default(30000),

    RABBITMQ_MAX_RECONNECT_ATTEMPTS:
      Joi.number()
        .integer()
        .min(1)
        .optional(),

    RABBITMQ_AUTO_CREATE_QUEUES:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(true),

    RABBITMQ_AUTO_RECOVER:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(true),

    // =========================================================================
    // Routing
    // =========================================================================

    /*
     * Queue consumed by Routing Service for newly queued messages.
     */
    ROUTING_CONSUMER_QUEUE:
      Joi.string()
        .default("sms.queued"),

    /*
     * Queue consumed by the HTTP connector client.
     */
    ROUTING_HTTP_QUEUE:
      Joi.string()
        .default("sms.http"),

    /*
     * Queue consumed by the SMPP connector client.
     */
    ROUTING_SMPP_QUEUE:
      Joi.string()
        .default("sms.smpp"),

    /*
     * Queue consumed by Routing Service for connector results.
     */
    ROUTING_RESULT_QUEUE:
      Joi.string()
        .default("sms.route.result"),

    ROUTING_CONSUMER_PREFETCH:
      Joi.number()
        .integer()
        .min(1)
        .max(1000)
        .default(10),

    // =========================================================================
    // Logging
    // =========================================================================

    LOG_LEVEL:
      Joi.string()
        .valid(
          "trace",
          "debug",
          "info",
          "warn",
          "error",
          "fatal",
        )
        .default("info"),

    LOG_STDOUT:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(true),

    LOG_FILE_ENABLED:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),

    LOG_FILE_PATH:
      Joi.string()
        .default(
          "/var/log/routing-service/application.log",
        ),

    // =========================================================================
    // OpenTelemetry
    // =========================================================================

    OTEL_ENABLED:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),

    OTEL_SERVICE_NAME:
      Joi.string()
        .default(
          "sms-gateway-routing-service",
        ),

    OTEL_SERVICE_VERSION:
      Joi.string()
        .default("1.0.0"),

    OTEL_TRACES_ENDPOINT:
      Joi.string()
        .allow("")
        .default(""),

    OTEL_METRICS_ENDPOINT:
      Joi.string()
        .allow("")
        .default(""),

    OTEL_LOGS_ENDPOINT:
      Joi.string()
        .allow("")
        .default(""),

    OTEL_EXPORT_INTERVAL_MILLIS:
      Joi.number()
        .integer()
        .min(100)
        .default(10000),

    OTEL_DISABLE_FS_INSTRUMENTATION:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),
  });