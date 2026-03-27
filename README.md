# Agent Trust Platform

A cross-platform, third-party cryptographic verification system for AI agents.
**Zero human involvement. Zero external dependencies. Pure Node.js built-ins.**

---

## What it does

When two AI agents from different platforms (Anthropic, OpenAI, etc.) want to communicate,
neither can trust the other's self-declaration. This platform provides a neutral
**Trust Registry** that agents use to verify each other's identity cryptographically —
before sharing any capabilities, data, or delegating work.

---

## Architecture

```
Agent Alpha (port 3001)          Trust Registry (port 3000)          Agent Beta (port 3002)
        │                                  │                                  │
        │── POST /register ───────────────>│                                  │
        │                                  │<─── POST /register ──────────────│
        │                                  │                                  │
        │── POST /nonce ──────────────────>│  (Alpha wants to verify Beta)    │
        │<── { nonce } ───────────────────│                                  │
        │                                  │                                  │
        │── POST /challenge ──────────────────────────────────────────────────>│
        │<── { signature } ──────────────────────────────────────────────────-│
        │  (Beta signs nonce with its private key)                            │
        │                                  │                                  │
        │── POST /verify ─────────────────>│                                  │
        │   { nonce, agentId, signature }  │  (Registry checks Ed25519 sig)   │
        │<── { verified, manifest } ───────│                                  │
```

### Why only the signature is truly verifiable

| Attribute | Verifiable? | Reason |
|---|---|---|
| Cryptographic signature | ✓ YES | Cannot be forged without the private key |
| Platform / model name | ✗ Self-reported | Agent claims it; registry trusts after sig |
| Capabilities | ✗ Self-reported | Released only after signature passes |
| System prompt hash | ✗ Self-reported | Agent hashes its own prompt |
| Behavioral reputation | ✓ Partial | Based on past verified interactions |

**The signature is the root of trust. Everything else is metadata released after proof.**

---

## Components

```
agent-trust/
├── shared/
│   ├── crypto.js       # Ed25519 keypair, sign, verify, SHA-256, nonce generation
│   └── ledger.js       # Append-only hash-chained cryptographic ledger
├── registry/
│   └── server.js       # Trust Registry HTTP API
├── agents/
│   ├── agent.js        # Agent base class (registration + handshake protocol)
│   ├── agent-alpha.js  # Agent Alpha (anthropic/claude-sonnet) + challenge server
│   └── agent-beta.js   # Agent Beta (openai/gpt-4o) + challenge server
└── demo.js             # Full autonomous demo — runs all phases
```

---

## Running

```bash
node demo.js
```

This runs all 5 phases automatically:
1. Trust Registry starts
2. Both agents start their challenge servers
3. Both agents register (public key + manifest stored in ledger)
4. Alpha verifies Beta — full Ed25519 handshake
5. Beta verifies Alpha — full Ed25519 handshake
6. Impostor attack — forged signature correctly rejected
7. Cryptographic ledger audited — all 8 entries, chain intact

---

## Registry API

| Method | Path | Description |
|---|---|---|
| POST | `/register` | Register agent (agentId, publicKey, manifest) |
| POST | `/nonce` | Issue a one-time challenge nonce (30s TTL) |
| POST | `/verify` | Submit signed nonce for verification |
| GET | `/agents` | List all registered agents |
| GET | `/agent/:id` | Get public profile of one agent |
| GET | `/ledger` | Full ledger dump + integrity check |
| GET | `/ledger/verify` | Integrity check only |

---

## Cryptographic Ledger

Every event is recorded in an append-only hash-chained ledger:

```
#00  REGISTER      agentId=agent-alpha   hash=9c46fb0d…
#01  REGISTER      agentId=agent-beta    hash=16cd1363…
#02  NONCE_ISSUED  agent-alpha→beta      hash=2b18cbff…
#03  VERIFY_PASS   agentId=agent-beta    hash=bdbee941…
#04  NONCE_ISSUED  agent-beta→alpha      hash=1d5ab9c7…
#05  VERIFY_PASS   agentId=agent-alpha   hash=9f2cea0b…
#06  NONCE_ISSUED  agent-alpha→beta      hash=431c87b2…
#07  VERIFY_FAIL   agentId=agent-beta    hash=33497321…  ← impostor caught
```

Each entry hashes `prevHash + type + data + timestamp`. Tampering with any entry
breaks all subsequent hashes — instantly detectable.

---

## Security properties

- **Private keys never leave the agent** — only public keys are registered
- **Nonces are single-use** — consumed immediately after verification
- **Nonces expire in 30 seconds** — replay attacks impossible
- **Ledger is tamper-evident** — hash chain breaks on any modification
- **No shared secrets** — Ed25519 asymmetric crypto throughout
- **Platform-agnostic** — any agent on any platform can participate

---

## Adding a new agent

```js
const { Agent } = require('./agents/agent');

const myAgent = new Agent({
  agentId: 'agent-gamma',
  platform: 'google',
  model: 'gemini-2.0',
  capabilities: ['image_analysis', 'translation'],
  systemPrompt: 'You are Agent Gamma...',
  version: '1.0.0',
  registryUrl: 'http://localhost:3000',
});

await myAgent.register();
const result = await myAgent.verifyPeer('agent-alpha', 'http://localhost:3001');
```
