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

/**
 * Get or create an Ed25519 keypair.
 * WebCrypto `extractable` flag applies to BOTH keys in the pair, so we
 * generate extractable, export the public key, then re-import the private
 * key as non-extractable.
 *
 * Uses a single readwrite transaction to check-then-create atomically,
 * preventing a TOCTOU race across browser tabs where two tabs could both
 * read "no keypair" and generate different keypairs.
 */
export async function getOrCreateKeypair(): Promise<StoredKeypair> {
  const db = await openDB();

  // Attempt atomic read inside a readwrite transaction to hold the lock
  const existing = await new Promise<StoredKeypair | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(KEY_ID);
    req.onsuccess = () => resolve(req.result as StoredKeypair | null);
    req.onerror = () => reject(req.error);
  });
  if (existing) return existing;

  // No keypair exists — generate one
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

  // Re-check and save in a single readwrite transaction (double-check pattern)
  return new Promise<StoredKeypair>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const checkReq = store.get(KEY_ID);
    checkReq.onsuccess = () => {
      if (checkReq.result) {
        // Another tab won the race — use their keypair
        resolve(checkReq.result as StoredKeypair);
        return;
      }
      // We won — store ours
      store.put({ privateKey, publicKeyBytes }, KEY_ID);
    };
    checkReq.onerror = () => reject(checkReq.error);
    tx.oncomplete = () => resolve({ privateKey, publicKeyBytes });
    tx.onerror = () => reject(tx.error);
  });
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

/**
 * Send an RFC 9421 signed HTTP request to an agent endpoint.
 * Uses the browser's Ed25519 keypair from IndexedDB.
 */
export async function signedFetch(
  method: string,
  url: string,
  body?: string
): Promise<Response> {
  const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
  const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);
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
  const sigParams = `${coveredComponents};created=${created};nonce="${nonce}";keyid="${pubKeyB64}"`;

  const lines: string[] = [
    `"@method": ${method}`,
    `"@target-uri": ${url}`,
  ];
  if (contentDigest) lines.push(`"content-digest": ${contentDigest}`);
  lines.push(`"@signature-params": ${sigParams}`);
  const signatureBase = lines.join("\n");

  const sig = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(signatureBase)
  );
  const sigB64 = base64StdEncode(new Uint8Array(sig));

  const headers: Record<string, string> = {
    "Signature-Input": `sig1=${sigParams}`,
    Signature: `sig1=:${sigB64}:`,
  };
  if (contentDigest) headers["Content-Digest"] = contentDigest;

  return fetch(url, { method, headers, body });
}
