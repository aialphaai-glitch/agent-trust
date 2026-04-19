/**
 * M-of-N threshold signing over batch headers.
 *
 * Uses independent Ed25519 signatures aggregated into a batch. A verifier
 * accepts the batch if at least M distinct operators have produced valid
 * signatures over the canonical header.
 *
 * This is the same approach as Certificate Transparency and Sigstore's
 * Rekor — simple, auditable, upgradable to BLS / FROST later without
 * breaking the wire format (only the verification rule changes).
 */
import * as ed from "@noble/ed25519";
import type { Operator } from "./operators.js";

export interface BatchHeader {
  sequence: number;
  root: string;              // Merkle root of batch contents, hex
  timestamp: string;         // ISO 8601
  prev_root: string | null;  // chains batches together
}

export interface OperatorSignature {
  operator_id: string;
  signature: string;         // hex
}

export interface SignedBatch {
  header: BatchHeader;
  signatures: OperatorSignature[];
  threshold: { m: number; n: number };
}

function canonicalize(header: BatchHeader): Uint8Array {
  // Sorted keys, no whitespace — must match on all operators & verifiers
  const ordered = {
    prev_root: header.prev_root,
    root: header.root,
    sequence: header.sequence,
    timestamp: header.timestamp,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export async function signHeader(header: BatchHeader, op: Operator): Promise<OperatorSignature> {
  const sig = await ed.signAsync(canonicalize(header), op.privateKey);
  return { operator_id: op.id, signature: Buffer.from(sig).toString("hex") };
}

export async function verifyBatch(
  batch: SignedBatch,
  operatorKeys: Map<string, Uint8Array>,
): Promise<{ valid: boolean; validCount: number; reason?: string }> {
  const msg = canonicalize(batch.header);
  const seen = new Set<string>();
  let validCount = 0;

  for (const s of batch.signatures) {
    if (seen.has(s.operator_id)) continue;
    const pubkey = operatorKeys.get(s.operator_id);
    if (!pubkey) continue;
    try {
      const ok = await ed.verifyAsync(
        Uint8Array.from(Buffer.from(s.signature, "hex")),
        msg,
        pubkey,
      );
      if (ok) { validCount++; seen.add(s.operator_id); }
    } catch { /* invalid signature, skip */ }
  }

  if (validCount < batch.threshold.m) {
    return {
      valid: false,
      validCount,
      reason: `only ${validCount}/${batch.threshold.m} required signatures valid`,
    };
  }
  return { valid: true, validCount };
}
