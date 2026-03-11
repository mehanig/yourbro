// Command genkey generates an Ed25519 keypair for identity token signing.
// Usage: go run ./api/cmd/genkey
// Output: IDENTITY_SIGNING_KEY=<base64> (add to your .env)
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
)

func main() {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("Failed to generate key: %v", err)
	}
	fmt.Printf("IDENTITY_SIGNING_KEY=%s\n", base64.StdEncoding.EncodeToString(priv))
}
