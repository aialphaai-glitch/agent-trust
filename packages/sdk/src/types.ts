export type DID = string;

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface Identity {
  did: DID;
  keyPair: KeyPair;
  name?: string;
}

export interface Claim {
  type: string;
  value: unknown;
  context?: string;
}

export interface Attestation {
  "@context": string[];
  type: string[];
  issuer: DID;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: {
    id: DID;
    claim: Claim;
  };
  proof: {
    type: "JsonWebSignature2020";
    created: string;
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    jws: string;
  };
}

export interface InclusionProof {
  batch_root: string;
  batch_sequence: number;
  batch_signature: string;
  attestation_hash: string;
  path: Array<{ hash: string; position: "left" | "right" }>;
}

export interface QueryResult {
  subject: DID;
  attestations: Array<Attestation & { inclusionProof?: InclusionProof }>;
  score: number;
}

export interface TrustClientOptions {
  endpoint?: string;
  ledger?: "main" | "sandbox" | string;
}
