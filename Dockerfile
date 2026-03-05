# Stage 1: Build SDK (needed for inline injection into page content)
FROM node:22-alpine AS sdk
WORKDIR /build/sdk
COPY sdk/package.json ./
RUN npm install --ignore-scripts && npm rebuild esbuild
COPY sdk/src/ ./src/
COPY sdk/tsconfig.json ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

# Cache Go modules
COPY api/go.mod api/go.sum ./api/
RUN cd api && go mod download

# Copy source
COPY api/ ./api/
COPY migrations/ ./migrations/

# Copy SDK bundle and migrations into embed paths
COPY --from=sdk /build/sdk/dist/clawd-storage.js ./api/cmd/server/sdk/clawd-storage.js
COPY migrations/ ./api/cmd/server/migrations/

# Build
RUN cd api && CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

# Stage 3: Runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /server ./server
EXPOSE 8080
ENTRYPOINT ["./server"]
