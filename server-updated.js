'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../shared/db');
const { verify, generateNonce, sha256 } = require('../shared/crypto');

const PORT = process.env.PORT || 3000;
const NONCE_TTL_MS = 30_000;

// Nonces stay in-memory (intentional — ephemeral by design, never persisted)
const nonces = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Registry-Version': '1.0.0',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function log(tag, msg, extra = '') {
  const ts = new Date().toISOString().substring(11, 23);
  const colors = { REG: '\x1b[36m', NONCE: '\x1b[33m', PASS: '\x1b[32m', FAIL: '\x1b[31m', INFO: '\x1b[90m' };
  const c = colors[tag] || '\x1b[0m';
  console.log(`${c}[${ts}] [REGISTRY] [${tag}]\x1b[0m ${msg}`, extra);
}

// ── Handlers ──────────────────────────────────────────────────────────────────
async function handleRegister(req, res) {
  const { agentId, publicKey, manifest } = await readBody(req);
  if (!agentId || !publicKey || !manifest)
    return json(res, 400, { error: 'Missing agentId, publicKey, or manifest' });
  if (db.agentExists(agentId))
    return json(res, 409, { error: 'Agent already registered', agentId });

  const manifestHash = sha256(JSON.stringify(manifest));
  const registeredAt = new Date().toISOString();
  db.registerAgent({ agentId, publicKey, manifest, manifestHash, registeredAt });
  const entry = db.appendLedger('REGISTER', { agentId, publicKey, manifest, manifestHash });
  log('REG', `Registered: ${agentId}`, `(${manifest.platform}/${manifest.model})`);
  return json(res, 201, { status: 'registered', agentId, manifestHash, ledgerIndex: entry.index });
}

async function handleNonce(req, res) {
  const { requesterId, targetId } = await readBody(req);
  if (!db.agentExists(requesterId)) return json(res, 404, { error: 'Requester not registered', requesterId });
  if (!db.agentExists(targetId))   return json(res, 404, { error: 'Target not registered', targetId });

  const nonce = generateNonce();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonces.set(nonce, { requesterId, targetId, expiresAt });
  setTimeout(() => nonces.delete(nonce), NONCE_TTL_MS);

  const entry = db.appendLedger('NONCE_ISSUED', {
    requesterId, targetId, noncePrefix: nonce.slice(0, 8) + '…'
  });
  log('NONCE', `Issued: ${requesterId} → ${targetId}`);
  return json(res, 200, { nonce, expiresAt: new Date(expiresAt).toISOString(), ledgerIndex: entry.index });
}

async function handleVerify(req, res) {
  const { nonce, agentId, signature } = await readBody(req);
  const nonceRecord = nonces.get(nonce);
  if (!nonceRecord) return json(res, 400, { error: 'Unknown or expired nonce' });

  if (nonceRecord.targetId !== agentId) {
    db.appendLedger('VERIFY_FAIL', { agentId, reason: 'nonce/agent mismatch' });
    return json(res, 403, { error: 'Nonce was not issued for this agent' });
  }
  if (Date.now() > nonceRecord.expiresAt) {
    nonces.delete(nonce);
    db.appendLedger('VERIFY_FAIL', { agentId, reason: 'nonce expired' });
    return json(res, 400, { error: 'Nonce expired' });
  }

  const agent = db.getAgent(agentId);
  if (!agent) return json(res, 404, { error: 'Agent not registered' });

  const valid = verify(nonce, signature, agent.publicKey);
  nonces.delete(nonce);

  if (!valid) {
    db.incrementFail(agentId);
    const entry = db.appendLedger('VERIFY_FAIL', {
      agentId, requesterId: nonceRecord.requesterId, reason: 'invalid signature',
    });
    log('FAIL', `FAILED: ${agentId}`, `(from ${nonceRecord.requesterId})`);
    return json(res, 403, {
      verified: false, agentId,
      reason: 'Signature did not match registered public key',
      ledgerIndex: entry.index,
    });
  }

  db.incrementPass(agentId);
  const updated = db.getAgent(agentId);
  const entry = db.appendLedger('VERIFY_PASS', {
    agentId, requesterId: nonceRecord.requesterId, manifestHash: agent.manifestHash,
  });
  log('PASS', `PASSED: ${agentId}`, `(from ${nonceRecord.requesterId})`);
  return json(res, 200, {
    verified: true, agentId,
    manifest: agent.manifest,
    manifestHash: agent.manifestHash,
    reputation: updated.reputation,
    registeredAt: agent.registeredAt,
    ledgerIndex: entry.index,
  });
}

function handleGetAgent(req, res, agentId) {
  const agent = db.getAgent(agentId);
  if (!agent) return json(res, 404, { error: 'Agent not found' });
  return json(res, 200, {
    agentId, manifest: agent.manifest,
    manifestHash: agent.manifestHash,
    reputation: agent.reputation,
    registeredAt: agent.registeredAt,
  });
}

function handleHealth(req, res) {
  return json(res, 200, {
    status: 'ok', version: '1.0.0',
    ledger: db.verifyLedger(),
    uptime: Math.floor(process.uptime()),
    dbPath: db.DB_PATH,
  });
}

function handleLedger(req, res)       { return json(res, 200, { integrity: db.verifyLedger(), entries: db.getLedger() }); }
function handleLedgerVerify(req, res) { return json(res, 200, db.verifyLedger()); }
function handleListAgents(req, res) {
  const agents = db.listAgents().map(a => ({
    agentId: a.agentId, platform: a.manifest.platform,
    model: a.manifest.model, reputation: a.reputation, registeredAt: a.registeredAt,
  }));
  return json(res, 200, { count: agents.length, agents });
}

// ── Router ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const p = url.pathname;
  const m = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (m === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (m === 'POST' && p === '/register')       return await handleRegister(req, res);
    if (m === 'POST' && p === '/nonce')          return await handleNonce(req, res);
    if (m === 'POST' && p === '/verify')         return await handleVerify(req, res);
    if (m === 'GET'  && p === '/agents')         return handleListAgents(req, res);
    if (m === 'GET'  && p === '/ledger')         return handleLedger(req, res);
    if (m === 'GET'  && p === '/ledger/verify')  return handleLedgerVerify(req, res);
    if (m === 'GET'  && p === '/health')         return handleHealth(req, res);
    if (m === 'GET'  && p.startsWith('/agent/')) return handleGetAgent(req, res, p.slice(7));
    if (m === 'GET'  && (p === '/' || p === '')) {
      const indexPath = path.join(__dirname, '..', 'public', 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(fs.readFileSync(indexPath));
      }
    }
    return json(res, 404, { error: 'Unknown route' });
  } catch (err) {
    log('INFO', 'Error:', err.message);
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  log('INFO', `Trust Registry on port ${PORT}`);
  log('INFO', `Database: ${db.DB_PATH}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));

module.exports = { server };
