FROM golang:1.25-alpine AS builder

# git is needed for `go mod tidy` to fall back to direct VCS fetches
# when a module isn't available via the proxy (the
# `otelmongo` contrib module for the v2 driver is currently in that
# bucket).
RUN apk add --no-cache git

WORKDIR /app

COPY services/email-notifier/ .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /email-notifier .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /email-notifier /email-notifier

CMD ["/email-notifier"]
