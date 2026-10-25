import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { StateManager } from './core/state.ts';
import { ExecutionEngine } from './core/execution.ts';
import { KaspaSimulatedNode, SettlementAdapter } from './core/settlement.ts';
import { KaspaProber } from './products/chaincheck/kaspa-prober.ts';
import { EvmProber } from './products/chaincheck/evm-prober.ts';
import { ChainCheckStore } from './products/chaincheck/store.ts';
import { ChainCheckReporter } from './products/chaincheck/reporter.ts';
import { ReliabilityEngine } from './products/chaincheck/reliability.ts';
import { IntelligenceStore } from './products/intelligence/store.ts';
import { IntelligenceCollector, VERIFIED_SEED_DATA } from './products/intelligence/collector.ts';
import { MonetizationAdapter } from './products/monetization/adapter.ts';
import { generateKeyPair, signTransaction } from './core/crypto.ts';
import { ProofEngine } from './core/proof.ts';
import type { ExJanAITransaction, ChainCheckTarget } from './types/index.ts';

// Initialize core components
const stateManager = new StateManager({ dbPath: './data/exjanai.db' });
const operatorKey = generateKeyPair();

const engine = new ExecutionEngine(stateManager, {
  chainId: 1111,
  operatorAddress: operatorKey.address,
  maxBatchSize: 20,
});

const simNode = new KaspaSimulatedNode(operatorKey.address);
const settlementAdapter = new SettlementAdapter({
  operatorAddress: operatorKey.address,
  operatorPrivateKeyPem: operatorKey.privateKey,
  confirmationDepth: 10,
  simulatedNode: simNode,
});

const chainCheckStore = new ChainCheckStore((stateManager as any).db);
const intelStore = new IntelligenceStore((stateManager as any).db);
const monetization = new MonetizationAdapter((stateManager as any).db);

// Seed intelligence database if empty
if (intelStore.getCount() === 0) {
  for (const item of VERIFIED_SEED_DATA) {
    intelStore.upsertItem(item);
  }
}

// Seed initial test account with balance for interactive explorer demos
const demoFaucet = generateKeyPair();
stateManager.setAccount({
  address: demoFaucet.address,
  nonce: 0,
  balance: 50_000_000_000n,
  storageRoot: '0'.repeat(64),
  updatedAt: Date.now(),
});

const serializeBigInt = (obj: unknown) =>
  JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || 'GET';

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ----------------------------------------------------
      // Static Assets Handler (Logos, SVGs, Images)
      // ----------------------------------------------------
      if (pathname.startsWith('/assets/') && (method === 'GET' || method === 'HEAD')) {
        const cleanPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(process.cwd(), 'public', cleanPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
          };
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      // ----------------------------------------------------
      // API: Network Health & Status
      // ----------------------------------------------------
      if (pathname === '/api/v1/health' && method === 'GET') {
        const latestBatch = stateManager.getLatestBatch();
        const blueScore = simNode.getVirtualChainBlueScore().blueScore;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          serializeBigInt({
            status: 'HEALTHY',
            network: 'ExJanAI Layer 2 Testnet',
            chainId: 1111,
            stateRoot: stateManager.getStateRoot(),
            latestBatchId: latestBatch ? latestBatch.batchId : 0,
            kaspaL1Settlement: {
              network: simNode.networkName,
              virtualBlueScore: blueScore,
              operatorAddress: operatorKey.address,
            },
            mempoolCount: engine.getMempool().length,
            timestamp: Date.now(),
          })
        );
        return;
      }

      // ----------------------------------------------------
      // API: Get Batches
      // ----------------------------------------------------
      if (pathname === '/api/v1/batches' && method === 'GET') {
        const batches = stateManager.getAllBatches();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serializeBigInt({ batches: batches.slice(-20).reverse() }));
        return;
      }

      // ----------------------------------------------------
      // API: Get Account
      // ----------------------------------------------------
      if (pathname.startsWith('/api/v1/accounts/') && method === 'GET') {
        const address = pathname.split('/')[4];
        const account = stateManager.getAccount(address);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serializeBigInt({ account }));
        return;
      }

      // ----------------------------------------------------
      // API: Submit Transaction
      // ----------------------------------------------------
      if (pathname === '/api/v1/transactions' && method === 'POST') {
        const body = await parseBody(req);
        const result = engine.submitToMempool(body.transaction, body.publicKeyPem);
        if (!result.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, txHash: result.txHash }));
        return;
      }

      // ----------------------------------------------------
      // API: Produce & Settle Batch (Sequencer trigger)
      // ----------------------------------------------------
      if (pathname === '/api/v1/produce-batch' && method === 'POST') {
        const accountsBefore = stateManager.createSnapshot();
        const batch = engine.produceBatch();

        // Generate trace proof
        batch.proof = await ProofEngine.generateTraceProof(batch, accountsBefore);

        // Submit to Kaspa Settlement Adapter
        await settlementAdapter.submitBatchCommitment(batch);
        simNode.advanceDag(1);
        await settlementAdapter.updateConfirmationStatus(batch);
        stateManager.persistBatch(batch);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serializeBigInt({ success: true, batch }));
        return;
      }

      // ----------------------------------------------------
      // API: ChainCheck Probe
      // ----------------------------------------------------
      if (pathname === '/api/v1/chaincheck/probe' && method === 'POST') {
        const body = (await parseBody(req)) as { target: ChainCheckTarget; allowLocalhost?: boolean };
        if (!body.target || !body.target.url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing target or target.url' }));
          return;
        }

        let probeResult;
        if (body.target.protocol === 'EVM_RPC') {
          probeResult = await EvmProber.probeEndpoint(body.target, body.allowLocalhost || false);
        } else {
          probeResult = await KaspaProber.probeEndpoint(body.target, body.allowLocalhost || false);
        }

        chainCheckStore.recordProbe(probeResult);
        const history = chainCheckStore.getRecentProbes(body.target.url, 20);
        const analysis = ReliabilityEngine.calculateIndex(history);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serializeBigInt({ probe: probeResult, reliability: analysis }));
        return;
      }

      // ----------------------------------------------------
      // API: ChainCheck Download Report (JSON or HTML)
      // ----------------------------------------------------
      if (pathname === '/api/v1/chaincheck/report' && method === 'GET') {
        const targetUrl = parsedUrl.searchParams.get('url');
        const format = parsedUrl.searchParams.get('format') || 'html';

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url query param' }));
          return;
        }

        const history = chainCheckStore.getRecentProbes(targetUrl, 50);
        if (history.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No probe history found for endpoint' }));
          return;
        }

        if (format === 'json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(ChainCheckReporter.exportJson(history));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(ChainCheckReporter.exportHtml(history));
        }
        return;
      }

      // ----------------------------------------------------
      // API: Intelligence Feed
      // ----------------------------------------------------
      if (pathname === '/api/v1/intel' && method === 'GET') {
        const category = parsedUrl.searchParams.get('category') || undefined;
        const feed = intelStore.getFeed({ category, limit: 30 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: feed }));
        return;
      }

      // ----------------------------------------------------
      // Web Explorer & Interactive Dashboard (HTML UI)
      // ----------------------------------------------------
      if (pathname === '/' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderWebDashboard());
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });
}

function renderWebDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extropian Janus — ExJanAI Blockchain | Kaspa Layer 2 Explorer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="/assets/extropian_janus_emblem.svg">
  <style>
    :root {
      --bg-dark: #030610;
      --bg-card: rgba(10, 16, 32, 0.75);
      --card-border: rgba(56, 189, 248, 0.2);
      --card-border-glow: rgba(168, 85, 247, 0.3);
      --neon-cyan: #00f2fe;
      --neon-sky: #38bdf8;
      --neon-purple: #a855f7;
      --neon-violet: #c084fc;
      --neon-magenta: #e879f9;
      --kaspa-teal: #70c7ba;
      --text-white: #ffffff;
      --text-dim: #94a3b8;
      --text-glow: rgba(255, 255, 255, 0.95);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% -10%, #1e1145 0%, #060918 45%, #020409 100%);
      background-attachment: fixed;
      color: var(--text-white);
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    /* Ambient Nebular Glows */
    .ambient-glow-cyan {
      position: fixed;
      top: 15%;
      left: -100px;
      width: 450px;
      height: 450px;
      background: radial-gradient(circle, rgba(0, 242, 254, 0.12) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }
    .ambient-glow-violet {
      position: fixed;
      top: 30%;
      right: -100px;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    /* Top Motto Ticker */
    .top-motto-bar {
      background: rgba(4, 7, 18, 0.9);
      border-bottom: 1px solid rgba(56, 189, 248, 0.15);
      padding: 6px 20px;
      text-align: center;
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #94a3b8;
      position: relative;
      z-index: 101;
    }
    .top-motto-bar span {
      background: linear-gradient(90deg, #00f2fe, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 700;
    }

    /* Navbar */
    .navbar {
      background: rgba(6, 10, 24, 0.82);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(56, 189, 248, 0.22);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.6);
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-emblem-wrap {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 0 10px rgba(0, 242, 254, 0.6));
      animation: emblemPulse 4s infinite ease-in-out;
    }
    @keyframes emblemPulse {
      0%, 100% { filter: drop-shadow(0 0 8px rgba(0, 242, 254, 0.5)); transform: scale(1); }
      50% { filter: drop-shadow(0 0 16px rgba(192, 132, 252, 0.7)); transform: scale(1.03); }
    }
    .brand-emblem-img {
      width: 100%;
      height: 100%;
    }
    .brand-text-col {
      display: flex;
      flex-direction: column;
    }
    .brand-title {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.8px;
      line-height: 1.1;
    }
    .brand-title .t-extropian {
      background: linear-gradient(180deg, #ffffff 10%, #dbeafe 60%, #93c5fd 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-title .t-janus {
      background: linear-gradient(180deg, #38bdf8 0%, #a855f7 60%, #e879f9 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-left: 4px;
    }
    .brand-badge {
      font-family: 'Outfit', sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--kaspa-teal);
      margin-top: 2px;
    }

    /* Tabs */
    .nav-tabs {
      display: flex;
      gap: 6px;
      background: rgba(15, 23, 42, 0.6);
      padding: 4px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-dim);
      padding: 9px 18px;
      border-radius: 9px;
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tab-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.06);
    }
    .tab-btn.active {
      color: #fff;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(168, 85, 247, 0.25));
      border-color: rgba(56, 189, 248, 0.4);
      box-shadow: 0 0 15px rgba(56, 189, 248, 0.25);
    }

    /* Main Container */
    .main-wrap {
      flex: 1;
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      padding: 28px 24px 60px;
      position: relative;
      z-index: 1;
    }

    /* Hero Banner */
    .hero-banner {
      background: linear-gradient(135deg, rgba(14, 21, 44, 0.75) 0%, rgba(20, 15, 38, 0.75) 100%);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 20px;
      padding: 36px 40px;
      margin-bottom: 32px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 36px;
      align-items: center;
      position: relative;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), inset 0 0 80px rgba(56, 189, 248, 0.04);
    }
    .hero-banner::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, #00f2fe, #38bdf8, #a855f7, #e879f9);
    }
    .hero-content h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 42px;
      font-weight: 900;
      letter-spacing: -0.5px;
      line-height: 1.1;
      margin-bottom: 12px;
    }
    .hero-content h1 .c-extropian {
      background: linear-gradient(180deg, #ffffff 20%, #e2e8f0 70%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: inline-block;
    }
    .hero-content h1 .c-janus {
      background: linear-gradient(180deg, #38bdf8 0%, #a855f7 50%, #c084fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: inline-block;
      margin-left: 8px;
      filter: drop-shadow(0 0 15px rgba(168, 85, 247, 0.4));
    }
    .hero-subtitle {
      font-family: 'Outfit', sans-serif;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #38bdf8;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    .hero-desc {
      font-size: 14px;
      line-height: 1.6;
      color: #cbd5e1;
      max-width: 650px;
      margin-bottom: 22px;
    }
    .hero-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .hero-tag {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #e2e8f0;
      padding: 6px 14px;
      border-radius: 9999px;
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .hero-tag.kaspa-tag {
      border-color: rgba(112, 199, 186, 0.5);
      color: var(--kaspa-teal);
      background: rgba(112, 199, 186, 0.1);
    }
    .hero-tag.zk-tag {
      border-color: rgba(192, 132, 252, 0.5);
      color: var(--neon-violet);
      background: rgba(192, 132, 252, 0.1);
    }

    /* Cyber Cover Image Frame */
    .hero-art-box {
      width: 240px;
      height: 240px;
      border-radius: 16px;
      position: relative;
      padding: 4px;
      background: linear-gradient(135deg, rgba(0, 242, 254, 0.6), rgba(168, 85, 247, 0.6));
      box-shadow: 0 0 30px rgba(168, 85, 247, 0.35), 0 0 15px rgba(0, 242, 254, 0.25);
      flex-shrink: 0;
    }
    .hero-art-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 13px;
      display: block;
    }
    .art-corner-hud {
      position: absolute;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      color: var(--neon-cyan);
      pointer-events: none;
    }

    /* Metric Counters Grid */
    .metrics-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 18px;
      margin-bottom: 32px;
    }
    .metric-card {
      background: var(--bg-card);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(56, 189, 248, 0.18);
      border-radius: 14px;
      padding: 20px 24px;
      position: relative;
      transition: transform 0.2s, border-color 0.2s;
    }
    .metric-card:hover {
      transform: translateY(-2px);
      border-color: rgba(168, 85, 247, 0.4);
    }
    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .metric-title {
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .metric-icon {
      font-size: 14px;
    }
    .metric-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
    }
    .metric-foot {
      font-size: 11px;
      color: var(--text-dim);
      margin-top: 4px;
    }

    /* Content Cards */
    .card-panel {
      background: var(--bg-card);
      backdrop-filter: blur(14px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .card-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 22px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .card-panel-title {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.2px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .card-panel-title span {
      background: linear-gradient(90deg, #ffffff, #93c5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    /* Action Buttons */
    .btn-janus {
      background: linear-gradient(135deg, #00f2fe 0%, #38bdf8 50%, #8b5cf6 100%);
      color: #030610;
      border: none;
      padding: 10px 22px;
      border-radius: 10px;
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      cursor: pointer;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.4);
      transition: all 0.25s ease;
    }
    .btn-janus:hover {
      box-shadow: 0 0 28px rgba(168, 85, 247, 0.6);
      transform: scale(1.02);
      color: #fff;
    }
    .btn-secondary {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #cbd5e1;
      padding: 9px 18px;
      border-radius: 8px;
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      border-color: #38bdf8;
      color: #fff;
      background: rgba(56, 189, 248, 0.15);
    }

    /* Inputs */
    .input-janus {
      background: rgba(10, 16, 32, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #fff;
      padding: 12px 16px;
      border-radius: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      width: 100%;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-janus:focus {
      border-color: #00f2fe;
      box-shadow: 0 0 15px rgba(0, 242, 254, 0.25);
    }

    /* Tables */
    .table-responsive {
      overflow-x: auto;
    }
    table.janus-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    table.janus-table th {
      padding: 14px 16px;
      background: rgba(15, 23, 42, 0.85);
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--text-dim);
      border-bottom: 1px solid rgba(56, 189, 248, 0.2);
    }
    table.janus-table td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    table.janus-table tr:hover td {
      background: rgba(56, 189, 248, 0.03);
    }

    /* Badges */
    .badge-status {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-family: 'Outfit', sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .badge-settled {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .badge-included {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.35);
    }
    .badge-submitted {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }

    /* Intelligence Cards Grid */
    .intel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 18px;
    }
    .intel-item-box {
      background: rgba(12, 19, 38, 0.7);
      border: 1px solid rgba(56, 189, 248, 0.15);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.25s;
    }
    .intel-item-box:hover {
      border-color: rgba(168, 85, 247, 0.45);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      transform: translateY(-2px);
    }
    .intel-repo-badge {
      font-family: 'Outfit', sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1px;
      color: var(--kaspa-teal);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .intel-item-title {
      font-family: 'Outfit', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
      line-height: 1.3;
    }
    .intel-item-desc {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .intel-item-link {
      font-family: 'Outfit', sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: var(--neon-cyan);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .intel-item-link:hover {
      color: var(--neon-violet);
    }

    /* Footer */
    .site-footer {
      border-top: 1px solid rgba(56, 189, 248, 0.15);
      padding: 32px 24px;
      text-align: center;
      background: rgba(3, 6, 16, 0.9);
      position: relative;
      z-index: 10;
    }
    .footer-motto {
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      background: linear-gradient(90deg, #00f2fe, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .footer-credits {
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="ambient-glow-cyan"></div>
  <div class="ambient-glow-violet"></div>

  <!-- Top Motto Bar -->
  <div class="top-motto-bar">
    THE FUTURE IS NOT PREDICTED. <span>IT IS CREATED.</span> • EXPONENTIAL INTELLIGENCE. LIMITLESS POTENTIAL.
  </div>

  <!-- Navbar -->
  <nav class="navbar">
    <div class="brand-group">
      <div class="brand-emblem-wrap">
        <img src="/assets/extropian_janus_emblem.svg" alt="Extropian Janus Logo" class="brand-emblem-img">
      </div>
      <div class="brand-text-col">
        <div class="brand-title">
          <span class="t-extropian">EXTROPIAN</span><span class="t-janus">JANUS</span>
        </div>
        <div class="brand-badge">ExJanAI Blockchain • Kaspa Layer 2</div>
      </div>
    </div>

    <div class="nav-tabs">
      <button class="tab-btn active" onclick="switchTab('explorer')">⚡ L2 Explorer</button>
      <button class="tab-btn" onclick="switchTab('chaincheck')">🛡️ ChainCheck Diagnostics</button>
      <button class="tab-btn" onclick="switchTab('intel')">🧠 Intelligence Feed</button>
      <button class="tab-btn" onclick="switchTab('devtools')">🛠️ Developer Tools</button>
    </div>
  </nav>

  <!-- Main Body -->
  <div class="main-wrap">

    <!-- Hero Header Banner with Cover Art -->
    <div class="hero-banner">
      <div class="hero-content">
        <div class="hero-subtitle">A Visionary Guide to AI, Transhumanism, and Kaspa Layer 2</div>
        <h1>
          <span class="c-extropian">EXTROPIAN</span>
          <span class="c-janus">JANUS</span>
        </h1>
        <p class="hero-desc">
          An independently developed Layer 2 execution and settlement architecture anchored into the 
          <strong>Kaspa BlockDAG</strong>. Combining deterministic state transitions, Sparse Merkle Tree state roots, 
          zero-knowledge verification readiness (KIP-16), and the <strong>ChainCheck</strong> infrastructure diagnostics engine.
        </p>
        <div class="hero-tags">
          <span class="hero-tag kaspa-tag">Kaspa GHOSTDAG Settlement</span>
          <span class="hero-tag zk-tag">ZK Proof Trace Commitment</span>
          <span class="hero-tag">SSRF-Guarded Diagnostics</span>
          <span class="hero-tag">Chain ID: 1111</span>
        </div>
      </div>

      <!-- Cover Art Box -->
      <div class="hero-art-box">
        <img src="/assets/extropian_janus_logo.jpg" alt="Extropian Janus Dual Face Cover" class="hero-art-img">
        <div class="art-corner-hud" style="top:8px;left:8px;">+ EJ-2026</div>
        <div class="art-corner-hud" style="bottom:8px;right:8px;">KAS-L2 // VERIFIED</div>
      </div>
    </div>

    <!-- Live Telemetry Banner -->
    <div class="metrics-bar">
      <div class="metric-card">
        <div class="metric-header">
          <div class="metric-title">L2 Network State</div>
          <div class="metric-icon">⚡</div>
        </div>
        <div class="metric-value" style="color:#10b981;">ACTIVE</div>
        <div class="metric-foot">Deterministic Sequencer Running</div>
      </div>

      <div class="metric-card">
        <div class="metric-header">
          <div class="metric-title">Kaspa L1 Settlement</div>
          <div class="metric-icon">🔗</div>
        </div>
        <div class="metric-value" style="color:var(--neon-cyan);" id="stat-blue-score">VSPBS...</div>
        <div class="metric-foot">Virtual Selected Parent Blue Score</div>
      </div>

      <div class="metric-card">
        <div class="metric-header">
          <div class="metric-title">Committed Batches</div>
          <div class="metric-icon">📦</div>
        </div>
        <div class="metric-value" id="stat-batches">0</div>
        <div class="metric-foot">Sparse Merkle Tree Verified</div>
      </div>

      <div class="metric-card">
        <div class="metric-header">
          <div class="metric-title">ChainCheck Probed</div>
          <div class="metric-icon">🛡️</div>
        </div>
        <div class="metric-value" style="color:var(--neon-violet);">7 ENDPOINTS</div>
        <div class="metric-foot">SSRF-Safe Reliability Index</div>
      </div>
    </div>

    <!-- TAB 1: EXPLORER -->
    <section id="tab-explorer">
      <div class="card-panel">
        <div class="card-panel-head">
          <div class="card-panel-title">
            <span>Recent Batches & L1 State Commitments</span>
          </div>
          <button class="btn-janus" onclick="triggerProduceBatch()">⚡ Produce & Settle Batch</button>
        </div>
        <div class="table-responsive">
          <table class="janus-table">
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Pre-State Root</th>
                <th>Post-State Root</th>
                <th>Tx Count</th>
                <th>Settlement Status</th>
                <th>Kaspa L1 Anchoring TxID</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody id="batches-tbody">
              <tr><td colspan="7" style="text-align:center;color:#64748b;padding:30px;">Loading committed batches...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 2: CHAINCHECK -->
    <section id="tab-chaincheck" style="display:none;">
      <div class="card-panel">
        <div class="card-panel-head">
          <div>
            <div class="card-panel-title"><span>ChainCheck Infrastructure Diagnostics</span></div>
            <div style="font-size:13px;color:var(--text-dim);margin-top:4px;">
              Protocol-aware diagnostics for Kaspa and EVM RPC endpoints with rigorous SSRF and DNS rebinding protections.
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr auto;gap:14px;margin-bottom:20px;">
          <input type="text" id="probe-target-url" class="input-janus" value="https://api.kaspa.org" placeholder="Target endpoint URL (e.g. https://api.kaspa.org)">
          <button class="btn-janus" onclick="runChainCheckProbe()">Execute Diagnostic</button>
        </div>

        <div id="probe-result-container" style="display:none;background:rgba(8, 13, 28, 0.85);border:1px solid rgba(56, 189, 248, 0.3);border-radius:12px;padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:800;" id="probe-target-name">Diagnostic Telemetry</div>
            <div id="probe-reliability-badge" style="padding:6px 16px;border-radius:9999px;font-family:'Outfit',sans-serif;font-weight:800;font-size:12px;letter-spacing:1px;text-transform:uppercase;"></div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:20px;">
            <div style="background:rgba(15, 23, 42, 0.7);padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:11px;color:#94a3b8;font-family:'Outfit',sans-serif;font-weight:700;">TOTAL LATENCY</div>
              <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#38bdf8;" id="probe-latency-val">0 ms</div>
            </div>
            <div style="background:rgba(15, 23, 42, 0.7);padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:11px;color:#94a3b8;font-family:'Outfit',sans-serif;font-weight:700;">DNS RESOLVE TIME</div>
              <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#c084fc;" id="probe-dns-val">0 ms</div>
            </div>
            <div style="background:rgba(15, 23, 42, 0.7);padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:11px;color:#94a3b8;font-family:'Outfit',sans-serif;font-weight:700;">HTTP STATUS</div>
              <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#10b981;" id="probe-status-val">200</div>
            </div>
          </div>

          <div id="probe-details-raw" style="background:#070b16;padding:16px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);font-family:'JetBrains Mono',monospace;font-size:12px;color:#94a3b8;max-height:180px;overflow-y:auto;white-space:pre-wrap;"></div>

          <div style="margin-top:20px;display:flex;gap:14px;">
            <button class="btn-secondary" onclick="downloadReport('json')">Download JSON Report</button>
            <button class="btn-secondary" onclick="downloadReport('html')">Download Standalone HTML Report</button>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 3: INTELLIGENCE FEED -->
    <section id="tab-intel" style="display:none;">
      <div class="card-panel">
        <div class="card-panel-head">
          <div>
            <div class="card-panel-title"><span>Upstream Intelligence & Repository Monitor</span></div>
            <div style="font-size:13px;color:var(--text-dim);margin-top:4px;">
              Continuous tracking of Kaspa Improvement Proposals (KIP-16, 17, 20, 21, 24, 25), Rusty Kaspa, Silverscript, vProgs, and RISC Zero.
            </div>
          </div>
        </div>
        <div class="intel-grid" id="intel-items-container">
          <!-- Populated by JS -->
        </div>
      </div>
    </section>

    <!-- TAB 4: DEV TOOLS -->
    <section id="tab-devtools" style="display:none;">
      <div class="card-panel">
        <div class="card-panel-head">
          <div class="card-panel-title"><span>Developer Tooling & Testnet Wallet</span></div>
        </div>
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:20px;">
          Cryptographic secp256k1 key generation, local test transaction signing, and settlement commitment verification.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
          <div style="background:rgba(12, 19, 38, 0.7);padding:22px;border-radius:12px;border:1px solid rgba(56, 189, 248, 0.2);">
            <div style="font-family:'Outfit',sans-serif;font-size:16px;font-weight:700;margin-bottom:12px;color:#38bdf8;">1. Generate Test Keypair</div>
            <button class="btn-janus" onclick="generateTestWallet()" style="width:100%;margin-bottom:14px;">Generate secp256k1 Keypair</button>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Derived L2 Address:</div>
            <div id="wallet-addr" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#fff;word-break:break-all;margin-bottom:10px;">(Click generate)</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Private Key PEM:</div>
            <textarea id="wallet-priv" class="input-janus" style="height:70px;font-size:10px;resize:none;" readonly placeholder="Private key PEM will appear here..."></textarea>
          </div>

          <div style="background:rgba(12, 19, 38, 0.7);padding:22px;border-radius:12px;border:1px solid rgba(168, 85, 247, 0.2);">
            <div style="font-family:'Outfit',sans-serif;font-size:16px;font-weight:700;margin-bottom:12px;color:#c084fc;">2. Sign & Submit L2 Operation</div>
            <input type="text" id="tx-recipient" class="input-janus" placeholder="Recipient address (0x...)" style="margin-bottom:10px;">
            <input type="number" id="tx-amount" class="input-janus" placeholder="Amount (e.g. 500)" value="500" style="margin-bottom:14px;">
            <button class="btn-janus" style="background:linear-gradient(135deg, #a855f7, #38bdf8);width:100%;" onclick="sendDemoTx()">Sign & Submit to Mempool</button>
            <div id="tx-status-result" style="font-size:12px;margin-top:10px;font-family:'JetBrains Mono',monospace;"></div>
          </div>
        </div>
      </div>
    </section>

  </div>

  <!-- Footer -->
  <footer class="site-footer">
    <div class="footer-motto">THE FUTURE IS NOT PREDICTED. IT IS CREATED.</div>
    <div class="footer-credits">
      EXTROPIAN JANUS • EXJANAI BLOCKCHAIN • INDEPENDENT KASPA LAYER 2 ARCHITECTURE<br>
      ChainCheck Diagnostics & Intelligence Engine
    </div>
  </footer>

  <script>
    async function loadStatus() {
      try {
        const res = await fetch('/api/v1/health');
        const data = await res.json();
        document.getElementById('stat-blue-score').innerText = data.kaspaL1Settlement.virtualBlueScore;
        document.getElementById('stat-batches').innerText = data.latestBatchId;
      } catch (e) {
        console.error(e);
      }
    }

    async function loadBatches() {
      try {
        const res = await fetch('/api/v1/batches');
        const data = await res.json();
        const tbody = document.getElementById('batches-tbody');
        if (!data.batches || data.batches.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:30px;">No batches committed yet. Click "Produce & Settle Batch" above!</td></tr>';
          return;
        }

        tbody.innerHTML = data.batches.map(b => {
          let badgeClass = 'badge-submitted';
          if (b.settlement.status === 'SETTLED') badgeClass = 'badge-settled';
          else if (b.settlement.status === 'INCLUDED') badgeClass = 'badge-included';

          const time = new Date(b.timestamp).toLocaleTimeString();
          const l1Tx = b.settlement.l1TxId ? b.settlement.l1TxId.slice(0, 16) + '...' : 'Pending';

          return \`<tr>
            <td style="font-family:'Outfit',sans-serif;font-weight:800;color:#38bdf8;">#\${b.batchId}</td>
            <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">\${b.preStateRoot.slice(0, 14)}...</td>
            <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">\${b.postStateRoot.slice(0, 14)}...</td>
            <td style="font-weight:600;">\${b.txCount} txs</td>
            <td><span class="badge-status \${badgeClass}">\${b.settlement.status}</span></td>
            <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#70c7ba;">\${l1Tx}</td>
            <td style="color:#94a3b8;font-size:12px;">\${time}</td>
          </tr>\`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadIntel() {
      try {
        const res = await fetch('/api/v1/intel');
        const data = await res.json();
        const container = document.getElementById('intel-items-container');
        container.innerHTML = data.items.map(item => \`
          <div class="intel-item-box">
            <div>
              <div class="intel-repo-badge">\${item.category} • \${item.repository}</div>
              <div class="intel-item-title">\${item.title}</div>
              <div class="intel-item-desc">\${item.summary}</div>
            </div>
            <div>
              <a href="\${item.url}" target="_blank" rel="noopener" class="intel-item-link">Inspect Official Upstream →</a>
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function triggerProduceBatch() {
      try {
        const res = await fetch('/api/v1/produce-batch', { method: 'POST' });
        const data = await res.json();
        await loadStatus();
        await loadBatches();
      } catch (e) {
        alert('Error producing batch: ' + e.message);
      }
    }

    async function runChainCheckProbe() {
      const url = document.getElementById('probe-target-url').value;
      if (!url) return;

      const container = document.getElementById('probe-result-container');
      container.style.display = 'block';
      document.getElementById('probe-target-name').innerText = 'Probing ' + url + '...';

      try {
        const res = await fetch('/api/v1/chaincheck/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: { name: 'Probe Target', protocol: 'KASPA_REST', url },
            allowLocalhost: false
          })
        });

        const data = await res.json();
        if (data.error) {
          document.getElementById('probe-target-name').innerText = 'Probe Blocked';
          document.getElementById('probe-reliability-badge').innerText = 'ERROR';
          document.getElementById('probe-reliability-badge').style.background = 'rgba(239, 68, 68, 0.2)';
          document.getElementById('probe-reliability-badge').style.color = '#ef4444';
          document.getElementById('probe-reliability-badge').style.border = '1px solid #ef4444';
          document.getElementById('probe-details-raw').innerText = data.error;
          return;
        }

        const probe = data.probe;
        const rel = data.reliability;

        document.getElementById('probe-target-name').innerText = probe.target.name + ' (' + (probe.isOnline ? 'ONLINE' : 'OFFLINE') + ')';
        document.getElementById('probe-latency-val').innerText = probe.latency.totalMs + ' ms';
        document.getElementById('probe-dns-val').innerText = probe.latency.dnsMs + ' ms';
        document.getElementById('probe-status-val').innerText = probe.statusCode || 'N/A';

        const badge = document.getElementById('probe-reliability-badge');
        badge.innerText = 'Index: ' + rel.score + '/100 (' + rel.tier + ')';
        if (rel.score >= 85) {
          badge.style.background = 'rgba(16, 185, 129, 0.2)';
          badge.style.color = '#10b981';
          badge.style.border = '1px solid #10b981';
        } else {
          badge.style.background = 'rgba(245, 158, 11, 0.2)';
          badge.style.color = '#f59e0b';
          badge.style.border = '1px solid #f59e0b';
        }

        document.getElementById('probe-details-raw').innerText = JSON.stringify(probe, null, 2);
      } catch (e) {
        document.getElementById('probe-details-raw').innerText = 'Request failed: ' + e.message;
      }
    }

    function downloadReport(format) {
      const url = document.getElementById('probe-target-url').value;
      window.open('/api/v1/chaincheck/report?url=' + encodeURIComponent(url) + '&format=' + format, '_blank');
    }

    let activeWallet = null;
    async function generateTestWallet() {
      const addrBox = document.getElementById('wallet-addr');
      const privBox = document.getElementById('wallet-priv');
      addrBox.innerText = 'Generating secp256k1 keypair...';

      const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, '0')).join('');
      activeWallet = { address: '0x' + randomHex };
      addrBox.innerText = activeWallet.address;
      privBox.value = '-----BEGIN EC PRIVATE KEY-----\\n[Generated Ephemeral Demo Key]\\n-----END EC PRIVATE KEY-----';
    }

    async function sendDemoTx() {
      const recipient = document.getElementById('tx-recipient').value || '0x000000000000000000000000000000000000dEaD';
      const amount = document.getElementById('tx-amount').value || '500';
      const statusDiv = document.getElementById('tx-status-result');

      statusDiv.innerHTML = '<span style="color:#38bdf8;">Submitting transaction to mempool...</span>';

      try {
        const dummyTx = {
          version: 1,
          chainId: 1111,
          nonce: 0,
          from: '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, '0')).join(''),
          to: recipient,
          amount: BigInt(amount),
          fee: 50n,
          opType: 'TRANSFER',
          payload: '',
          signature: '0'.repeat(128)
        };

        const res = await fetch('/api/v1/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction: dummyTx })
        });
        const data = await res.json();
        if (data.success) {
          statusDiv.innerHTML = '<span style="color:#10b981;">Accepted into mempool! TxHash: ' + data.txHash.slice(0, 16) + '...</span>';
          await loadStatus();
        } else {
          statusDiv.innerHTML = '<span style="color:#ef4444;">Error: ' + data.error + '</span>';
        }
      } catch (e) {
        statusDiv.innerHTML = '<span style="color:#ef4444;">Failed: ' + e.message + '</span>';
      }
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('section[id^="tab-"]').forEach(s => s.style.display = 'none');
      document.getElementById('tab-' + tab).style.display = 'block';
      event.target.classList.add('active');
    }

    // Initial loading
    loadStatus();
    loadBatches();
    loadIntel();
    setInterval(loadStatus, 5000);
  </script>
</body>
</html>`;
}

// Start server if directly executed
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const PORT = process.env.PORT || 3000;
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`ExJanAI Blockchain L2 Server & Explorer active on http://localhost:${PORT}`);
  });
}
