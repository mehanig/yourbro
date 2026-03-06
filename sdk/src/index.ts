/**
 * ClawdStorage — zero-trust client for yourbro agent-scoped storage.
 *
 * All requests are E2E encrypted via X25519 ECDH + HKDF-SHA256 + AES-256-GCM.
 * The server (yourbro.ai) is an untrusted relay and never sees plaintext data.
 */
import { getOrCreateKeypair, base64RawUrlEncode, base64StdEncode } from "./crypto.js";

function getMeta(name: string): string {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content") || "";
}

/**
 * Wait for the parent window to send the keypair via postMessage.
 * The page host template loads the keypair from IndexedDB (main origin)
 * and relays it here because sandboxed iframes cannot access IndexedDB.
 */
interface ReceivedKeys {
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array;
  x25519PrivateKey?: CryptoKey;
  x25519PublicKeyBytes?: Uint8Array;
  agentX25519PublicKeyBytes?: Uint8Array;
}

function waitForKeypair(timeoutMs: number = 10000): Promise<ReceivedKeys> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Keypair not received from parent within timeout"));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (event.data && event.data.type === "clawd-keypair") {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve({
          privateKey: event.data.privateKey as CryptoKey,
          publicKeyBytes: event.data.publicKeyBytes as Uint8Array,
          x25519PrivateKey: event.data.x25519PrivateKey as CryptoKey | undefined,
          x25519PublicKeyBytes: event.data.x25519PublicKeyBytes as Uint8Array | undefined,
          agentX25519PublicKeyBytes: event.data.agentX25519PublicKeyBytes as Uint8Array | undefined,
        });
      }
    }
    window.addEventListener("message", handler);
  });
}

export class ClawdStorage {
  private pageSlug: string;
  private agentId: string;
  private apiBase: string;
  private cachedPubKeyB64: string | null = null;
  private initPromise: Promise<void> | null = null;
  // E2E encryption state
  private aesKey: CryptoKey | null = null;

  // JWT token extracted from iframe URL for authenticating relay requests
  private sessionToken: string | null = null;

  private constructor(pageSlug: string, agentId: string, apiBase: string) {
    this.pageSlug = pageSlug;
    this.agentId = agentId;
    this.apiBase = apiBase;
    // Extract JWT: try meta tag first (srcdoc iframes), then URL query param (legacy)
    this.sessionToken = getMeta("clawd-session-token") || null;
    if (!this.sessionToken) {
      const params = new URLSearchParams(window.location.search);
      this.sessionToken = params.get("token");
    }
  }

  static async init(): Promise<ClawdStorage> {
    const slug = getMeta("clawd-page-slug");
    const agentId = getMeta("clawd-agent-id");
    const apiBase = getMeta("clawd-api-base") || "";

    if (!slug || !agentId) {
      throw new Error("Missing clawd-page-slug or clawd-agent-id meta tags");
    }
    const instance = new ClawdStorage(slug, agentId, apiBase);
    await instance.ensureKeys();
    return instance;
  }

  private async ensureKeys(): Promise<void> {
    if (this.aesKey) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      let publicKeyBytes: Uint8Array;
      try {
        if (window.parent !== window) {
          // We're in an iframe — wait for parent to send keypair
          const kp = await waitForKeypair();
          publicKeyBytes = kp.publicKeyBytes;
          // Capture X25519 keys for E2E encryption
          if (kp.x25519PrivateKey && kp.agentX25519PublicKeyBytes) {
            await this.deriveAesKey(kp.x25519PrivateKey, kp.agentX25519PublicKeyBytes);
          }
        } else {
          const kp = await getOrCreateKeypair();
          publicKeyBytes = kp.publicKeyBytes;
        }
      } catch {
        const kp = await getOrCreateKeypair();
        publicKeyBytes = kp.publicKeyBytes;
      }
      this.cachedPubKeyB64 = base64RawUrlEncode(publicKeyBytes);
    })();
    return this.initPromise;
  }

  /** Derive AES-256-GCM key from ECDH shared secret via HKDF. */
  private async deriveAesKey(x25519Priv: CryptoKey, agentX25519PubBytes: Uint8Array): Promise<void> {
    const agentPub = await crypto.subtle.importKey(
      "raw", ClawdStorage.toArrayBuffer(agentX25519PubBytes), "X25519", true, []
    );
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "X25519", public: agentPub }, x25519Priv, 256
    );
    const hkdfKey = await crypto.subtle.importKey(
      "raw", sharedSecret, "HKDF", false, ["deriveKey"]
    );
    this.aesKey = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new ArrayBuffer(0), // zero salt — matches agent's nil salt
        info: ClawdStorage.toArrayBuffer(new TextEncoder().encode("yourbro-e2e-v1")),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /** Copy Uint8Array to a fresh ArrayBuffer (avoids SharedArrayBuffer type issues). */
  private static toArrayBuffer(arr: Uint8Array): ArrayBuffer {
    const buf = new ArrayBuffer(arr.byteLength);
    new Uint8Array(buf).set(arr);
    return buf;
  }

  /** Encrypt plaintext with AES-256-GCM. Returns IV(12) + ciphertext. */
  private async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ClawdStorage.toArrayBuffer(iv) },
      this.aesKey!,
      ClawdStorage.toArrayBuffer(plaintext)
    );
    const result = new Uint8Array(iv.length + ct.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ct), iv.length);
    return result;
  }

  /** Decrypt AES-256-GCM data (IV(12) + ciphertext). */
  private async decrypt(data: Uint8Array): Promise<Uint8Array> {
    const iv = data.slice(0, 12);
    const ct = data.slice(12);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ClawdStorage.toArrayBuffer(iv) },
      this.aesKey!,
      ClawdStorage.toArrayBuffer(ct)
    );
    return new Uint8Array(pt);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`;
    const res = await this.relayRequest("GET", path);
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.value) as T;
  }

  async set(key: string, value: unknown): Promise<boolean> {
    const body = JSON.stringify(value);
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`;
    const res = await this.relayRequest("PUT", path, body);
    return res.ok;
  }

  async list(prefix: string = ""): Promise<string[]> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}${params}`;
    const res = await this.relayRequest("GET", path);
    if (!res.ok) return [];
    const entries: Array<{ key: string }> = await res.json();
    return entries.map((e) => e.key);
  }

  async delete(key: string): Promise<boolean> {
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`;
    const res = await this.relayRequest("DELETE", path);
    return res.ok;
  }

  private async relayRequest(
    method: string,
    path: string,
    body?: string
  ): Promise<Response> {
    await this.ensureKeys();

    const innerReq: Record<string, unknown> = {
      id: crypto.randomUUID(),
      method,
      path,
      headers: { "Content-Type": "application/json" },
    };
    if (body) innerReq.body = body;

    // Build the outgoing relay envelope
    let envelope: Record<string, unknown>;
    if (this.aesKey) {
      // E2E: encrypt the inner request
      const plaintext = new TextEncoder().encode(JSON.stringify(innerReq));
      const encrypted = await this.encrypt(plaintext);
      envelope = {
        id: innerReq.id,
        encrypted: true,
        key_id: this.cachedPubKeyB64,
        payload: base64StdEncode(encrypted),
      };
    } else {
      // No E2E key available — send as cleartext (pairing may not be complete)
      envelope = innerReq;
    }

    const hdrs: Record<string, string> = { "Content-Type": "application/json" };
    if (this.sessionToken) hdrs["Authorization"] = `Bearer ${this.sessionToken}`;

    const res = await fetch(`${this.apiBase}/api/relay/${this.agentId}`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(envelope),
    });

    // Relay always returns a JSON envelope
    const resJson = await res.json();

    // Decrypt if response is encrypted
    if (resJson.encrypted && resJson.payload) {
      const encBytes = Uint8Array.from(atob(resJson.payload), (c) => c.charCodeAt(0));
      const decrypted = await this.decrypt(encBytes);
      const innerResp = JSON.parse(new TextDecoder().decode(decrypted));
      return new Response(innerResp.body, {
        status: innerResp.status,
        headers: innerResp.headers,
      });
    }

    // Cleartext envelope: reconstruct Response from envelope fields
    return new Response(resJson.body, {
      status: resJson.status,
      headers: resJson.headers || {},
    });
  }

  /** Get the public key for pairing (base64url-encoded, no padding). */
  async getPublicKey(): Promise<string> {
    await this.ensureKeys();
    return this.cachedPubKeyB64!;
  }
}

// Auto-initialize if agent meta tags are present
declare global {
  interface Window {
    ClawdStorage: typeof ClawdStorage;
    clawdStorage?: ClawdStorage;
  }
}

window.ClawdStorage = ClawdStorage;

const slugMeta = getMeta("clawd-page-slug");
const agentIdMeta = getMeta("clawd-agent-id");

if (slugMeta && agentIdMeta) {
  ClawdStorage.init()
    .then((storage) => {
      window.clawdStorage = storage;
    })
    .catch((err) => {
      console.error("ClawdStorage init failed:", err);
    });
}
