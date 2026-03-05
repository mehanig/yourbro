FROM golang:1.23-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build
COPY agent/ .
RUN CGO_ENABLED=1 go build -o yourbro-agent ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

COPY --from=builder /build/yourbro-agent /usr/local/bin/yourbro-agent

VOLUME /data
EXPOSE 80 8443

ENTRYPOINT ["yourbro-agent"]
