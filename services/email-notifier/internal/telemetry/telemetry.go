// Package telemetry wires up OpenTelemetry trace export for the
// email-notifier. The endpoint is read from `OTEL_EXPORTER_OTLP_ENDPOINT`
// (typically `http://tempo:4317` in dev,
// `http://tempo.tracing.svc.cluster.local:4317` in K3s) following the
// SDK's environment-variable convention so the same binary runs
// unchanged across environments.
//
// We instrument:
//
//   - MongoDB: via `otelmongo.NewMonitor`, plugged into the driver's
//     `options.Client().SetMonitor(...)`.
//   - RabbitMQ consume: amqp091-go has no contrib instrumentation, so
//     consumer/consumer.go calls `ExtractAMQP` to pick up the
//     `traceparent` header that the bot publishers (Python aio_pika +
//     Node amqplib auto-instrumentations) inject automatically, and
//     starts a child span around the digest send.
//
// No outbound HTTP is traced because the only other wire is SMTP
// (via `net/smtp`), and trace propagation across SMTP is meaningless.
package telemetry

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "dp-reality/email-notifier"

// Setup initialises the global tracer provider + W3C TraceContext
// propagator and returns a shutdown closure that flushes pending
// spans. Returns a no-op shutdown when `OTEL_EXPORTER_OTLP_ENDPOINT`
// is unset so local builds without Tempo still work.
func Setup(ctx context.Context) (func(context.Context) error, error) {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		slog.Warn("OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping telemetry init")
		return func(context.Context) error { return nil }, nil
	}

	exporter, err := otlptracegrpc.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("create otlp exporter: %w", err)
	}

	res, err := sdkresource.New(ctx,
		sdkresource.WithFromEnv(),
		sdkresource.WithProcess(),
		sdkresource.WithTelemetrySDK(),
	)
	if err != nil {
		return nil, fmt.Errorf("build resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	slog.Info("OpenTelemetry initialised",
		"endpoint", os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))

	return tp.Shutdown, nil
}

// Tracer returns the package-private tracer for the consumer to start
// spans around digest sends.
func Tracer() trace.Tracer {
	return otel.Tracer(tracerName)
}

// amqpHeaderCarrier adapts amqp091's `Table`-typed headers map to the
// `propagation.TextMapCarrier` interface so the global propagator can
// extract traceparent / tracestate / baggage from incoming deliveries.
type amqpHeaderCarrier map[string]any

func (c amqpHeaderCarrier) Get(key string) string {
	if v, ok := c[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func (c amqpHeaderCarrier) Set(key, value string) { c[key] = value }

func (c amqpHeaderCarrier) Keys() []string {
	out := make([]string, 0, len(c))
	for k := range c {
		out = append(out, k)
	}
	return out
}

// ExtractAMQP returns a context carrying the trace context advertised
// by the publisher in the AMQP `properties.headers` map. Used by the
// consumer to continue the trace started in the bot service rather
// than start a fresh one for every digest.
func ExtractAMQP(ctx context.Context, headers map[string]any) context.Context {
	if headers == nil {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, amqpHeaderCarrier(headers))
}
