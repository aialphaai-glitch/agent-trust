"""Cryptographic primitives — Ed25519 signing, JWS, canonical hashing.

Wire-compatible with the TypeScript SDK:
  - JWS compact serialization with header {alg: EdDSA, typ: JWT}
  - base64url encoding without padding
  - JSON canonicalization: sorted keys, no whitespace
  - SHA-256 for attestation hashing
"""
from __future__ import annotations
import base64
import hashlib
import json
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature


@dataclass
class KeyPair:
    private_key: Ed25519PrivateKey
    public_key: Ed25519PublicKey

    @property
    def public_bytes(self) -> bytes:
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )

    @property
    def private_bytes(self) -> bytes:
        return self.private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )


def generate_keypair() -> KeyPair:
    priv = Ed25519PrivateKey.generate()
    return KeyPair(private_key=priv, public_key=priv.public_key())


def b64u_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def did_from_public_key(pubkey: bytes, ledger: str = "main") -> str:
    return f"did:atp:{ledger}:{b64u_encode(pubkey)[:32]}"


def _canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def sign_jws(payload: dict, keypair: KeyPair) -> str:
    header = {"alg": "EdDSA", "typ": "JWT"}
    header_b64 = b64u_encode(_canonical(header))
    payload_b64 = b64u_encode(_canonical(payload))
    signing_input = f"{header_b64}.{payload_b64}".encode()
    signature = keypair.private_key.sign(signing_input)
    return f"{header_b64}.{payload_b64}.{b64u_encode(signature)}"


def verify_jws(jws: str, public_key: Ed25519PublicKey) -> bool:
    parts = jws.split(".")
    if len(parts) != 3:
        return False
    signing_input = f"{parts[0]}.{parts[1]}".encode()
    try:
        public_key.verify(b64u_decode(parts[2]), signing_input)
        return True
    except InvalidSignature:
        return False
    except Exception:
        return False


def hash_attestation(obj: dict) -> str:
    return hashlib.sha256(_canonical(obj)).hexdigest()
