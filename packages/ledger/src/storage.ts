/**
 * Append-only JSONL persistence for the reference ledger.
 *
 * Scope (v0.1 sandbox):
 *   - DID documents  → dids.jsonl       (latest per DID wins on replay)
 *   - Attestations   → attestations.jsonl (append-only)
 *
 * Out of scope (regenerated on startup):
 *   - Operator keypairs (fresh keys each boot — v0.1 sandbox caveat)
 *   - Batches (rebuilt by re-queueing replayed attestations)
 */
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function appendJsonl(path: string, obj: unknown): void {
  appendFileSync(path, JSON.stringify(obj) + "\n");
}

export function readJsonl<T = unknown>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as T);
}
