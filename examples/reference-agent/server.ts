/**
 * ATP reference deployment — aiagenttrust.dev
 *
 * Routes:
 *   GET  /                        → landing page (vision, live stats)
 *   GET  /agents                  → public directory
 *   GET  /agents/:did             → per-agent trust profile
 *   GET  /badge/:did              → embeddable badge for any agent
 *   GET  /docs                    → developer docs index
 *   GET  /docs/quickstart         → SDK quickstart
 *   GET  /docs/api                → HTTP API reference
 *   GET  /docs/roadmap            → honest roadmap (v0.2 task marketplace, v0.3 payments)
 *
 *   GET  /api/agents              → JSON: all registered agents with scores
 *   GET  /api/agents/:did         → JSON: single agent profile (attestations + score + verified count)
 *   GET  /api/stats               → JSON: ledger-wide stats for the landing page
 *   GET  /api/profile             → DEPRECATED alias — first registered agent's profile (backcompat)
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { TrustClient } from "@atp/sdk";

const PORT = Number(process.env.PORT ?? 4546);
const LEDGER = process.env.LEDGER_ENDPOINT ?? "http://localhost:4545";
const client = new TrustClient({ endpoint: LEDGER, ledger: "sandbox" });

const tpl = {
  landing: readFileSync("./public/landing.html", "utf-8"),
  agents: readFileSync("./public/agents.html", "utf-8"),
  profile: readFileSync("./public/profile.html", "utf-8"),
  badge: readFileSync("./public/badge.html", "utf-8"),
  docsIndex: readFileSync("./public/docs/index.html", "utf-8"),
  docsQuickstart: readFileSync("./public/docs/quickstart.html", "utf-8"),
  docsApi: readFileSync("./public/docs/api.html", "utf-8"),
  docsRoadmap: readFileSync("./public/docs/roadmap.html", "utf-8"),
  notFound: readFileSync("./public/404.html", "utf-8"),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendHtml(res: ServerResponse, body: string, opts: { iframeOk?: boolean } = {}) {
  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
  if (opts.iframeOk) headers["X-Frame-Options"] = "ALLOWALL";
  res.writeHead(200, headers).end(body);
}

function sendJson(res: ServerResponse, obj: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
}

function substitute(html: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`__${k}__`, escapeHtml(v)),
    html,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function loadAgent(did: string) {
  const [doc, q] = await Promise.all([
    client.resolveDid(did).catch(() => null),
    client.query({ subject: did }).catch(() => ({ attestations: [], score: 0 })),
  ]);
  if (!doc) return null;
  let verified = 0;
  for (const a of q.attestations) {
    if (await client.verify(a).catch(() => false)) verified++;
  }
  return {
    did,
    name: doc.name ?? did.split(":").pop()!.slice(0, 12),
    capabilities: doc.capabilities ?? [],
    registeredAt: doc.registeredAt ?? null,
    attestations: q.attestations,
    score: q.score,
    verified_count: verified,
    issuer_count: new Set(q.attestations.map((a: any) => a.issuer)).size,
  };
}

async function loadDirectory(filter?: { capability?: string }) {
  const { dids } = await client.listDids().catch(() => ({ dids: [] as any[] }));
  const agents = await Promise.all(dids.map((d: any) => loadAgent(d.id)));
  const filtered = agents
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .filter(a => !filter?.capability || a.capabilities.includes(filter.capability));
  return filtered.sort((a, b) => b.score - a.score);
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // Static pages
  if (path === "/" || path === "/index.html") return sendHtml(res, tpl.landing);
  if (path === "/agents" || path === "/agents/") {
    return sendHtml(res, tpl.agents);
  }
  if (path === "/docs" || path === "/docs/") return sendHtml(res, tpl.docsIndex);
  if (path === "/docs/quickstart") return sendHtml(res, tpl.docsQuickstart);
  if (path === "/docs/api") return sendHtml(res, tpl.docsApi);
  if (path === "/docs/roadmap") return sendHtml(res, tpl.docsRoadmap);

  // Per-agent profile: /agents/:did
  const agentMatch = path.match(/^\/agents\/(.+)$/);
  if (agentMatch) {
    const did = decodeURIComponent(agentMatch[1]);
    const doc = await client.resolveDid(did).catch(() => null);
    if (!doc) return sendHtml(res, tpl.notFound);
    return sendHtml(res, substitute(tpl.profile, {
      DID: did,
      NAME: doc.name ?? did.split(":").pop()!.slice(0, 12),
    }));
  }

  // Per-agent badge: /badge/:did
  const badgeMatch = path.match(/^\/badge\/(.+)$/);
  if (badgeMatch) {
    const did = decodeURIComponent(badgeMatch[1]);
    const doc = await client.resolveDid(did).catch(() => null);
    if (!doc) return sendHtml(res, tpl.notFound);
    return sendHtml(
      res,
      substitute(tpl.badge, {
        DID: did,
        NAME: doc.name ?? did.split(":").pop()!.slice(0, 12),
      }),
      { iframeOk: true },
    );
  }

  // ─── JSON API ─────────────────────────────────────────────────────────────

  if (path === "/api/agents") {
    const capability = url.searchParams.get("capability") ?? undefined;
    const agents = await loadDirectory({ capability });
    return sendJson(res, {
      count: agents.length,
      agents: agents.map(a => ({
        did: a.did,
        name: a.name,
        capabilities: a.capabilities,
        registered_at: a.registeredAt,
        score: a.score,
        verified_count: a.verified_count,
        attestation_count: a.attestations.length,
        issuer_count: a.issuer_count,
      })),
    });
  }

  const apiAgentMatch = path.match(/^\/api\/agents\/(.+)$/);
  if (apiAgentMatch) {
    const did = decodeURIComponent(apiAgentMatch[1]);
    const agent = await loadAgent(did);
    if (!agent) return sendJson(res, { error: "agent not found" }, 404);
    return sendJson(res, {
      agent: { did: agent.did, name: agent.name, capabilities: agent.capabilities, registered_at: agent.registeredAt },
      attestations: agent.attestations,
      score: agent.score,
      verified_count: agent.verified_count,
      issuer_count: agent.issuer_count,
    });
  }

  if (path === "/api/stats") {
    const [agents, status] = await Promise.all([
      loadDirectory(),
      fetch(`${LEDGER}/v1/status`).then(r => r.json()).catch(() => ({})),
    ]);
    const totalAttestations = agents.reduce((s, a) => s + a.attestations.length, 0);
    const capabilities = new Set<string>();
    for (const a of agents) a.capabilities.forEach((c: string) => capabilities.add(c));
    return sendJson(res, {
      agent_count: agents.length,
      attestation_count: totalAttestations,
      capability_count: capabilities.size,
      ledger: {
        batches: status.batches ?? 0,
        threshold: status.threshold ?? null,
      },
    });
  }

  // Backcompat — old single-agent profile endpoint
  if (path === "/api/profile") {
    const { dids } = await client.listDids().catch(() => ({ dids: [] }));
    if (!dids.length) return sendJson(res, { error: "no agents registered" }, 404);
    const first = dids[0].id;
    const agent = await loadAgent(first);
    if (!agent) return sendJson(res, { error: "agent not found" }, 404);
    return sendJson(res, {
      agent: { did: agent.did, name: agent.name },
      attestations: agent.attestations,
      score: agent.score,
      verified_count: agent.verified_count,
    });
  }

  sendHtml(res, tpl.notFound);
}

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  handle(req, res).catch(err => {
    console.error(err);
    sendJson(res, { error: "internal error" }, 500);
  });
}).listen(PORT, () => {
  console.log(`⬡  ATP reference server → http://localhost:${PORT}`);
  console.log(`   landing   → /`);
  console.log(`   directory → /agents`);
  console.log(`   docs      → /docs`);
  console.log(`   ledger    → ${LEDGER}`);
});
