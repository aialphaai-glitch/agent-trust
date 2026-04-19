/**
 * Reference Agent
 *
 * A demonstration agent that:
 *   1. Registers an identity on the ledger
 *   2. Performs mock "work" (task completions)
 *   3. Self-attests to that work
 *   4. Receives attestations from a simulated reviewer
 *   5. Writes its state to state.json for the profile server to render
 *
 * Run this first, then run `npm run serve` to expose the public profile.
 */
import { TrustClient } from "@atp/sdk";
import { writeFileSync } from "node:fs";

const client = new TrustClient({ endpoint: "http://localhost:4545", ledger: "sandbox" });

console.log("⬡  Reference Agent bootstrapping...\n");

// 1. The agent registers itself and publishes its DID document
const agent = await client.register({ name: "atlas-research-agent" });
await client.publishIdentity(agent);
console.log(`  identity → ${agent.did}`);

// 2. A reviewer agent also registers (they'll attest about us) and publishes
const reviewer = await client.register({ name: "atlas-reviewer-001" });
await client.publishIdentity(reviewer);
console.log(`  reviewer → ${reviewer.did}\n`);

// 3. Mock tasks the agent "completed"
const tasks = [
  { task: "market-analysis-q1-2026", outcome: "success", accuracy: 0.94 },
  { task: "competitor-research-acme", outcome: "success", accuracy: 0.88 },
  { task: "summary-forrester-report-ai", outcome: "success", accuracy: 0.96 },
];

// 4. Self-attestations (agent claiming its own work)
const selfAttestations = [];
for (const t of tasks) {
  const att = await client.attest({
    subject: agent.did,
    claim: { type: "task_completion", value: t, context: "self-reported" },
    issuer: agent,
  });
  await client.submit(att);
  selfAttestations.push(att);
  console.log(`  ✓ self-attested: ${t.task}`);
}

// 5. Reviewer attestations (independent party confirming the work)
const reviewAttestations = [];
for (const t of tasks.slice(0, 2)) {
  const att = await client.attest({
    subject: agent.did,
    claim: {
      type: "behavior_observation",
      value: { task: t.task, observed_quality: "high", independent_verification: true },
      context: "peer-reviewed",
    },
    issuer: reviewer,
  });
  await client.submit(att);
  reviewAttestations.push(att);
  console.log(`  ✓ reviewer attested: ${t.task}`);
}

// 6. Capability assertion — a trusted upstream vouches for capabilities
const capAtt = await client.attest({
  subject: agent.did,
  claim: {
    type: "capability_assertion",
    value: { capability: "structured-research", skill_level: "senior" },
  },
  issuer: reviewer,
});
await client.submit(capAtt);
console.log(`  ✓ capability asserted: structured-research\n`);

// Persist state for the profile server
const state = {
  agent: { did: agent.did, name: agent.name },
  reviewer: { did: reviewer.did, name: reviewer.name },
  generated_at: new Date().toISOString(),
};
writeFileSync("./state.json", JSON.stringify(state, null, 2));
console.log("  state.json written → run `npm run serve` to expose the profile");
