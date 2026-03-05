/**
 * ClawdStorage — zero-trust client for yourbro agent-scoped storage.
 *
 * Every request is signed with the user's Ed25519 keypair via RFC 9421
 * HTTP Message Signatures. The server (yourbro.ai) is an untrusted broker
 * and never handles auth material.
 */
import { getOrCreateKeypair, base64RawUrlEncode, base64StdEncode } from "./crypto.js";

function getMeta(name: string): string {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content") || "";
}

/**
 * Wait for the parent window to send the keypair via postMessage.
 * The page host template loads the keypair from IndexedDB (main origin)
 * and relays it here because sandboxed iframes (no allow-same-origin)
 * cannot access IndexedDB.
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
  private agentEndpoint: string;
  private pageSlug: string;
  private mode: 'direct' | 'relay';
  private agentId: string;
  private cachedPrivateKey: CryptoKey | null = null;
  private cachedPubKeyB64: string | null = null;
  private initPromise: Promise<void> | null = null;
  // E2E encryption state
  private x25519PrivateKey: CryptoKey | null = null;
  private aesKey: CryptoKey | null = null;

  // JWT token extracted from iframe URL for authenticating relay requests
  private sessionToken: string | null = null;

  private constructor(agentEndpoint: string, pageSlug: string, mode: 'direct' | 'relay', agentId: string) {
    this.agentEndpoint = agentEndpoint.replace(/\/$/, "");
    this.pageSlug = pageSlug;
    this.mode = mode;
    this.agentId = agentId;
    // Extract JWT from iframe URL query param (set by page host)
    const params = new URLSearchParams(window.location.search);
    this.sessionToken = params.get("token");
  }

  static async init(): Promise<ClawdStorage> {
    const endpoint = getMeta("clawd-agent-endpoint");
    const slug = getMeta("clawd-page-slug");
    const relayMode = getMeta("clawd-relay-mode") === "true";
    const agentId = getMeta("clawd-agent-id");

    if (relayMode && slug && agentId) {
      const instance = new ClawdStorage("", slug, "relay", agentId);
      await instance.ensureKeys();
      return instance;
    }

    if (!endpoint || !slug) {
      throw new Error("Missing clawd-agent-endpoint or clawd-page-slug meta tags");
    }
    const instance = new ClawdStorage(endpoint, slug, "direct", "");
    await instance.ensureKeys();
    return instance;
  }

  private async ensureKeys(): Promise<void> {
    if (this.cachedPrivateKey) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      // In a sandboxed iframe, receive keypair from parent via postMessage.
      // Falls back to IndexedDB for non-sandboxed contexts.
      let privateKey: CryptoKey;
      let publicKeyBytes: Uint8Array;
      try {
        if (window.parent !== window) {
          // We're in an iframe — wait for parent to send keypair
          const kp = await waitForKeypair();
          privateKey = kp.privateKey;
          publicKeyBytes = kp.publicKeyBytes;
          // Capture X25519 keys for E2E encryption
          if (kp.x25519PrivateKey && kp.agentX25519PublicKeyBytes) {
            this.x25519PrivateKey = kp.x25519PrivateKey;
            await this.deriveAesKey(kp.x25519PrivateKey, kp.agentX25519PublicKeyBytes);
          }
        } else {
          const kp = await getOrCreateKeypair();
          privateKey = kp.privateKey;
          publicKeyBytes = kp.publicKeyBytes;
        }
      } catch {
        // Fallback to IndexedDB (works if same-origin)
        const kp = await getOrCreateKeypair();
        privateKey = kp.privateKey;
        publicKeyBytes = kp.publicKeyBytes;
      }
      this.cachedPrivateKey = privateKey;
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

  private async signedFetch(
    method: string,
    path: string,
    body?: string
  ): Promise<Response> {
    await this.ensureKeys();
    const url = `${this.agentEndpoint}${path}`;
    const created = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    // Content-Digest for body (RFC 9530)
    let contentDigest = "";
    if (body) {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body)
      );
      contentDigest = `sha-256=:${base64StdEncode(new Uint8Array(hash))}:`;
    }

    // RFC 9421 signature base
    const coveredComponents = body
      ? '("@method" "@target-uri" "content-digest")'
      : '("@method" "@target-uri")';
    const sigParams = `${coveredComponents};created=${created};nonce="${nonce}";keyid="${this.cachedPubKeyB64}"`;

    const lines: string[] = [
      `"@method": ${method}`,
      `"@target-uri": ${url}`,
    ];
    if (contentDigest) lines.push(`"content-digest": ${contentDigest}`);
    lines.push(`"@signature-params": ${sigParams}`);
    const signatureBase = lines.join("\n");

    const sig = await crypto.subtle.sign(
      "Ed25519",
      this.cachedPrivateKey!,
      new TextEncoder().encode(signatureBase)
    );
    const sigB64 = base64StdEncode(new Uint8Array(sig));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Signature-Input": `sig1=${sigParams}`,
      Signature: `sig1=:${sigB64}:`,
    };
    if (contentDigest) headers["Content-Digest"] = contentDigest;

    return fetch(url, { method, headers, body });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`;
    const res = this.mode === 'relay'
      ? await this.relayRequest("GET", path)
      : await this.signedFetch("GET", path);
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.value) as T;
  }

  async set(key: string, value: unknown): Promise<boolean> {
    const body = JSON.stringify(value);
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`;
    const res = this.mode === 'relay'
      ? await this.relayRequest("PUT", path, body)
      : await this.signedFetch("PUT", path, body);
    return res.ok;
  }

  async list(prefix: string = ""): Promise<string[]> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}${params}`;
    const res = this.mode === 'relay'
      ? await this.relayRequest("GET", path)
      : await this.signedFetch("GET", path);
    if (!res.ok) return [];
    const entries: Array<{ key: string }> = await res.json();
    return entries.map((e) => e.key);
  }

  async delete(key: string): Promise<boolean> {
    const path = `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`;
    const res = this.mode === 'relay'
      ? await this.relayRequest("DELETE", path)
      : await this.signedFetch("DELETE", path);
    return res.ok;
  }

  private async relayRequest(
    method: string,
    path: string,
    body?: string
  ): Promise<Response> {
    await this.ensureKeys();

    // Build the inner relay request with RFC 9421 signatures
    const url = `https://relay.internal${path}`;
    const created = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    let contentDigest = "";
    if (body) {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body)
      );
      contentDigest = `sha-256=:${base64StdEncode(new Uint8Array(hash))}:`;
    }

    const coveredComponents = body
      ? '("@method" "@target-uri" "content-digest")'
      : '("@method" "@target-uri")';
    const sigParams = `${coveredComponents};created=${created};nonce="${nonce}";keyid="${this.cachedPubKeyB64}"`;

    const lines: string[] = [
      `"@method": ${method}`,
      `"@target-uri": ${url}`,
    ];
    if (contentDigest) lines.push(`"content-digest": ${contentDigest}`);
    lines.push(`"@signature-params": ${sigParams}`);
    const signatureBase = lines.join("\n");

    const sig = await crypto.subtle.sign(
      "Ed25519",
      this.cachedPrivateKey!,
      new TextEncoder().encode(signatureBase)
    );
    const sigB64 = base64StdEncode(new Uint8Array(sig));

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Signature-Input": `sig1=${sigParams}`,
      "Signature": `sig1=:${sigB64}:`,
    };
    if (contentDigest) reqHeaders["Content-Digest"] = contentDigest;

    const innerReq = {
      id: crypto.randomUUID(),
      method,
      path,
      headers: reqHeaders,
      body: body || null,
    };

    // Build the outgoing relay envelope
    let envelope: Record<string, unknown>;
    if (this.aesKey) {
      // E2E: encrypt the inner request
      const plaintext = new TextEncoder().encode(JSON.stringify(innerReq));
      const encrypted = await this.encrypt(plaintext);
      envelope = { id: innerReq.id, encrypted: true, payload: base64StdEncode(encrypted) };
    } else {
      // Cleartext: send inner request as-is
      envelope = innerReq;
    }

    const hdrs: Record<string, string> = { "Content-Type": "application/json" };
    if (this.sessionToken) hdrs["Authorization"] = `Bearer ${this.sessionToken}`;

    const res = await fetch(`/api/relay/${this.agentId}`, {
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

const endpointMeta = getMeta("clawd-agent-endpoint");
const slugMeta = getMeta("clawd-page-slug");
const relayModeMeta = getMeta("clawd-relay-mode") === "true";

if ((endpointMeta && slugMeta) || (relayModeMeta && slugMeta)) {
  ClawdStorage.init()
    .then((storage) => {
      window.clawdStorage = storage;
    })
    .catch((err) => {
      console.error("ClawdStorage init failed:", err);
    });
}
