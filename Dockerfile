# Stage 1: Build Go binary
FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

# Copy protocol module (local dependency)
COPY protocol/ ./protocol/

# Cache Go modules
COPY api/go.mod api/go.sum ./api/
RUN cd api && go mod download

# Copy source
COPY api/ ./api/
COPY migrations/ ./migrations/

# Copy migrations into embed path
COPY migrations/ ./api/cmd/server/migrations/

# Copy shell.html into embed path
COPY web/public/p/shell.html ./api/cmd/server/shell.html

# Build
RUN cd api && CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

# Stage 2: Runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /server ./server
EXPOSE 8080
ENTRYPOINT ["./server"]
