"""TrustClient — primary Python SDK surface for ATP."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .crypto import (
    KeyPair,
    b64u_decode,
    b64u_encode,
    did_from_public_key,
    generate_keypair,
    hash_attestation,
    sign_jws,
    verify_jws,
)


@dataclass
class Identity:
    did: str
    keypair: KeyPair
    name: Optional[str] = None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class TrustClient:
    """Primary SDK surface: register, attest, submit, verify, query."""

    def __init__(self, endpoint: str = "https://ledger.atp.dev", ledger: str = "main"):
        self.endpoint = endpoint.rstrip("/")
        self.ledger = ledger

    def register(self, name: Optional[str] = None, publish_did_doc: bool = True) -> Identity:
        """Generate an identity. Publishes the DID document to the ledger by default."""
        kp = generate_keypair()
        did = did_from_public_key(kp.public_bytes, self.ledger)
        identity = Identity(did=did, keypair=kp, name=name)

        if publish_did_doc:
            doc = {
                "@context": ["https://www.w3.org/ns/did/v1"],
                "id": did,
                "verificationMethod": [{
                    "id": f"{did}#key-1",
                    "type": "JsonWebKey2020",
                    "controller": did,
                    "publicKeyJwk": {
                        "kty": "OKP",
                        "crv": "Ed25519",
                        "x": b64u_encode(kp.public_bytes),
                    },
                }],
                "authentication": [f"{did}#key-1"],
                "assertionMethod": [f"{did}#key-1"],
            }
            try:
                requests.post(f"{self.endpoint}/v1/dids", json=doc, timeout=10).raise_for_status()
            except Exception as e:
                # Soft failure — identity is still valid locally
                import warnings
                warnings.warn(f"Could not publish DID document: {e}")

        return identity

    def attest(
        self,
        subject: str,
        claim: dict,
        issuer: Identity,
        expires_in_seconds: Optional[int] = None,
    ) -> dict:
        """Create a signed attestation about `subject`."""
        issuance_date = _iso_now()
        base: dict[str, Any] = {
            "@context": [
                "https://www.w3.org/2018/credentials/v1",
                "https://spec.atp.dev/v1",
            ],
            "type": ["VerifiableCredential", "AgentAttestation"],
            "issuer": issuer.did,
            "issuanceDate": issuance_date,
            "credentialSubject": {"id": subject, "claim": claim},
        }
        if expires_in_seconds:
            exp = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)
            base["expirationDate"] = exp.isoformat(timespec="seconds").replace("+00:00", "Z")

        jws = sign_jws(base, issuer.keypair)

        return {
            **base,
            "proof": {
                "type": "JsonWebSignature2020",
                "created": issuance_date,
                "verificationMethod": f"{issuer.did}#key-1",
                "proofPurpose": "assertionMethod",
                "jws": jws,
            },
        }

    def submit(self, attestation: dict) -> dict:
        r = requests.post(
            f"{self.endpoint}/v1/attestations",
            json=attestation,
            timeout=10,
        )
        r.raise_for_status()
        unsigned = {k: v for k, v in attestation.items() if k != "proof"}
        return {"accepted": True, "hash": hash_attestation(unsigned), **r.json()}

    def verify(self, attestation: dict) -> bool:
        """Verify signature by resolving the issuer's DID document from the ledger."""
        did = attestation["issuer"]
        try:
            r = requests.get(f"{self.endpoint}/v1/dids/{did}", timeout=10)
            r.raise_for_status()
        except Exception:
            return False

        doc = r.json()
        try:
            jwk = doc["verificationMethod"][0]["publicKeyJwk"]
            pubkey = Ed25519PublicKey.from_public_bytes(b64u_decode(jwk["x"]))
        except (KeyError, IndexError, ValueError):
            return False

        return verify_jws(attestation["proof"]["jws"], pubkey)

    def query(self, subject: str) -> dict:
        r = requests.get(f"{self.endpoint}/v1/subjects/{subject}", timeout=10)
        r.raise_for_status()
        return r.json()

    def status(self) -> dict:
        r = requests.get(f"{self.endpoint}/v1/status", timeout=10)
        r.raise_for_status()
        return r.json()
