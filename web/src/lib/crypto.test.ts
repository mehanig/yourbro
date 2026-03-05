import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getOrCreateKeypair,
  base64RawUrlEncode,
  base64StdEncode,
} from "./crypto";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("base64RawUrlEncode", () => {
  it("produces URL-safe output without padding", () => {
    // bytes that produce +, /, and = in standard base64
    const bytes = new Uint8Array([251, 255, 254]); // std b64: "+//+"
    const result = base64RawUrlEncode(bytes);
    expect(result).not.toContain("+");
    expect(result).not.toContain("/");
    expect(result).not.toContain("=");
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("encodes 32-byte key to 43 chars (no padding)", () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const result = base64RawUrlEncode(bytes);
    expect(result.length).toBe(43); // ceil(32*4/3) = 43 without padding
  });
});

describe("base64StdEncode", () => {
  it("produces standard base64 with padding", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = base64StdEncode(bytes);
    expect(result).toBe(btoa(String.fromCharCode(1, 2, 3)));
  });
});

describe("getOrCreateKeypair", () => {
  it("generates a valid Ed25519 keypair with 32-byte public key", async () => {
    const { privateKey, publicKeyBytes } = await getOrCreateKeypair();

    expect(publicKeyBytes).toBeInstanceOf(Uint8Array);
    expect(publicKeyBytes.length).toBe(32);
    expect(privateKey.algorithm.name).toBe("Ed25519");
    expect(privateKey.type).toBe("private");
  });

  it("returns the same keypair on second call (cached in IndexedDB)", async () => {
    const first = await getOrCreateKeypair();
    const second = await getOrCreateKeypair();

    expect(base64RawUrlEncode(first.publicKeyBytes)).toBe(
      base64RawUrlEncode(second.publicKeyBytes)
    );
  });

  it("re-imports private key as non-extractable", async () => {
    const { privateKey } = await getOrCreateKeypair();
    expect(privateKey.extractable).toBe(false);
  });

  it("private key can sign and verify", async () => {
    const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
    const data = new TextEncoder().encode("test message");

    const sig = await crypto.subtle.sign("Ed25519", privateKey, data);
    expect(sig.byteLength).toBe(64);

    // Verify with public key
    const pubKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      "Ed25519",
      true,
      ["verify"]
    );
    const valid = await crypto.subtle.verify("Ed25519", pubKey, sig, data);
    expect(valid).toBe(true);
  });

  it("signature fails verification with wrong data", async () => {
    const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
    const sig = await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode("original")
    );

    const pubKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      "Ed25519",
      true,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "Ed25519",
      pubKey,
      sig,
      new TextEncoder().encode("tampered")
    );
    expect(valid).toBe(false);
  });
});
