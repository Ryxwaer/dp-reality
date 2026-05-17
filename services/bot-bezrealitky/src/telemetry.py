"""OpenTelemetry SDK wiring for bot-bezrealitky.

Emits OTLP/gRPC spans to the endpoint declared in
`OTEL_EXPORTER_OTLP_ENDPOINT` (typically `http://tempo:4317` in dev,
`http://tempo.tracing.svc.cluster.local:4317` in K3s). The four
instrumentations cover every wire this service speaks on:

  * `FastAPIInstrumentor`  -> incoming `/configure`, `/configs/*`, …
                              calls from the BFF reverse-proxy
  * `HTTPXClientInstrumentor` -> outgoing `bezrealitky.cz` GraphQL
                                 fetches and Nominatim geo lookups
  * `PymongoInstrumentor`  -> Motor's wire layer is PyMongo
  * `AioPikaInstrumentor`  -> publishes onto the
                              `notify.bot.processed` /
                              `notify.bot.welcome` fanout exchanges,
                              and propagates the active span context
                              into AMQP message headers so the
                              email-notifier can continue the trace

Resource attributes (`service.name`, `deployment.environment`, …)
come from `OTEL_SERVICE_NAME` + `OTEL_RESOURCE_ATTRIBUTES`, which are
read by the SDK's default `OTELResourceDetector`. We do not hard-code
them here so the same image runs unchanged in dev / staging / prod.
"""
from __future__ import annotations

import logging
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.aio_pika import AioPikaInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger(__name__)


def setup_telemetry() -> None:
    """Initialise the global tracer provider + span exporter.

    Idempotent: a second call reuses the existing provider.
    """
    if isinstance(trace.get_tracer_provider(), TracerProvider):
        return

    if not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        logger.warning(
            "OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping telemetry init"
        )
        return

    resource = Resource.create()
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    # Tempo rollouts cause the OTLP exporter to spam "Transient error
    # ... retrying" at WARNING and "Failed to export" at ERROR every
    # few seconds until the next pod is Ready. The BatchSpanProcessor
    # already handles the retry and drops the batch on final failure,
    # so the per-attempt logs are pure noise. Keep CRITICAL so a
    # totally broken exporter still surfaces.
    logging.getLogger(
        "opentelemetry.exporter.otlp.proto.grpc.exporter"
    ).setLevel(logging.CRITICAL)

    HTTPXClientInstrumentor().instrument()
    PymongoInstrumentor().instrument()
    AioPikaInstrumentor().instrument()

    logger.info(
        "OpenTelemetry initialised, exporting to %s",
        os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
    )


def instrument_fastapi(app) -> None:  # noqa: ANN001 — FastAPI imported lazily
    """Hook FastAPI's request middleware into the active tracer.

    Called from `api.build_app` once the FastAPI instance exists, since
    `FastAPIInstrumentor` patches a specific app rather than the
    framework module.
    """
    if not isinstance(trace.get_tracer_provider(), TracerProvider):
        return
    FastAPIInstrumentor.instrument_app(app)
