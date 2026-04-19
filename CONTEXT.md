# ATP — Handoff Context

## Project
Agent Trust Protocol. Open protocol for cryptographically verifiable trust between AI agents.
W3C DIDs + W3C VCs + JOSE + federated Merkle-batched ledger with M-of-N threshold signing.

## Repo layout
- packages/sdk — TypeScript SDK (Ed25519, JWS, DID)
- packages/ledger — Reference ledger with 5 operators, M=3 threshold
- packages/mcp-server — MCP server exposing ATP as tools
- sdks/python — Python SDK (wire-compatible with TS)
- examples/quickstart-ts — minimal TS demo
- examples/reference-agent — full agent with public profile + embed badge

## Current blocker
`npm run build` produces no output. `packages/sdk/dist/` does not exist after `tsc` reports success.
Consumers then fail: `Cannot find module '@atp/sdk'`.

Suspected causes:
- tsconfig inheritance with NodeNext + rootDir inference
- SDK package.json may need explicit `exports` map

## What to do
1. Get the whole monorepo building cleanly
2. Run end-to-end: ledger (terminal 1) → reference-agent agent (terminal 2) → reference-agent serve
3. Verify http://localhost:4546 renders the trust profile
4. Verify http://localhost:4546/badge renders the embed badge
5. Fix anything that's broken along the way

## Style
Direct, quantified, substantive. Skip hedging.
