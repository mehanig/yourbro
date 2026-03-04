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
function waitForKeypair(timeoutMs: number = 10000): Promise<{ privateKey: CryptoKey; publicKeyBytes: Uint8Array }> {
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
        });
      }
    }
    window.addEventListener("message", handler);
  });
}

export class ClawdStorage {
  private agentEndpoint: string;
  private pageSlug: string;
  private cachedPrivateKey: CryptoKey | null = null;
  private cachedPubKeyB64: string | null = null;
  private initPromise: Promise<void> | null = null;

  private constructor(agentEndpoint: string, pageSlug: string) {
    this.agentEndpoint = agentEndpoint.replace(/\/$/, "");
    this.pageSlug = pageSlug;
  }

  static async init(): Promise<ClawdStorage> {
    const endpoint = getMeta("clawd-agent-endpoint");
    const slug = getMeta("clawd-page-slug");
    if (!endpoint || !slug) {
      throw new Error("Missing clawd-agent-endpoint or clawd-page-slug meta tags");
    }
    const instance = new ClawdStorage(endpoint, slug);
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
    const res = await this.signedFetch(
      "GET",
      `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.value) as T;
  }

  async set(key: string, value: unknown): Promise<boolean> {
    const body = JSON.stringify(value);
    const res = await this.signedFetch(
      "PUT",
      `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`,
      body
    );
    return res.ok;
  }

  async list(prefix: string = ""): Promise<string[]> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const res = await this.signedFetch(
      "GET",
      `/api/storage/${encodeURIComponent(this.pageSlug)}${params}`
    );
    if (!res.ok) return [];
    const entries: Array<{ key: string }> = await res.json();
    return entries.map((e) => e.key);
  }

  async delete(key: string): Promise<boolean> {
    const res = await this.signedFetch(
      "DELETE",
      `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`
    );
    return res.ok;
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

if (endpointMeta && slugMeta) {
  ClawdStorage.init()
    .then((storage) => {
      window.clawdStorage = storage;
    })
    .catch((err) => {
      console.error("ClawdStorage init failed:", err);
    });
}
