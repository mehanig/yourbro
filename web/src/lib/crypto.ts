/**
 * Ed25519 keypair management for the main (parent) origin.
 * Mirrors sdk/src/crypto.ts but lives in the web app so the dashboard
 * can generate/load keys and the page host template can relay them to
 * sandboxed iframes via postMessage.
 */

const DB_NAME = "clawd-keys";
const STORE_NAME = "keypair";
const KEY_ID = "default";

export interface StoredKeypair {
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIndexedDB(): Promise<StoredKeypair | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_ID);
      req.onsuccess = () => resolve(req.result as StoredKeypair | null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveToIndexedDB(
  privateKey: CryptoKey,
  publicKeyBytes: Uint8Array
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ privateKey, publicKeyBytes }, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get or create an Ed25519 keypair.
 * WebCrypto `extractable` flag applies to BOTH keys in the pair, so we
 * generate extractable, export the public key, then re-import the private
 * key as non-extractable.
 */
export async function getOrCreateKeypair(): Promise<StoredKeypair> {
  const cached = await loadFromIndexedDB();
  if (cached) return cached;

  const temp = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const pubRaw = await crypto.subtle.exportKey("raw", temp.publicKey);
  const publicKeyBytes = new Uint8Array(pubRaw);

  const privPkcs8 = await crypto.subtle.exportKey("pkcs8", temp.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privPkcs8,
    "Ed25519",
    false,
    ["sign"]
  );

  new Uint8Array(privPkcs8).fill(0);

  await saveToIndexedDB(privateKey, publicKeyBytes);
  return { privateKey, publicKeyBytes };
}

/** Base64url-encode without padding (RFC 4648 §5). */
export function base64RawUrlEncode(bytes: Uint8Array): string {
  const binStr = String.fromCharCode(...bytes);
  return btoa(binStr)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
