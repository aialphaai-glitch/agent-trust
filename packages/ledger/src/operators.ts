/**
 * Ledger operators — each runs a node that independently signs batch headers.
 * A batch is committed when M-of-N operator signatures are collected.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface Operator {
  id: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface PublicOperator {
  id: string;
  publicKey: string; // hex
}

export async function generateOperator(id: string): Promise<Operator> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { id, publicKey, privateKey };
}

export function toPublic(op: Operator): PublicOperator {
  return { id: op.id, publicKey: Buffer.from(op.publicKey).toString("hex") };
}
