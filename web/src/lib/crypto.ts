/**
 * X25519 keypair management for E2E encryption.
 * Keys are stored in IndexedDB and never leave the browser.
 */

const DB_NAME = "clawd-keys";
const X25519_STORE = "x25519";
const AGENT_KEYS_STORE = "agent-keys";
const KEY_ID = "default";

export interface StoredX25519Keypair {
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Legacy store — keep for schema version compatibility but no longer used
      if (!db.objectStoreNames.contains("keypair")) {
        db.createObjectStore("keypair");
      }
      if (!db.objectStoreNames.contains(X25519_STORE)) {
        db.createObjectStore(X25519_STORE);
      }
      if (!db.objectStoreNames.contains(AGENT_KEYS_STORE)) {
        db.createObjectStore(AGENT_KEYS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get or create an X25519 keypair for E2E encryption.
 *
 * Uses a single readwrite transaction to check-then-create atomically,
 * preventing a TOCTOU race across browser tabs.
 */
export async function getOrCreateX25519Keypair(): Promise<StoredX25519Keypair> {
  const db = await openDB();

  const existing = await new Promise<StoredX25519Keypair | null>((resolve, reject) => {
    const tx = db.transaction(X25519_STORE, "readwrite");
    const store = tx.objectStore(X25519_STORE);
    const req = store.get(KEY_ID);
    req.onsuccess = () => resolve(req.result as StoredX25519Keypair | null);
    req.onerror = () => reject(req.error);
  });
  if (existing) return existing;

  // Generate X25519 keypair — extractable so we can export the public key
  const kp = (await crypto.subtle.generateKey(
    "X25519", true, ["deriveBits"]
  )) as CryptoKeyPair;

  const pubRaw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const publicKeyBytes = new Uint8Array(pubRaw);

  // Re-import private key as non-extractable
  const privPkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", privPkcs8, "X25519", false, ["deriveBits"]
  );
  new Uint8Array(privPkcs8).fill(0);

  return new Promise<StoredX25519Keypair>((resolve, reject) => {
    const tx = db.transaction(X25519_STORE, "readwrite");
    const store = tx.objectStore(X25519_STORE);
    const checkReq = store.get(KEY_ID);
    checkReq.onsuccess = () => {
      if (checkReq.result) {
        resolve(checkReq.result as StoredX25519Keypair);
        return;
      }
      store.put({ privateKey, publicKeyBytes }, KEY_ID);
    };
    checkReq.onerror = () => reject(checkReq.error);
    tx.oncomplete = () => resolve({ privateKey, publicKeyBytes });
    tx.onerror = () => reject(tx.error);
  });
}

/** Store an agent's X25519 public key (received during pairing). */
export async function storeAgentX25519Key(agentId: string, pubKeyBytes: Uint8Array): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AGENT_KEYS_STORE, "readwrite");
    tx.objectStore(AGENT_KEYS_STORE).put(pubKeyBytes, `x25519-${agentId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load an agent's X25519 public key from IndexedDB. */
export async function loadAgentX25519Key(agentId: string): Promise<Uint8Array | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AGENT_KEYS_STORE, "readonly");
    const req = tx.objectStore(AGENT_KEYS_STORE).get(`x25519-${agentId}`);
    req.onsuccess = () => resolve(req.result as Uint8Array | null);
    req.onerror = () => reject(req.error);
  });
}

/** Base64url-decode without padding. */
export function base64RawUrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

/** Base64url-encode without padding (RFC 4648 §5). */
export function base64RawUrlEncode(bytes: Uint8Array): string {
  const binStr = String.fromCharCode(...bytes);
  return btoa(binStr)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Standard base64 encode (with padding). */
export function base64StdEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
