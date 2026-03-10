FROM golang:1.23-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build

# Copy protocol module (local dependency)
COPY protocol/ ./protocol/

COPY agent/ ./agent/
RUN cd agent && CGO_ENABLED=1 go build -o /build/yourbro-agent ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

COPY --from=builder /build/yourbro-agent /usr/local/bin/yourbro-agent

VOLUME /data
EXPOSE 80 8443

ENTRYPOINT ["yourbro-agent"]
