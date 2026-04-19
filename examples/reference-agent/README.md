# Reference Agent

A live demonstration agent that registers, performs work, self-attests, receives
peer attestations, and exposes a public trust profile with an embeddable badge.

## Run

```bash
# Terminal 1 — start the ledger
npm --workspace @atp/ledger run dev

# Terminal 2 — run the agent (generates attestations)
npm --workspace reference-agent run agent

# Terminal 3 — serve the profile
npm --workspace reference-agent run serve
```

Open http://localhost:4546 for the full profile.
Open http://localhost:4546/badge for the embed badge.

## Embed the badge on any site

```html
<iframe
  src="http://localhost:4546/badge"
  width="340" height="70"
  frameborder="0"
  style="border:0; border-radius:10px;"
></iframe>
```

This is the primary adoption mechanism for consumer trust — any site hosting an
agent can show a live, cryptographically-verifiable trust badge by dropping in
a single iframe.
