import { describe, it, expect, vi, afterEach } from "vitest";
import {
  base64RawUrlEncode,
  base64StdEncode,
  getOrCreateX25519Keypair,
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

describe("getOrCreateX25519Keypair", () => {
  it("generates a valid X25519 keypair with 32-byte public key", async () => {
    const { privateKey, publicKeyBytes } = await getOrCreateX25519Keypair();

    expect(publicKeyBytes).toBeInstanceOf(Uint8Array);
    expect(publicKeyBytes.length).toBe(32);
    expect(privateKey.algorithm.name).toBe("X25519");
    expect(privateKey.type).toBe("private");
  });

  it("returns the same keypair on second call (cached in IndexedDB)", async () => {
    const first = await getOrCreateX25519Keypair();
    const second = await getOrCreateX25519Keypair();

    expect(base64RawUrlEncode(first.publicKeyBytes)).toBe(
      base64RawUrlEncode(second.publicKeyBytes)
    );
  });

  it("re-imports private key as non-extractable", async () => {
    const { privateKey } = await getOrCreateX25519Keypair();
    expect(privateKey.extractable).toBe(false);
  });
});
