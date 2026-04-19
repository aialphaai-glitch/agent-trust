/**
 * ATP Quickstart — end-to-end in under 30 lines.
 * Run: npm run quickstart (from repo root, after `npm install` and starting the ledger)
 */
import { TrustClient } from "@atp/sdk";

const client = new TrustClient({ endpoint: "http://localhost:4545", ledger: "sandbox" });

// 1. Two agents register on the network
const alice = await client.register({ name: "alice" });
const bob = await client.register({ name: "bob" });
console.log("Alice:", alice.did);
console.log("Bob:  ", bob.did);

// 2. Alice attests that Bob completed a task
const attestation = await client.attest({
  subject: bob.did,
  claim: { type: "task_completion", value: { task: "pr-review-1234", outcome: "success" } },
  issuer: alice,
});

// 3. Submit to the ledger
const submitted = await client.submit(attestation);
console.log("Submitted, hash:", submitted.hash);

// 4. Anyone can query Bob's attestations
const reputation = await client.query({ subject: bob.did });
console.log(`Bob has ${reputation.attestations.length} attestation(s), score: ${reputation.score}`);
