import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import type { KeyPair } from "./types.js";

// Required for @noble/ed25519 in Node/browser
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const b64u = {
  encode: (bytes: Uint8Array): string =>
    Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string): Uint8Array => {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"));
  },
};

export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

export function didFromPublicKey(publicKey: Uint8Array, ledger = "main"): string {
  // Multibase z prefix for base58btc would be ideal; using base64url for simplicity here
  return `did:atp:${ledger}:${b64u.encode(publicKey).slice(0, 32)}`;
}

/**
 * Create a compact JWS over the given payload using Ed25519.
 * Header: { alg: "EdDSA", typ: "JWT" }
 */
export async function signJWS(payload: object, privateKey: Uint8Array): Promise<string> {
  const header = { alg: "EdDSA", typ: "JWT" };
  const headerB64 = b64u.encode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64u.encode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await ed.signAsync(new TextEncoder().encode(signingInput), privateKey);
  return `${signingInput}.${b64u.encode(sig)}`;
}

export async function verifyJWS(jws: string, publicKey: Uint8Array): Promise<boolean> {
  const [h, p, s] = jws.split(".");
  if (!h || !p || !s) return false;
  const signingInput = `${h}.${p}`;
  try {
    return await ed.verifyAsync(b64u.decode(s), new TextEncoder().encode(signingInput), publicKey);
  } catch {
    return false;
  }
}

export function hashAttestation(obj: object): string {
  // Canonical JSON (sorted keys) hashed with SHA-256
  const canonical = JSON.stringify(obj, Object.keys(obj).sort());
  return Buffer.from(sha256(new TextEncoder().encode(canonical))).toString("hex");
}

export { b64u };
