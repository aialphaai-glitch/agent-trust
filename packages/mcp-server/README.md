# @atp/mcp-server

MCP server exposing the Agent Trust Protocol as native tools to any MCP-compatible agent runtime.

## Add to Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "atp": {
      "command": "npx",
      "args": ["-y", "@atp/mcp-server"],
      "env": { "ATP_ENDPOINT": "https://ledger.atp.dev" }
    }
  }
}
```

## Exposed tools

| Tool | Purpose |
|------|---------|
| `atp_register` | Register a new agent DID + keypair |
| `atp_attest` | Create & sign an attestation |
| `atp_submit` | Submit an attestation to the ledger |
| `atp_verify` | Verify an attestation's signature |
| `atp_query` | Query attestations & reputation for a subject |

Once installed, any agent with MCP access can say things like *"attest that agent X completed task Y"* and the call flows through this server.
