"""OpenTelemetry SDK wiring for bot-bazos.

Mirrors `services/bot-bezrealitky/src/telemetry.py`; see that file for
the rationale. Identical instrumentation set because the two bots
speak the same wires (FastAPI in, httpx out, Motor/PyMongo,
aio_pika).
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

    HTTPXClientInstrumentor().instrument()
    PymongoInstrumentor().instrument()
    AioPikaInstrumentor().instrument()

    logger.info(
        "OpenTelemetry initialised, exporting to %s",
        os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
    )


def instrument_fastapi(app) -> None:  # noqa: ANN001
    if not isinstance(trace.get_tracer_provider(), TracerProvider):
        return
    FastAPIInstrumentor.instrument_app(app)
