/**
 * WebCrypto X25519 keypair management (legacy SDK).
 *
 * Note: The SDK is no longer used by shell.html (which handles E2E directly),
 * but kept for backwards compatibility with iframed pages that import it.
 */

const DB_NAME = "clawd-keys";
const STORE_NAME = "keypair";
const KEY_ID = "default";

interface StoredKeypair {
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
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result as StoredKeypair);
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
 * Get or create a keypair. Returns a stored keypair from IndexedDB if available.
 * Note: This is kept for SDK interface compatibility. New code should use X25519 directly.
 */
export async function getOrCreateKeypair(): Promise<StoredKeypair> {
  const cached = await loadFromIndexedDB();
  if (cached) return cached;

  // Generate X25519 keypair (extractable to export public key)
  const temp = await crypto.subtle.generateKey("X25519", true, [
    "deriveBits",
  ]) as CryptoKeyPair;

  // Export public key as raw bytes (32 bytes)
  const pubRaw = await crypto.subtle.exportKey("raw", temp.publicKey);
  const publicKeyBytes = new Uint8Array(pubRaw);

  // Re-import private key as NON-extractable
  const privPkcs8 = await crypto.subtle.exportKey("pkcs8", temp.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privPkcs8,
    "X25519",
    false, // non-extractable
    ["deriveBits"]
  );

  // Zero out exported private key material (best effort)
  new Uint8Array(privPkcs8).fill(0);

  // Store in IndexedDB (CryptoKey is structured-cloneable)
  await saveToIndexedDB(privateKey, publicKeyBytes);
  return { privateKey, publicKeyBytes };
}

/** Base64url-encode without padding (RFC 4648 §5). */
export function base64RawUrlEncode(bytes: Uint8Array): string {
  const binStr = String.fromCharCode(...bytes);
  return btoa(binStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Standard base64 encode (with padding). */
export function base64StdEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
