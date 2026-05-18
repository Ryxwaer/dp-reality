import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { NodeSDK } from '@opentelemetry/sdk-node'

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  console.warn('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping telemetry init')
} else {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  })
  sdk.start()
  console.info(
    `OpenTelemetry initialised, exporting to ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`
  )

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((err) => console.error('OTel shutdown failed', err))
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
