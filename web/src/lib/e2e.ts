/**
 * Shared E2E encryption helpers for dashboard and other pages.
 * Mirrors the pattern from shell.html — X25519 ECDH + HKDF-SHA256 + AES-256-GCM.
 */

import { API_BASE } from "./api";
import { base64RawUrlEncode } from "./crypto";

/** Derive AES-256-GCM key from user's X25519 private key + agent's X25519 public key. */
export async function deriveE2EKey(
  privateKey: CryptoKey,
  agentPubKeyBytes: Uint8Array
): Promise<CryptoKey> {
  const agentPub = await crypto.subtle.importKey(
    "raw", agentPubKeyBytes.buffer as ArrayBuffer, "X25519", true, []
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: agentPub }, privateKey, 256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new ArrayBuffer(0),
      info: new TextEncoder().encode("yourbro-e2e-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt plaintext with AES-256-GCM. Returns IV(12) + ciphertext. */
export async function e2eEncrypt(aesKey: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext.buffer as ArrayBuffer);
  const result = new Uint8Array(12 + ct.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ct), 12);
  return result;
}

/** Decrypt AES-256-GCM data (IV(12) + ciphertext). */
export async function e2eDecrypt(aesKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  return new Uint8Array(pt);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/** Send an E2E encrypted relay request and return the decrypted inner response. */
export async function encryptedRelay(
  agentId: number | string,
  aesKey: CryptoKey,
  userKeyId: string,
  innerReq: { method: string; path: string; headers?: Record<string, string>; body?: string | null }
): Promise<{ status: number; body?: string; headers?: Record<string, string> } | null> {
  const inner = JSON.stringify({
    id: crypto.randomUUID(),
    ...innerReq,
  });
  const encrypted = await e2eEncrypt(aesKey, new TextEncoder().encode(inner));

  const res = await fetch(`${API_BASE}/api/relay/${agentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      id: crypto.randomUUID(),
      encrypted: true,
      key_id: userKeyId,
      payload: toBase64(encrypted),
    }),
  });

  if (!res.ok) return null;

  const envelope = await res.json();
  if (envelope.encrypted && envelope.payload) {
    const decrypted = await e2eDecrypt(aesKey, fromBase64(envelope.payload));
    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  // Non-encrypted response (shouldn't happen, but handle gracefully)
  return { status: envelope.status, body: envelope.body, headers: envelope.headers };
}

/** Build the user's X25519 key_id (base64url of public key bytes). */
export function x25519KeyId(publicKeyBytes: Uint8Array): string {
  return base64RawUrlEncode(publicKeyBytes);
}
