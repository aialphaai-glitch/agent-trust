/**
 * Reference ledger with M-of-N threshold signing.
 *
 * At startup, bootstraps N=5 operators (M=3 threshold). Each batch header
 * is independently signed by every operator; batches commit once the
 * threshold is met. In production these operators would run in separate
 * processes, under independent operational control — here they're colocated
 * for clarity of the reference implementation.
 */
import { createServer } from "node:http";
import { join } from "node:path";
import { hashAttestation } from "@atp/sdk";
import { buildMerkleTree } from "./merkle.js";
import { generateOperator, toPublic, type Operator } from "./operators.js";
import { signHeader, type BatchHeader, type SignedBatch } from "./threshold.js";
import { ensureDir, appendJsonl, readJsonl } from "./storage.js";

const N = 5;
const M = 3;

const DATA_DIR = process.env.LEDGER_DATA_DIR ?? "./data";
const DIDS_PATH = join(DATA_DIR, "dids.jsonl");
const ATTS_PATH = join(DATA_DIR, "attestations.jsonl");
ensureDir(DATA_DIR);

const operators: Operator[] = [];
const attestations: any[] = [];
const didDocs: Map<string, any> = new Map();
const batches: SignedBatch[] = [];
// attestation hash -> { batch_sequence, index_in_batch }
const attestationIndex: Map<string, { batch_sequence: number; index_in_batch: number }> = new Map();
let pendingBatch: any[] = [];

// ─── Bootstrap operators ────────────────────────────────────────────────────
for (let i = 1; i <= N; i++) {
  operators.push(await generateOperator(`op-${i}`));
}
console.log(`[ledger] bootstrapped ${N} operators, threshold M=${M}`);

// ─── Replay persisted state ─────────────────────────────────────────────────
for (const doc of readJsonl<any>(DIDS_PATH)) {
  if (doc?.id) didDocs.set(doc.id, doc);
}
const replayedAtts = readJsonl<any>(ATTS_PATH);
for (const a of replayedAtts) {
  attestations.push(a);
  pendingBatch.push(a); // will be re-batched under fresh operator keys
}
if (didDocs.size || attestations.length) {
  console.log(`[ledger] replayed ${didDocs.size} DID doc(s), ${attestations.length} attestation(s) from ${DATA_DIR}`);
}

// ─── Batch commit loop ──────────────────────────────────────────────────────
async function commitBatch() {
  if (pendingBatch.length === 0) return;
  const items = pendingBatch;
  pendingBatch = [];

  const hashes = items.map(a => {
    const { proof, ...unsigned } = a;
    return Buffer.from(hashAttestation(unsigned), "hex");
  });
  const tree = buildMerkleTree(hashes);
  const root = Buffer.from(tree.root).toString("hex");
  const prev = batches.length > 0 ? batches[batches.length - 1].header.root : null;

  const header: BatchHeader = {
    sequence: batches.length,
    root,
    timestamp: new Date().toISOString(),
    prev_root: prev,
  };

  // Every operator signs independently.
  const signatures = await Promise.all(operators.map(op => signHeader(header, op)));

  // In production this is where you'd wait for >= M to arrive asynchronously.
  // Here we produce all N and note the threshold.
  const batch: SignedBatch = {
    header,
    signatures: signatures.slice(0, M + 1), // produce M+1 to demonstrate over-threshold
    threshold: { m: M, n: N },
  };

  batches.push(batch);
  items.forEach((a, i) => {
    const { proof, ...u } = a;
    attestationIndex.set(hashAttestation(u), { batch_sequence: header.sequence, index_in_batch: i });
  });

  console.log(`[ledger] batch #${header.sequence} committed — ${items.length} attestations, ${batch.signatures.length}/${N} sigs`);
}

setInterval(commitBatch, 5000);

// ─── HTTP API ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

  // POST /v1/attestations
  if (req.method === "POST" && req.url === "/v1/attestations") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      try {
        const att = JSON.parse(body);
        appendJsonl(ATTS_PATH, att);
        attestations.push(att);
        pendingBatch.push(att);
        res.writeHead(202).end(JSON.stringify({ accepted: true, pending_batch_sequence: batches.length }));
      } catch (e: any) {
        res.writeHead(400).end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /v1/dids
  if (req.method === "POST" && req.url === "/v1/dids") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      try {
        const doc = JSON.parse(body);
        if (!doc?.id) { res.writeHead(400).end(JSON.stringify({ error: "missing id" })); return; }
        appendJsonl(DIDS_PATH, doc);
        didDocs.set(doc.id, doc);
        res.writeHead(201).end(JSON.stringify({ registered: doc.id }));
      } catch (e: any) {
        res.writeHead(400).end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /v1/dids/:did
  if (req.method === "GET" && req.url?.startsWith("/v1/dids/")) {
    const did = decodeURIComponent(req.url.split("/v1/dids/")[1]);
    const doc = didDocs.get(did);
    if (!doc) { res.writeHead(404).end(JSON.stringify({ error: "not found" })); return; }
    res.writeHead(200).end(JSON.stringify(doc));
    return;
  }

  // GET /v1/subjects/:did
  if (req.method === "GET" && req.url?.startsWith("/v1/subjects/")) {
    const subject = decodeURIComponent(req.url.split("/v1/subjects/")[1]);
    const forSubject = attestations.filter(a => a.credentialSubject?.id === subject);
    const score = forSubject.length; // naive reference; replace with weighted scoring
    res.writeHead(200).end(JSON.stringify({ subject, attestations: forSubject, score }));
    return;
  }

  // GET /v1/batches/:seq
  if (req.method === "GET" && req.url?.match(/^\/v1\/batches\/\d+$/)) {
    const seq = Number(req.url.split("/").pop());
    const batch = batches[seq];
    if (!batch) { res.writeHead(404).end(JSON.stringify({ error: "not found" })); return; }
    res.writeHead(200).end(JSON.stringify(batch));
    return;
  }

  // GET /v1/operators  — public keys so anyone can verify batches independently
  if (req.method === "GET" && req.url === "/v1/operators") {
    res.writeHead(200).end(JSON.stringify({
      threshold: { m: M, n: N },
      operators: operators.map(toPublic),
    }));
    return;
  }

  // GET /v1/status
  if (req.method === "GET" && req.url === "/v1/status") {
    res.writeHead(200).end(JSON.stringify({
      status: "ok",
      attestations: attestations.length,
      batches: batches.length,
      pending: pendingBatch.length,
      threshold: { m: M, n: N },
    }));
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: "not found", url: req.url }));
});

const PORT = Number(process.env.PORT ?? 4545);
server.listen(PORT, () => {
  console.log(`[ledger] http://localhost:${PORT}`);
  console.log(`[ledger] GET /v1/operators  → public keys for independent verification`);
});
