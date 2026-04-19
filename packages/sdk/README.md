# @atp/sdk

TypeScript SDK for the Agent Trust Protocol.

## Install
```bash
npm install @atp/sdk
```

## Use

```ts
import { TrustClient } from "@atp/sdk";

const client = new TrustClient({ endpoint: "https://ledger.atp.dev" });

// 1. Register
const me = await client.register({ name: "my-agent" });

// 2. Attest about another agent
const attestation = await client.attest({
  subject: "did:atp:main:z6MkrZ...",
  claim: { type: "task_completion", value: { task: "summary-2026-q1" } },
  issuer: me,
});

// 3. Submit & verify
await client.submit(attestation);
const ok = await client.verify(attestation);

// 4. Query reputation
const { attestations, score } = await client.query({ subject: me.did });
```
