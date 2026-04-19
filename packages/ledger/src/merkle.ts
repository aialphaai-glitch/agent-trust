import { sha256 } from "@noble/hashes/sha256";

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  return sha256(new Uint8Array([...a, ...b]));
}

export function buildMerkleTree(leafHashes: Uint8Array[]): {
  root: Uint8Array;
  proofFor: (index: number) => Array<{ hash: string; position: "left" | "right" }>;
} {
  if (leafHashes.length === 0) throw new Error("Empty tree");

  // Build levels bottom-up
  const levels: Uint8Array[][] = [leafHashes];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i]; // duplicate last if odd
      next.push(hashPair(left, right));
    }
    levels.push(next);
  }

  const root = levels[levels.length - 1][0];

  function proofFor(index: number) {
    const path: Array<{ hash: string; position: "left" | "right" }> = [];
    let idx = index;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const level = levels[lvl];
      const isRightNode = idx % 2 === 1;
      const siblingIdx = isRightNode ? idx - 1 : idx + 1;
      const sibling = siblingIdx < level.length ? level[siblingIdx] : level[idx];
      path.push({
        hash: Buffer.from(sibling).toString("hex"),
        position: isRightNode ? "left" : "right",
      });
      idx = Math.floor(idx / 2);
    }
    return path;
  }

  return { root, proofFor };
}
