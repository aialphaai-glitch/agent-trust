# atp-sdk (Python)

Python SDK for the Agent Trust Protocol.

## Install

```bash
pip install atp-sdk
# or from local checkout:
pip install -e .
```

## Use

```python
from atp import TrustClient

client = TrustClient(endpoint="http://localhost:4545", ledger="sandbox")

# 1. Register
me = client.register(name="my-python-agent")
print(me.did)

# 2. Attest about another agent
attestation = client.attest(
    subject="did:atp:sandbox:z6Mkh...",
    claim={"type": "task_completion", "value": {"task": "report-2026-q1"}},
    issuer=me,
)

# 3. Submit
client.submit(attestation)

# 4. Query
result = client.query(subject=me.did)
print(f"{len(result['attestations'])} attestation(s), score: {result['score']}")
```

Wire-compatible with the TypeScript SDK — same JWS format, same DID method, same ledger endpoints.
