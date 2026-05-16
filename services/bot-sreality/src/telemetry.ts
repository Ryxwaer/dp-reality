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
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  });
  sdk.start();

  // Flush + shutdown on SIGTERM/SIGINT so the last batch of spans
  // doesn't get dropped when k8s rolls the pod.
  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch((err: unknown) => console.error('OTel shutdown failed', err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  console.warn('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping telemetry init');
}
