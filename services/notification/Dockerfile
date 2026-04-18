FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY services/notification/ .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /notification .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /notification /notification

CMD ["/notification"]
