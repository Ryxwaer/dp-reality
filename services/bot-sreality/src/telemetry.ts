import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  });
  sdk.start();

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
