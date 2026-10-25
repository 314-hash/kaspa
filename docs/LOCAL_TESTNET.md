# Extropian Janus — Local Testnet Setup Guide

**Project**: ExJanAI Blockchain (Extropian Janus)  
**Layer**: Proposed Kaspa-Integrated Layer 2  
**Theme**: Cyber-Classical Extropian Janus  

---

## 1. Quick Start (Zero Cost & Zero External Dependencies)

ExJanAI Blockchain runs locally using Node.js v22+ or v24+ with built-in SQLite and native cryptography. No external paid infrastructure, Docker containers, or third-party APIs are required for local testing.

### Prerequisites
- Node.js `v22.0.0` or higher (verified on Node `v24.21.0`).
- Git.

### Clone and Launch
```bash
git clone https://github.com/exjanai/exjanai-blockchain.git
cd exjanai-blockchain

# Launch the L2 Node, API, and Extropian Janus Explorer Dashboard
npm start
```
The server will start on `http://localhost:3000`.

---

## 2. Running the End-to-End Prototype Demo

To execute the complete 10-step verification pipeline (transaction creation, mempool admission, deterministic state transition, SMT root calculation, trace proof generation, Kaspa BlockDAG anchoring, DAG advance, reorg resilience, and restart persistence):

```bash
npm run prototype:demo
```

---

## 3. Running the Developer CLI (`exjanai`)

The developer CLI provides instant utilities for key management, state inspection, and manual batch production.

```bash
# 1. Generate a new secp256k1 keypair
npm run cli keygen

# 2. Inspect node status, current state root, and Kaspa blue score
npm run cli status

# 3. Produce and settle an L2 batch onto the Kaspa simulator
npm run cli produce-batch

# 4. Check an account balance and nonce
npm run cli account <address>
```

---

## 4. Running ChainCheck Diagnostics CLI

Run protocol-aware diagnostics on any public Kaspa or EVM RPC endpoint with strict SSRF protection:

```bash
# Probe default Kaspa public REST endpoint
npm run chaincheck

# Probe custom Kaspa testnet endpoint and export standalone HTML report
node src/cli/chaincheck-cli.ts https://api-testnet-10.kaspa.org --html

# Probe EVM endpoint
node src/cli/chaincheck-cli.ts https://rpc.ankr.com/eth --evm
```

---

## 5. Running the Intelligence Monitor CLI

Inspect upstream releases and Kaspa Improvement Proposals:

```bash
npm run intel
# or filter by KIPs only:
node src/cli/intel-cli.ts KIP
```

---

## 6. Running the Automated Test Suite

```bash
npm test
```
Runs all 23 unit and integration tests across deterministic execution, Kaspa settlement, proof boundaries, SSRF security, and repository monitoring.
