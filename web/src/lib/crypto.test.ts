import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getOrCreateKeypair,
  base64RawUrlEncode,
  base64StdEncode,
  signedFetch,
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

describe("signedFetch", () => {
  function interceptFetch() {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      calls.push({ url: String(input), init });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    return calls;
  }

  it("sets RFC 9421 signature headers for bodyless request", async () => {
    const calls = interceptFetch();

    await signedFetch("DELETE", "https://agent.example.com/api/keys");

    expect(calls.length).toBe(1);
    const headers = new Headers(calls[0].init.headers as Record<string, string>);

    // Must have Signature-Input and Signature
    expect(headers.get("Signature-Input")).toMatch(/^sig1=/);
    expect(headers.get("Signature")).toMatch(/^sig1=:/);

    // No Content-Digest for bodyless request
    expect(headers.get("Content-Digest")).toBeNull();

    // Signature-Input should NOT include content-digest
    expect(headers.get("Signature-Input")).not.toContain("content-digest");
  });

  it("includes Content-Digest for requests with body", async () => {
    const calls = interceptFetch();

    await signedFetch(
      "PUT",
      "https://agent.example.com/api/storage/page/key",
      '{"count":1}'
    );

    expect(calls.length).toBe(1);
    const headers = new Headers(calls[0].init.headers as Record<string, string>);

    // Must have Content-Digest
    const digest = headers.get("Content-Digest");
    expect(digest).not.toBeNull();
    expect(digest).toMatch(/^sha-256=:.+:$/);

    // Signature-Input should include content-digest
    expect(headers.get("Signature-Input")).toContain("content-digest");
  });

  it("signature is valid Ed25519 (verifiable with public key)", async () => {
    const calls = interceptFetch();

    const url = "https://agent.example.com/api/keys";
    await signedFetch("DELETE", url);

    const headers = new Headers(calls[0].init.headers as Record<string, string>);
    const sigInput = headers.get("Signature-Input")!;
    const sigHeader = headers.get("Signature")!;

    // Extract keyid from Signature-Input
    const keyidMatch = sigInput.match(/keyid="([^"]+)"/);
    expect(keyidMatch).not.toBeNull();

    // Extract signature bytes
    const sigB64Match = sigHeader.match(/^sig1=:(.+):$/);
    expect(sigB64Match).not.toBeNull();
    const sigBytes = Uint8Array.from(atob(sigB64Match![1]), (c) =>
      c.charCodeAt(0)
    );
    expect(sigBytes.length).toBe(64);

    // Reconstruct signature base
    const params = sigInput.replace("sig1=", "");
    const sigBase = `"@method": DELETE\n"@target-uri": ${url}\n"@signature-params": ${params}`;

    // Get public key (same one used by signedFetch)
    const { publicKeyBytes } = await getOrCreateKeypair();
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
      sigBytes,
      new TextEncoder().encode(sigBase)
    );
    expect(valid).toBe(true);
  });

  it("keyid matches the public key", async () => {
    const calls = interceptFetch();

    await signedFetch("GET", "https://agent.example.com/api/storage/page/");

    const headers = new Headers(calls[0].init.headers as Record<string, string>);
    const sigInput = headers.get("Signature-Input")!;
    const keyid = sigInput.match(/keyid="([^"]+)"/)![1];

    const { publicKeyBytes } = await getOrCreateKeypair();
    expect(keyid).toBe(base64RawUrlEncode(publicKeyBytes));
  });

  it("includes nonce and created timestamp in signature params", async () => {
    const calls = interceptFetch();

    await signedFetch("GET", "https://agent.example.com/api/storage/page/");

    const headers = new Headers(calls[0].init.headers as Record<string, string>);
    const sigInput = headers.get("Signature-Input")!;

    expect(sigInput).toMatch(/created=\d+/);
    expect(sigInput).toMatch(/nonce="[^"]+"/);
  });
});
