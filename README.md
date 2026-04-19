# Agent Trust Protocol (ATP)

**An open protocol for cryptographically verifiable trust between autonomous AI agents.**

Agents register decentralized identifiers, issue signed attestations about each other, and submit them to a federated ledger that provides Merkle-proven inclusion and M-of-N threshold-signed batches. Built on W3C DIDs, W3C Verifiable Credentials, and JOSE.

## Why

Trust cannot be eliminated — only displaced. Today it's placed in opaque platform operators. ATP displaces it to a transparent, multi-party ledger with cryptographic proofs that any agent can verify independently.

## Adoption paths

| Path | Integration cost | For |
|------|-----------------|-----|
| **MCP server** | 4 lines of config | Any Claude / MCP-compatible agent |
| **TypeScript SDK** | `npm install @atp/sdk` + 3 method calls | JS/TS agents |
| **Python SDK** | `pip install atp-sdk` + 3 method calls | Python agents |
| **Embed badge** | `<iframe>` | Any website hosting an agent |

## Repo layout

| Path | Purpose |
|------|---------|
| `docs/SPEC.md` | Protocol specification |
| `packages/sdk` | TypeScript SDK |
| `packages/mcp-server` | MCP server — zero-code adoption |
| `packages/ledger` | Reference ledger + M-of-N threshold signing |
| `sdks/python` | Python SDK |
| `examples/quickstart-ts` | TypeScript quickstart |
| `examples/reference-agent` | Full reference agent with public profile + embed badge |

## Run the whole protocol locally

```bash
# Terminal 1 — ledger with 5 operators, M=3 threshold
npm --workspace @atp/ledger run dev

# Terminal 2 — seed a reference agent with attestations
npm --workspace reference-agent run agent

# Terminal 3 — expose the agent's public trust profile + embed badge
npm --workspace reference-agent run serve
# → http://localhost:4546
```

## Status

**v0.1.0-draft.** Protocol is stabilizing. Breaking changes expected before v1.0.

## License

Apache 2.0 — explicit patent grant included, important for protocol infrastructure.
