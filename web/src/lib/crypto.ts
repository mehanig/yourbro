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
    // Version 3: fresh schema — stores raw bytes instead of CryptoKey (Safari compat)
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Delete old stores and recreate fresh
      for (const name of Array.from(db.objectStoreNames)) {
        db.deleteObjectStore(name);
      }
      db.createObjectStore(X25519_STORE);
      db.createObjectStore(AGENT_KEYS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get or create an X25519 keypair for E2E encryption.
 *
 * Stores raw key bytes in IndexedDB (not CryptoKey objects) for Safari
 * compatibility. Re-imports the private key on each read.
 */
export async function getOrCreateX25519Keypair(): Promise<StoredX25519Keypair> {
  const db = await openDB();

  const stored = await new Promise<{ pk: Uint8Array; pub: Uint8Array } | null>((resolve, reject) => {
    const tx = db.transaction(X25519_STORE, "readonly");
    const req = tx.objectStore(X25519_STORE).get(KEY_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  if (stored) {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8", stored.pk, "X25519", false, ["deriveBits"]
    );
    return { privateKey, publicKeyBytes: stored.pub };
  }

  // Generate new X25519 keypair
  const kp = (await crypto.subtle.generateKey(
    "X25519", true, ["deriveBits"]
  )) as CryptoKeyPair;

  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const pk = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(X25519_STORE, "readwrite");
    tx.objectStore(X25519_STORE).put({ pk, pub }, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const privateKey = await crypto.subtle.importKey(
    "pkcs8", pk, "X25519", false, ["deriveBits"]
  );
  return { privateKey, publicKeyBytes: pub };
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
