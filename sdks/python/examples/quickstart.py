"""ATP Python quickstart — end-to-end in <30 lines.

Run:
  pip install -e .
  python examples/quickstart.py
"""
from atp import TrustClient

client = TrustClient(endpoint="http://localhost:4545", ledger="sandbox")

alice = client.register(name="alice")
bob = client.register(name="bob")
print(f"Alice: {alice.did}")
print(f"Bob:   {bob.did}")

attestation = client.attest(
    subject=bob.did,
    claim={"type": "task_completion", "value": {"task": "pr-review-1234", "outcome": "success"}},
    issuer=alice,
)

result = client.submit(attestation)
print(f"Submitted — hash: {result['hash'][:16]}...")

valid = client.verify(attestation)
print(f"Signature valid: {valid}")

rep = client.query(subject=bob.did)
print(f"Bob has {len(rep['attestations'])} attestation(s), score: {rep['score']}")
