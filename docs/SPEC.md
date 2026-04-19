# Agent Trust Protocol — Specification

**Version:** 0.1.0-draft
**Status:** Working Draft

## 1. Abstract

ATP is an open protocol for cryptographically verifiable trust attestations between autonomous AI agents. It uses W3C DIDs for identity, W3C Verifiable Credentials as the attestation format, and a federated Merkle-batched ledger for tamper-evident inclusion.

## 2. Design Principles

1. **Trust displacement, not elimination.** Trust must be placed somewhere. ATP displaces it from opaque platform operators to a transparent, multi-party ledger with cryptographic proofs.
2. **Standards-native.** W3C DIDs, W3C VCs, JOSE (JWS/JWK). No custom credential format.
3. **Zero integration cost.** One import, three method calls — or zero, via the MCP server.
4. **Federated, not decentralized.** M-of-N threshold signatures on batches. Avoids full-consensus latency while maintaining tamper-evidence.

## 3. Identity

### 3.1 DID Method

`did:atp:<ledger-id>:<identifier>`

Examples:
- `did:atp:main:z6Mkh...Ed25519` (multibase-encoded public key)
- `did:atp:sandbox:alice`

### 3.2 DID Document

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:atp:main:z6Mkh...",
  "verificationMethod": [{
    "id": "did:atp:main:z6Mkh...#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:atp:main:z6Mkh...",
    "publicKeyJwk": { "kty": "OKP", "crv": "Ed25519", "x": "<base64url>" }
  }],
  "authentication": ["did:atp:main:z6Mkh...#key-1"],
  "assertionMethod": ["did:atp:main:z6Mkh...#key-1"]
}
```

## 4. Attestations

An attestation is a W3C Verifiable Credential signed with Ed25519 (JsonWebSignature2020).

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://spec.atp.dev/v1"
  ],
  "type": ["VerifiableCredential", "AgentAttestation"],
  "issuer": "did:atp:main:<issuer-did>",
  "issuanceDate": "2026-04-18T14:00:00Z",
  "expirationDate": "2026-10-18T14:00:00Z",
  "credentialSubject": {
    "id": "did:atp:main:<subject-did>",
    "claim": {
      "type": "task_completion",
      "value": { "task": "billing-reconciliation-q3", "outcome": "success" },
      "context": "optional-free-form"
    }
  },
  "proof": {
    "type": "JsonWebSignature2020",
    "created": "2026-04-18T14:00:00Z",
    "verificationMethod": "did:atp:main:<issuer-did>#key-1",
    "proofPurpose": "assertionMethod",
    "jws": "<compact-JWS>"
  }
}
```

### 4.1 Claim Type Registry (v0.1)

| Type | Description |
|------|-------------|
| `task_completion` | Subject completed a task successfully |
| `behavior_observation` | Observation of subject's behavior (may be negative) |
| `identity_binding` | Binds DID to external identity (domain, email, ENS) |
| `capability_assertion` | Subject demonstrated a capability |
| `delegation` | Subject is delegated authority by issuer |

Custom claim types MUST use URI form: `https://example.com/claims/custom-type`.

## 5. Ledger

### 5.1 Batching

Attestations are accumulated into batches. Each batch:
- Contains 1..N attestations
- Produces a Merkle root (SHA-256, RFC 6962 style)
- Is signed M-of-N by ledger operators (threshold signature, BLS or Ed25519 multisig)
- Is timestamped and published with a monotonic sequence number

### 5.2 Inclusion Proof

```json
{
  "batch_root": "<hex>",
  "batch_sequence": 42,
  "batch_signature": "<threshold-sig>",
  "attestation_hash": "<hex>",
  "path": [{ "hash": "<hex>", "position": "left" }, ...]
}
```

A verifier MUST:
1. Verify the attestation's inner JWS against the issuer's DID document.
2. Compute the attestation hash and verify the Merkle path reaches `batch_root`.
3. Verify the batch signature meets the M-of-N threshold for the ledger operators at that sequence number.

## 6. Reputation

Reputation is **not** a single number returned by the ledger. The ledger returns raw attestations; reputation scoring is an application-layer concern. A reference scoring function is provided for bootstrap:

```
score(subject) = Σ over attestations a:
  weight(a.claim.type)
  × trust(a.issuer)
  × decay(now - a.issuanceDate)
  × polarity(a)
```

Where `trust(issuer)` is computed recursively, bootstrapped from a genesis set of trusted issuers.

## 7. Revocation

Issuers MAY revoke their own attestations by submitting a revocation entry `{ attestation_hash, revoked_at, reason? }` signed with the same key. Verifiers MUST consult the revocation index before treating an attestation as valid.

## 8. Threat Model

| Threat | Mitigation |
|--------|------------|
| Colluding issuers | Reputation weighting; threshold aggregation of similar claims |
| Sybil attacks | `identity_binding` attestations required for high-weight participation |
| Single operator compromise | M-of-N threshold signatures on batches |
| Replay | Nonce + issuance date required in every attestation |
| Ledger fork | Monotonic sequence + signed batch headers; forks are detectable |
| Key compromise | DID document rotation; revocation of attestations signed under compromised key |

## 9. Privacy (Non-normative for v0.1)

- **Selective disclosure** via BBS+ signatures: reveal only specific claim fields
- **Zero-knowledge reputation proofs**: prove `score > threshold` without revealing attestations

## 10. Versioning

Semantic versioning. Breaking changes before v1.0.0 are expected. The `@context` URL `https://spec.atp.dev/v1` pins to major version 1.
