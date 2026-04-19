import type { Attestation, Claim, DID, Identity, QueryResult, TrustClientOptions } from "./types.js";
import { didFromPublicKey, generateKeyPair, hashAttestation, signJWS, verifyJWS, b64u } from "./crypto.js";

/**
 * TrustClient — the primary SDK surface.
 *
 * Usage:
 *   const client = new TrustClient({ endpoint: "https://ledger.atp.dev" });
 *   const me = await client.register({ name: "my-agent" });
 *   const a = await client.attest({ subject, claim, issuer: me });
 *   await client.submit(a);
 */
export class TrustClient {
  private endpoint: string;
  private ledger: string;

  constructor(opts: TrustClientOptions = {}) {
    this.endpoint = opts.endpoint ?? "https://ledger.atp.dev";
    this.ledger = opts.ledger ?? "main";
  }

  /** Generate a new identity (DID + Ed25519 keypair). Does NOT auto-publish the DID document. */
  async register(args: { name?: string } = {}): Promise<Identity> {
    const keyPair = await generateKeyPair();
    const did = didFromPublicKey(keyPair.publicKey, this.ledger);
    return { did, keyPair, name: args.name };
  }

  /**
   * Publish the identity's DID document to the ledger so verifiers can
   * resolve its public key. Produces a W3C-compliant DID doc with a single
   * Ed25519 JsonWebKey2020 verification method (`#key-1`).
   */
  async publishIdentity(identity: Identity): Promise<{ published: string }> {
    const doc = {
      "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/jws-2020/v1"],
      id: identity.did,
      verificationMethod: [{
        id: `${identity.did}#key-1`,
        type: "JsonWebKey2020",
        controller: identity.did,
        publicKeyJwk: {
          kty: "OKP",
          crv: "Ed25519",
          x: b64u.encode(identity.keyPair.publicKey),
        },
      }],
      authentication: [`${identity.did}#key-1`],
      assertionMethod: [`${identity.did}#key-1`],
    };
    const res = await fetch(`${this.endpoint}/v1/dids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`publishIdentity failed: ${res.status} ${await res.text()}`);
    return { published: identity.did };
  }

  /** Create a signed attestation. */
  async attest(args: { subject: DID; claim: Claim; issuer: Identity; expiresIn?: number }): Promise<Attestation> {
    const issuanceDate = new Date().toISOString();
    const expirationDate = args.expiresIn
      ? new Date(Date.now() + args.expiresIn).toISOString()
      : undefined;

    const base = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://spec.atp.dev/v1",
      ],
      type: ["VerifiableCredential", "AgentAttestation"],
      issuer: args.issuer.did,
      issuanceDate,
      ...(expirationDate && { expirationDate }),
      credentialSubject: {
        id: args.subject,
        claim: args.claim,
      },
    };

    const jws = await signJWS(base, args.issuer.keyPair.privateKey);

    return {
      ...base,
      proof: {
        type: "JsonWebSignature2020",
        created: issuanceDate,
        verificationMethod: `${args.issuer.did}#key-1`,
        proofPurpose: "assertionMethod",
        jws,
      },
    } as Attestation;
  }

  /** Submit an attestation to the ledger. Returns an inclusion proof when batched. */
  async submit(attestation: Attestation): Promise<{ accepted: boolean; hash: string }> {
    const { proof, ...unsigned } = attestation;
    const hash = hashAttestation(unsigned);
    const res = await fetch(`${this.endpoint}/v1/attestations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestation),
    });
    if (!res.ok) throw new Error(`submit failed: ${res.status} ${await res.text()}`);
    return { accepted: true, hash };
  }

  /** Verify an attestation's signature against the issuer's public key (parsed from DID). */
  async verify(attestation: Attestation): Promise<boolean> {
    // Recover public key from DID (did:atp:<ledger>:<b64u-pubkey-prefix>)
    // In production, resolve the DID document via the ledger for full pubkey.
    // For local/in-memory verification, caller should supply the pubkey or resolve.
    const didParts = attestation.issuer.split(":");
    if (didParts.length < 4) return false;

    // Resolve full DID document from ledger
    const docRes = await fetch(`${this.endpoint}/v1/dids/${encodeURIComponent(attestation.issuer)}`);
    if (!docRes.ok) return false;
    const doc = await docRes.json();
    const pubJwk = doc?.verificationMethod?.[0]?.publicKeyJwk;
    if (!pubJwk?.x) return false;

    const publicKey = b64u.decode(pubJwk.x);
    return await verifyJWS(attestation.proof.jws, publicKey);
  }

  /** Query attestations and reference-scored reputation for a subject. */
  async query(args: { subject: DID }): Promise<QueryResult> {
    const res = await fetch(`${this.endpoint}/v1/subjects/${encodeURIComponent(args.subject)}`);
    if (!res.ok) throw new Error(`query failed: ${res.status}`);
    return await res.json();
  }
}
