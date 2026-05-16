/**
 * Standalone OpenTelemetry preload for the Nuxt/Nitro server.
 *
 * Why a separate file (and not a Nitro plugin)? Auto-instrumentation
 * works by intercepting Node's module loader and wrapping packages at
 * require/import time. Nuxt builds the entire Nitro server into a
 * single bundle, so by the time any Nitro plugin runs, every module
 * the bundle imports (`h3`, `node:http`, `mongodb`, `amqplib`, …) is
 * already loaded — too late for the SDK to patch them.
 *
 * The fix is to start the SDK BEFORE the bundle loads, via Node's
 * `--import` flag (ESM) or Bun's `--preload` flag (dev runtime). The
 * Dockerfiles and compose files set `NODE_OPTIONS=--import …` /
 * `bun --preload …` to point at this file.
 *
 * Resource attributes (service.name, deployment.environment, …) are
 * read from `OTEL_SERVICE_NAME` + `OTEL_RESOURCE_ATTRIBUTES`. The
 * exporter endpoint comes from `OTEL_EXPORTER_OTLP_ENDPOINT`. We do
 * not hard-code any of these here so the same image runs unchanged
 * in dev / staging / prod.
 */
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
