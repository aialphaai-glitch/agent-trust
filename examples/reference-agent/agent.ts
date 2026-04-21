/**
 * Seed script — populates the ledger with a set of reference agents.
 *
 * Creates:
 *   - 4 working agents with distinct capabilities and histories
 *   - 2 reviewer agents that issue independent attestations
 *   - A variety of task completions, behavior observations, and capability assertions
 *
 * Designed to demonstrate the full span of signals ATP captures:
 *   - "longevity" (registeredAt, backdated for some agents)
 *   - "attestation volume" (a newer agent with fewer attestations scores lower)
 *   - "issuer diversity" (independent reviewers matter more than self-reports)
 *   - "capability assertions" (separate from task completions)
 *
 * Idempotency: this script is meant to run once on a fresh ledger. Running it
 * against an already-seeded ledger will duplicate attestations.
 */
import { TrustClient } from "@atp/sdk";

const client = new TrustClient({ endpoint: "http://localhost:4545", ledger: "sandbox" });

const log = (msg: string) => console.log(`  ${msg}`);

function backdate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

console.log("⬡  ATP reference seed — populating ledger...\n");

// ─── Reviewers ──────────────────────────────────────────────────────────────

const reviewerAlpha = await client.register({ name: "reviewer-alpha" });
await client.publishIdentity(reviewerAlpha, {
  capabilities: ["peer-review"],
  registeredAt: backdate(180),
});
log(`reviewer → ${reviewerAlpha.name} (${reviewerAlpha.did.slice(0, 32)}…)`);

const reviewerBeta = await client.register({ name: "reviewer-beta" });
await client.publishIdentity(reviewerBeta, {
  capabilities: ["peer-review"],
  registeredAt: backdate(120),
});
log(`reviewer → ${reviewerBeta.name} (${reviewerBeta.did.slice(0, 32)}…)`);

console.log();

// ─── Agent 1 — atlas-research (established, research capability) ─────────────

const atlas = await client.register({ name: "atlas-research" });
await client.publishIdentity(atlas, {
  capabilities: ["structured-research", "market-analysis"],
  registeredAt: backdate(90),
});
log(`agent 1 → atlas-research — established, research`);

for (const t of [
  { task: "market-analysis-q1-2026", outcome: "success", accuracy: 0.94 },
  { task: "competitor-research-acme", outcome: "success", accuracy: 0.88 },
  { task: "summary-forrester-report-ai", outcome: "success", accuracy: 0.96 },
]) {
  await client.submit(await client.attest({
    subject: atlas.did,
    claim: { type: "task_completion", value: t, context: "self-reported" },
    issuer: atlas,
  }));
}

for (const t of [
  { task: "market-analysis-q1-2026", observed_quality: "high", independent_verification: true },
  { task: "competitor-research-acme", observed_quality: "high", independent_verification: true },
]) {
  await client.submit(await client.attest({
    subject: atlas.did,
    claim: { type: "behavior_observation", value: t, context: "peer-reviewed" },
    issuer: reviewerAlpha,
  }));
}

await client.submit(await client.attest({
  subject: atlas.did,
  claim: {
    type: "capability_assertion",
    value: { capability: "structured-research", skill_level: "senior" },
  },
  issuer: reviewerBeta,
}));

log(`  ✓ 3 self-attestations, 2 peer reviews, 1 capability assertion`);

// ─── Agent 2 — argus-code-review (code review capability) ────────────────────

const argus = await client.register({ name: "argus-code-review" });
await client.publishIdentity(argus, {
  capabilities: ["code-review", "static-analysis"],
  registeredAt: backdate(60),
});
log(`agent 2 → argus-code-review — mid-history, code review`);

for (const t of [
  { task: "review-pr-auth-service-1247", outcome: "success", issues_found: 3 },
  { task: "review-pr-billing-migration-89", outcome: "success", issues_found: 7 },
  { task: "review-pr-frontend-refactor-204", outcome: "success", issues_found: 2 },
]) {
  await client.submit(await client.attest({
    subject: argus.did,
    claim: { type: "task_completion", value: t, context: "self-reported" },
    issuer: argus,
  }));
}

for (const t of [
  { task: "review-pr-auth-service-1247", observed_quality: "high", independent_verification: true },
  { task: "review-pr-billing-migration-89", observed_quality: "exceptional", independent_verification: true, notes: "caught critical race condition" },
]) {
  await client.submit(await client.attest({
    subject: argus.did,
    claim: { type: "behavior_observation", value: t, context: "peer-reviewed" },
    issuer: reviewerAlpha,
  }));
}

await client.submit(await client.attest({
  subject: argus.did,
  claim: {
    type: "capability_assertion",
    value: { capability: "code-review", skill_level: "senior", languages: ["typescript", "rust", "python"] },
  },
  issuer: reviewerBeta,
}));

log(`  ✓ 3 self-attestations, 2 peer reviews, 1 capability assertion`);

// ─── Agent 3 — sage-support (customer support with varied quality) ───────────

const sage = await client.register({ name: "sage-support" });
await client.publishIdentity(sage, {
  capabilities: ["customer-support", "tier-1-triage"],
  registeredAt: backdate(45),
});
log(`agent 3 → sage-support — mid-history, support (varied quality)`);

for (const t of [
  { task: "ticket-support-00412", outcome: "success", resolution_time_min: 4 },
  { task: "ticket-support-00418", outcome: "success", resolution_time_min: 12 },
  { task: "ticket-support-00425", outcome: "escalated", resolution_time_min: 28 },
  { task: "ticket-support-00430", outcome: "success", resolution_time_min: 6 },
]) {
  await client.submit(await client.attest({
    subject: sage.did,
    claim: { type: "task_completion", value: t, context: "self-reported" },
    issuer: sage,
  }));
}

// Mixed-quality peer reviews — realistic, not all glowing
for (const t of [
  { task: "ticket-support-00412", observed_quality: "high" },
  { task: "ticket-support-00418", observed_quality: "medium", notes: "correct but verbose" },
  { task: "ticket-support-00425", observed_quality: "low", notes: "failed to escalate sooner" },
]) {
  await client.submit(await client.attest({
    subject: sage.did,
    claim: { type: "behavior_observation", value: t, context: "peer-reviewed" },
    issuer: reviewerAlpha,
  }));
}

log(`  ✓ 4 self-attestations, 3 peer reviews (mixed quality) — shows the score working honestly`);

// ─── Agent 4 — quill-extract (new agent, low history) ────────────────────────

const quill = await client.register({ name: "quill-extract" });
await client.publishIdentity(quill, {
  capabilities: ["document-extraction", "pdf-parsing"],
  registeredAt: backdate(5),
});
log(`agent 4 → quill-extract — NEW (5 days), demonstrates longevity signal`);

for (const t of [
  { task: "extract-invoice-data-batch-01", outcome: "success", fields_extracted: 42 },
  { task: "extract-contract-clauses-beta", outcome: "success", fields_extracted: 18 },
]) {
  await client.submit(await client.attest({
    subject: quill.did,
    claim: { type: "task_completion", value: t, context: "self-reported" },
    issuer: quill,
  }));
}

log(`  ✓ 2 self-attestations, 0 peer reviews — newcomer, low score by design`);

console.log();
console.log(`  Registered 6 DIDs (4 working agents + 2 reviewers)`);
console.log(`  Run 'npm run serve' on the reference-agent workspace to expose the site.`);
