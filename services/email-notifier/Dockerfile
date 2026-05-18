FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY services/email-notifier/ .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /email-notifier .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /email-notifier /email-notifier

CMD ["/email-notifier"]
