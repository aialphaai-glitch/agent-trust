#!/usr/bin/env node
/**
 * ATP MCP Server
 *
 * Exposes Agent Trust Protocol operations as MCP tools so any MCP-compatible
 * agent (Claude Desktop, Claude Code, custom clients) can attest and verify
 * with zero SDK integration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TrustClient, type Identity } from "@atp/sdk";
import { z } from "zod";

const ENDPOINT = process.env.ATP_ENDPOINT ?? "https://ledger.atp.dev";
const client = new TrustClient({ endpoint: ENDPOINT });

// In-memory identity store for this session. Production: load from keystore.
const identities = new Map<string, Identity>();

const server = new Server(
  { name: "atp-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "atp_register",
    description: "Register a new agent identity (DID + Ed25519 keypair). Returns the DID, which is the agent's permanent identifier on the trust ledger.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable name for this agent" },
      },
      required: [],
    },
  },
  {
    name: "atp_attest",
    description: "Create a signed attestation about a subject agent. Use this to vouch for task completion, assert capabilities, or record observations about another agent's behavior.",
    inputSchema: {
      type: "object",
      properties: {
        issuer_did: { type: "string", description: "DID of the agent issuing the attestation (must be registered)" },
        subject: { type: "string", description: "DID of the subject being attested about" },
        claim_type: {
          type: "string",
          enum: ["task_completion", "behavior_observation", "identity_binding", "capability_assertion", "delegation"],
          description: "Standard claim type from the ATP registry",
        },
        claim_value: { description: "The claim payload (any JSON value)" },
        context: { type: "string", description: "Optional free-form context" },
      },
      required: ["issuer_did", "subject", "claim_type", "claim_value"],
    },
  },
  {
    name: "atp_submit",
    description: "Submit a signed attestation to the ledger for batching and inclusion.",
    inputSchema: {
      type: "object",
      properties: {
        attestation: { type: "object", description: "A signed attestation object from atp_attest" },
      },
      required: ["attestation"],
    },
  },
  {
    name: "atp_verify",
    description: "Verify an attestation's cryptographic signature and its issuer's identity.",
    inputSchema: {
      type: "object",
      properties: {
        attestation: { type: "object", description: "The attestation to verify" },
      },
      required: ["attestation"],
    },
  },
  {
    name: "atp_query",
    description: "Query all attestations about a subject DID, plus a reference-scored reputation value.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "DID of the subject to query" },
      },
      required: ["subject"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// ─── Tool Handlers ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    switch (name) {
      case "atp_register": {
        const identity = await client.register({ name: args.name as string });
        identities.set(identity.did, identity);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ did: identity.did, name: identity.name }, null, 2),
          }],
        };
      }

      case "atp_attest": {
        const { issuer_did, subject, claim_type, claim_value, context } = args as any;
        const issuer = identities.get(issuer_did);
        if (!issuer) throw new Error(`Unknown issuer DID: ${issuer_did}. Call atp_register first.`);

        const attestation = await client.attest({
          subject,
          claim: { type: claim_type, value: claim_value, context },
          issuer,
        });
        return { content: [{ type: "text", text: JSON.stringify(attestation, null, 2) }] };
      }

      case "atp_submit": {
        const result = await client.submit((args as any).attestation);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "atp_verify": {
        const ok = await client.verify((args as any).attestation);
        return { content: [{ type: "text", text: JSON.stringify({ valid: ok }) }] };
      }

      case "atp_query": {
        const result = await client.query({ subject: (args as any).subject });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Transport ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[atp-mcp] Server running against ${ENDPOINT}`);
