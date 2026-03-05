"use strict";
(() => {
  // src/crypto.ts
  var DB_NAME = "clawd-keys";
  var STORE_NAME = "keypair";
  var KEY_ID = "default";
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function loadFromIndexedDB() {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(KEY_ID);
        req.onsuccess = () => {
          if (req.result) {
            resolve(req.result);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }
  async function saveToIndexedDB(privateKey, publicKeyBytes) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ privateKey, publicKeyBytes }, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getOrCreateKeypair() {
    const cached = await loadFromIndexedDB();
    if (cached) return cached;
    const temp = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify"
    ]);
    const pubRaw = await crypto.subtle.exportKey("raw", temp.publicKey);
    const publicKeyBytes = new Uint8Array(pubRaw);
    const privPkcs8 = await crypto.subtle.exportKey("pkcs8", temp.privateKey);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privPkcs8,
      "Ed25519",
      false,
      // non-extractable
      ["sign"]
    );
    new Uint8Array(privPkcs8).fill(0);
    await saveToIndexedDB(privateKey, publicKeyBytes);
    return { privateKey, publicKeyBytes };
  }
  function base64RawUrlEncode(bytes) {
    const binStr = String.fromCharCode(...bytes);
    return btoa(binStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function base64StdEncode(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  // src/index.ts
  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el?.getAttribute("content") || "";
  }
  var ClawdStorage = class _ClawdStorage {
    agentEndpoint;
    pageSlug;
    // Cache in memory — IndexedDB is the perf bottleneck, not crypto
    cachedPrivateKey = null;
    cachedPubKeyB64 = null;
    initPromise = null;
    constructor(agentEndpoint, pageSlug) {
      this.agentEndpoint = agentEndpoint.replace(/\/$/, "");
      this.pageSlug = pageSlug;
    }
    static async init() {
      const endpoint = getMeta("clawd-agent-endpoint");
      const slug = getMeta("clawd-page-slug");
      if (!endpoint || !slug) {
        throw new Error("Missing clawd-agent-endpoint or clawd-page-slug meta tags");
      }
      const instance = new _ClawdStorage(endpoint, slug);
      await instance.ensureKeys();
      return instance;
    }
    async ensureKeys() {
      if (this.cachedPrivateKey) return;
      if (this.initPromise) return this.initPromise;
      this.initPromise = (async () => {
        const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
        this.cachedPrivateKey = privateKey;
        this.cachedPubKeyB64 = base64RawUrlEncode(publicKeyBytes);
      })();
      return this.initPromise;
    }
    async signedFetch(method, path, body) {
      await this.ensureKeys();
      const url = `${this.agentEndpoint}${path}`;
      const created = Math.floor(Date.now() / 1e3);
      const nonce = crypto.randomUUID();
      let contentDigest = "";
      if (body) {
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(body)
        );
        contentDigest = `sha-256=:${base64StdEncode(new Uint8Array(hash))}:`;
      }
      const coveredComponents = body ? '("@method" "@target-uri" "content-digest")' : '("@method" "@target-uri")';
      const sigParams = `${coveredComponents};created=${created};nonce="${nonce}";keyid="${this.cachedPubKeyB64}"`;
      const lines = [
        `"@method": ${method}`,
        `"@target-uri": ${url}`
      ];
      if (contentDigest) lines.push(`"content-digest": ${contentDigest}`);
      lines.push(`"@signature-params": ${sigParams}`);
      const signatureBase = lines.join("\n");
      const sig = await crypto.subtle.sign(
        "Ed25519",
        this.cachedPrivateKey,
        new TextEncoder().encode(signatureBase)
      );
      const sigB64 = base64StdEncode(new Uint8Array(sig));
      const headers = {
        "Content-Type": "application/json",
        "Signature-Input": `sig1=${sigParams}`,
        Signature: `sig1=:${sigB64}:`
      };
      if (contentDigest) headers["Content-Digest"] = contentDigest;
      return fetch(url, { method, headers, body });
    }
    async get(key) {
      const res = await this.signedFetch(
        "GET",
        `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return JSON.parse(data.value);
    }
    async set(key, value) {
      const body = JSON.stringify(value);
      const res = await this.signedFetch(
        "PUT",
        `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`,
        body
      );
      return res.ok;
    }
    async list(prefix = "") {
      const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
      const res = await this.signedFetch(
        "GET",
        `/api/storage/${encodeURIComponent(this.pageSlug)}${params}`
      );
      if (!res.ok) return [];
      const entries = await res.json();
      return entries.map((e) => e.key);
    }
    async delete(key) {
      const res = await this.signedFetch(
        "DELETE",
        `/api/storage/${encodeURIComponent(this.pageSlug)}/${encodeURIComponent(key)}`
      );
      return res.ok;
    }
    /** Get the public key for pairing (base64url-encoded, no padding). */
    async getPublicKey() {
      await this.ensureKeys();
      return this.cachedPubKeyB64;
    }
  };
  window.ClawdStorage = ClawdStorage;
  var endpointMeta = getMeta("clawd-agent-endpoint");
  var slugMeta = getMeta("clawd-page-slug");
  if (endpointMeta && slugMeta) {
    ClawdStorage.init().then((storage) => {
      window.clawdStorage = storage;
    }).catch((err) => {
      console.error("ClawdStorage init failed:", err);
    });
  }
})();
