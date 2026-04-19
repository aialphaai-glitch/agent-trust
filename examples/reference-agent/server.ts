/**
 * Profile server — serves the public trust profile page and embeddable badge.
 *
 * - GET /                 → agent's full public profile
 * - GET /badge            → iframe-embeddable badge (250×80)
 * - GET /api/profile      → JSON: agent, attestations, score, verified count
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { TrustClient } from "@atp/sdk";

const PORT = Number(process.env.PORT ?? 4546);
const client = new TrustClient({ endpoint: "http://localhost:4545", ledger: "sandbox" });

let state: { agent: { did: string; name: string }; reviewer: { did: string; name: string } };
try {
  state = JSON.parse(readFileSync("./state.json", "utf-8"));
} catch {
  console.error("✗ state.json not found — run `npm run agent` first.");
  process.exit(1);
}

const profileHtml = readFileSync("./public/profile.html", "utf-8");
const badgeHtml = readFileSync("./public/badge.html", "utf-8");

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(profileHtml.replaceAll("__DID__", state.agent.did).replaceAll("__NAME__", state.agent.name));
    return;
  }

  if (req.url === "/badge") {
    res.writeHead(200, { "Content-Type": "text/html", "X-Frame-Options": "ALLOWALL" });
    res.end(badgeHtml.replaceAll("__DID__", state.agent.did).replaceAll("__NAME__", state.agent.name));
    return;
  }

  if (req.url === "/api/profile") {
    const [rep, verification] = await Promise.all([
      client.query({ subject: state.agent.did }),
      (async () => {
        const q = await client.query({ subject: state.agent.did });
        let verified = 0;
        for (const a of q.attestations) {
          if (await client.verify(a)) verified++;
        }
        return verified;
      })(),
    ]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agent: state.agent,
      attestations: rep.attestations,
      score: rep.score,
      verified_count: verification,
    }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}).listen(PORT, () => {
  console.log(`⬡  Reference Agent profile → http://localhost:${PORT}`);
  console.log(`   Embeddable badge        → http://localhost:${PORT}/badge`);
});
