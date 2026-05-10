FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY services/email-notifier/ .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /email-notifier .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /email-notifier /email-notifier

CMD ["/email-notifier"]
