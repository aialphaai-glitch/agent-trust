'use strict';
/**
 * trust-protocol
 * Cross-platform cryptographic identity verification for AI agents.
 *
 * Usage:
 *   const { TrustProtocol } = require('trust-protocol');
 *
 *   const trust = new TrustProtocol({
 *     agentId: 'my-agent-01',
 *     platform: 'anthropic',
 *     model: 'claude-sonnet-4-20250514',
 *     capabilities: ['web_search', 'code_execution'],
 *     systemPrompt: 'You are...',
 *     registryUrl: 'https://aiagenttrust.dev',
 *   });
 *
 *   await trust.register();
 *   const result = await trust.verify('their-agent-id', 'https://their-agent.com');
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');

class TrustProtocol {
  constructor({
    agentId,
    platform,
    model,
    capabilities = [],
    systemPrompt = '',
    version = '1.0.0',
    registryUrl = 'https://aiagenttrust.dev',
  } = {}) {
    if (!agentId)  throw new Error('TrustProtocol: agentId is required');
    if (!platform) throw new Error('TrustProtocol: platform is required');
    if (!model)    throw new Error('TrustProtocol: model is required');

    this.agentId     = agentId;
    this.registryUrl = registryUrl.replace(/\/$/, '');
    this.manifest    = {
      platform,
      model,
      capabilities,
      systemPromptHash: crypto.createHash('sha256').update(systemPrompt).digest('hex'),
      version,
    };

    // Generate Ed25519 keypair — private key never leaves this instance
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    this._publicKey  = publicKey.export({ type: 'spki',  format: 'der' }).toString('hex');
    this._privateKey = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');
    this._registered = false;

    this._log(`Agent created [${agentId}] — public key: ${this._publicKey.slice(0, 20)}…`);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Register this agent with the Trust Registry.
   * Call once at startup. Safe to await.
   *
   * @returns {Promise<{ agentId, manifestHash, ledgerIndex }>}
   */
  async register() {
    if (this._registered) {
      this._log('Already registered — skipping');
      return;
    }

    this._log('Registering with Trust Registry…');
    const res = await this._post('/register', {
      agentId:   this.agentId,
      publicKey: this._publicKey,
      manifest:  this.manifest,
    });

    if (res.status === 201) {
      this._registered = true;
      this._log(`✓ Registered — manifest hash: ${res.body.manifestHash?.slice(0, 16)}… (ledger #${res.body.ledgerIndex})`);
      return res.body;
    }

    if (res.status === 409) {
      this._log('Already registered in registry — continuing');
      this._registered = true;
      return res.body;
    }

    throw new Error(`Registration failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  /**
   * Verify a peer agent. Full autonomous Ed25519 handshake.
   *
   * @param {string} targetId   - The agentId of the agent to verify
   * @param {string} peerUrl    - The base URL of the peer's challenge server
   * @returns {Promise<{ verified: boolean, manifest?, reputation?, reason? }>}
   */
  async verify(targetId, peerUrl) {
    this._assertRegistered();
    this._log(`Verifying "${targetId}"…`);

    // Step 1: request nonce from registry
    const nonceRes = await this._post('/nonce', {
      requesterId: this.agentId,
      targetId,
    });
    if (nonceRes.status !== 200) {
      throw new Error(`Nonce request failed (${nonceRes.status}): ${JSON.stringify(nonceRes.body)}`);
    }
    const { nonce } = nonceRes.body;

    // Step 2: send challenge to peer
    const challengeRes = await this._httpReq(peerUrl, 'POST', '/challenge', {
      nonce,
      requesterId: this.agentId,
    });
    if (challengeRes.status !== 200) {
      throw new Error(`Challenge failed (${challengeRes.status}): ${JSON.stringify(challengeRes.body)}`);
    }
    const { signature } = challengeRes.body;

    // Step 3: submit to registry for verification
    const verifyRes = await this._post('/verify', { nonce, agentId: targetId, signature });

    if (verifyRes.status === 200 && verifyRes.body.verified) {
      this._log(`✓ Verified "${targetId}" (ledger #${verifyRes.body.ledgerIndex})`);
      return {
        verified:    true,
        manifest:    verifyRes.body.manifest,
        reputation:  verifyRes.body.reputation,
        ledgerIndex: verifyRes.body.ledgerIndex,
      };
    }

    this._log(`✗ Verification failed for "${targetId}": ${verifyRes.body.reason}`);
    return { verified: false, reason: verifyRes.body.reason };
  }

  /**
   * Sign a nonce. Call this inside your /challenge HTTP endpoint.
   *
   * @param {string} nonce
   * @returns {string} hex-encoded signature
   */
  sign(nonce) {
    const keyDer = Buffer.from(this._privateKey, 'hex');
    const privateKey = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' });
    return crypto.sign(null, Buffer.from(nonce, 'utf8'), privateKey).toString('hex');
  }

  /**
   * Returns a ready-made Express/Node handler for the /challenge endpoint.
   * Mount this on POST /challenge in your agent's HTTP server.
   *
   * @example
   *   app.post('/challenge', trust.challengeHandler());
   */
  challengeHandler() {
    return (req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const { nonce, requesterId } = JSON.parse(body);
          if (!nonce) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'nonce required' }));
          }
          this._log(`Challenge received from "${requesterId || 'unknown'}" — signing`);
          const signature = this.sign(nonce);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ signature, agentId: this.agentId }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    };
  }

  /**
   * Look up a registered agent's public profile.
   *
   * @param {string} agentId
   * @returns {Promise<{ agentId, manifest, reputation, registeredAt }>}
   */
  async lookup(agentId) {
    const res = await this._get(`/agent/${agentId}`);
    if (res.status === 200) return res.body;
    throw new Error(`Agent not found: ${agentId}`);
  }

  /**
   * Fetch the full agent list from the registry.
   *
   * @returns {Promise<{ count: number, agents: Array }>}
   */
  async listAgents() {
    const res = await this._get('/agents');
    if (res.status === 200) return res.body;
    throw new Error('Failed to list agents');
  }

  /**
   * Check the registry health and ledger integrity.
   *
   * @returns {Promise<{ status, ledger, uptime }>}
   */
  async health() {
    const res = await this._get('/health');
    return res.body;
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────────

  _post(path, body) {
    return this._httpReq(this.registryUrl, 'POST', path, body);
  }

  _get(path) {
    return this._httpReq(this.registryUrl, 'GET', path, null);
  }

  _httpReq(baseUrl, method, path, body) {
    return new Promise((resolve, reject) => {
      const url    = new URL(baseUrl + path);
      const lib    = url.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;

      const options = {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':   'trust-protocol/1.0.0',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };

      const req = lib.request(options, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  _assertRegistered() {
    if (!this._registered) {
      throw new Error('Call trust.register() before verifying peers');
    }
  }

  _log(msg) {
    console.log(`[trust-protocol] [${this.agentId}] ${msg}`);
  }
}

module.exports = { TrustProtocol };
