"""Agent Trust Protocol — Python SDK."""
from .client import TrustClient, Identity
from .crypto import generate_keypair, did_from_public_key, sign_jws, verify_jws, hash_attestation
from .types import Claim, Attestation

__all__ = [
    "TrustClient",
    "Identity",
    "Claim",
    "Attestation",
    "generate_keypair",
    "did_from_public_key",
    "sign_jws",
    "verify_jws",
    "hash_attestation",
]
__version__ = "0.1.0"
