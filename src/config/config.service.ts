import {
  Injectable,
} from "@nestjs/common";

import {
  ConfigService,
} from "@nestjs/config";

@Injectable()
export class AppConfigService {
  constructor(
    private readonly config:
      ConfigService,
  ) { }

  // =========================================================================
  // Application
  // =========================================================================

  get app() {
    return {
      name:
        this.config.getOrThrow<string>(
          "app.name",
        ),

      version:
        this.config.getOrThrow<string>(
          "app.version",
        ),

      environment:
        this.config.getOrThrow<string>(
          "app.environment",
        ),
    };
  }

  // =========================================================================
  // Database
  // =========================================================================

  get databaseUrl(): string {
    return this.config.getOrThrow<string>(
      "database.url",
    );
  }

  // =========================================================================
  // RabbitMQ
  // =========================================================================

  get rabbitmq() {
    return {
      url:
        this.config.getOrThrow<string>(
          "rabbitmq.url",
        ),

      connectionName:
        this.config.getOrThrow<string>(
          "rabbitmq.connectionName",
        ),

      heartbeat:
        this.config.getOrThrow<number>(
          "rabbitmq.heartbeat",
        ),

      reconnectDelay:
        this.config.getOrThrow<number>(
          "rabbitmq.reconnectDelay",
        ),

      maxReconnectDelay:
        this.config.getOrThrow<number>(
          "rabbitmq.maxReconnectDelay",
        ),

      maxReconnectAttempts:
        this.config.get<number>(
          "rabbitmq.maxReconnectAttempts",
        ),
      autoCreateQueues:
        this.config.getOrThrow<boolean>(
          "rabbitmq.autoCreateQueues",
        ),

      autoRecover:
        this.config.getOrThrow<boolean>(
          "rabbitmq.autoRecover",
        ),
    };
  }

  // =========================================================================
  // Routing
  // =========================================================================

  get routing() {
    return {
      consumerQueue:
        this.config.getOrThrow<string>(
          "routing.consumerQueue",
        ),
      resultQueue:
        this.config.getOrThrow<string>("routing.resultQueue"),
    };
  }

  // =========================================================================
  // Logging
  // =========================================================================

  get log() {
    return {
      level:
        this.config.getOrThrow<string>(
          "log.level",
        ),

      stdout:
        this.config.getOrThrow<boolean>(
          "log.stdout",
        ),

      file: {
        enabled:
          this.config.getOrThrow<boolean>(
            "log.file.enabled",
          ),

        path:
          this.config.getOrThrow<string>(
            "log.file.path",
          ),
      },
    };
  }

  // =========================================================================
  // OpenTelemetry
  // =========================================================================

  get telemetry() {
    return {
      enabled:
        this.config.getOrThrow<boolean>(
          "telemetry.enabled",
        ),

      serviceName:
        this.config.getOrThrow<string>(
          "telemetry.serviceName",
        ),

      serviceVersion:
        this.config.getOrThrow<string>(
          "telemetry.serviceVersion",
        ),

      tracesEndpoint:
        this.config.getOrThrow<string>(
          "telemetry.tracesEndpoint",
        ),

      metricsEndpoint:
        this.config.getOrThrow<string>(
          "telemetry.metricsEndpoint",
        ),

      logsEndpoint:
        this.config.getOrThrow<string>(
          "telemetry.logsEndpoint",
        ),

      exportIntervalMillis:
        this.config.getOrThrow<number>(
          "telemetry.exportIntervalMillis",
        ),

      disableFsInstrumentation:
        this.config.getOrThrow<boolean>(
          "telemetry.disableFsInstrumentation",
        ),
    };
  }
}