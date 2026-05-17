/**
 * OpenTelemetry SDK wiring for bot-sreality.
 *
 * `@opentelemetry/sdk-node` patches Node's module loader to wrap the
 * libraries we depend on with tracing wrappers. For that to work the
 * SDK must `start()` BEFORE any traced module is `import`-ed, which
 * is why this file is imported as the first statement in `main.ts`
 * (and why it has its own side-effect-only entry: importing it for
 * its export would be too late).
 *
 * `getNodeAutoInstrumentations()` enables every contrib instrumentation
 * shipped in `@opentelemetry/auto-instrumentations-node`, including
 * `http`, `express` (Nest's transport), `amqplib`, `mongoose`, and
 * `mongodb`. The amqplib instrumentation auto-injects W3C
 * traceparent into the `properties.headers` map of every published
 * message, so the email-notifier (Go) can extract it on the consume
 * side.
 *
 * Resource attributes (service.name, deployment.environment, …) are
 * read from `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`; the
 * exporter endpoint comes from `OTEL_EXPORTER_OTLP_ENDPOINT`. We do
 * not hard-code any of these here so the same image runs unchanged
 * in dev / staging / prod.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // Tempo rollouts make the OTLP/gRPC exporter spam WARN-level
  // "transient error, retrying" diagnostics until the next Tempo pod
  // is Ready. The SDK retries internally and drops the batch on final
  // failure, so the per-attempt logs are pure noise. ERROR level keeps
  // genuine SDK failures visible.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  });
  sdk.start();

  // Flush + shutdown on SIGTERM/SIGINT so the last batch of spans
  // doesn't get dropped when k8s rolls the pod. A failed flush during
  // shutdown is logged as a single line — typically Tempo being
  // unavailable at the moment we roll, which is recoverable on the
  // next pod start.
  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('OTel shutdown failed:', message);
      })
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  console.warn('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping telemetry init');
}
