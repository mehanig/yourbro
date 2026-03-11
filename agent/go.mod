module github.com/mehanig/yourbro/agent

go 1.23

require (
	github.com/coder/websocket v1.8.12
	github.com/go-chi/chi/v5 v5.2.1
	github.com/go-chi/cors v1.2.1
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	github.com/mattn/go-sqlite3 v1.14.24
	github.com/mehanig/yourbro/protocol v0.0.0
)

replace github.com/mehanig/yourbro/protocol => ../protocol

require golang.org/x/crypto v0.32.0 // indirect
