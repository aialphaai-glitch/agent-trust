from typing import Any, TypedDict, Optional, List


class Claim(TypedDict, total=False):
    type: str
    value: Any
    context: Optional[str]


class Proof(TypedDict):
    type: str
    created: str
    verificationMethod: str
    proofPurpose: str
    jws: str


class CredentialSubject(TypedDict):
    id: str
    claim: Claim


class Attestation(TypedDict, total=False):
    issuer: str
    issuanceDate: str
    expirationDate: Optional[str]
    credentialSubject: CredentialSubject
    proof: Proof
