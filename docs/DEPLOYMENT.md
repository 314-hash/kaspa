# Extropian Janus — Deployment Guide & Network Environments

**Project**: ExJanAI Blockchain (Extropian Janus)  
**Layer**: Proposed Kaspa-Integrated Layer 2  

---

## 1. Network Environment Boundaries

Understanding the exact technical differences across deployment stages prevents false claims of production readiness:

```
+---------------------------------------------------------------------------------------+
|  STAGE 1: Local Prototype (CURRENT STATUS)                                           |
|  - Deterministic state transition engine running locally in SQLite.                  |
|  - Cryptographic trace commitment validation & Sparse Merkle Tree state roots.        |
|  - Settlement verified against simulated Kaspa BlockDAG with blue score finality.     |
|  - Zero financial risk; $0 cost; runs on standard developer workstations.             |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  STAGE 2: Public Testnet (Testnet-10 / Testnet-11 Toccata)                           |
|  - Settlement transactions broadcast to live Kaspa Testnet-10 / Testnet-11.           |
|  - Commitment payloads anchored with testnet sompis via public faucets.               |
|  - ChainCheck monitors public RPC endpoints and reliability indices.                 |
|  - Open developer participation with testnet keys.                                   |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  STAGE 3: Production Mainnet Deployment (FUTURE SPECIFICATION)                        |
|  - Mandatory Prerequisites:                                                           |
|    1. Consensus activation of KIP-16 (OpZkPrecompile) on Kaspa Mainnet.               |
|    2. Consensus activation of KIP-17 (Covenant Introspection) for trustless bridge.    |
|    3. Completed independent third-party security audits of rollup code.               |
|    4. Decentralized sequencer / multi-operator consensus or based rollup sequencing.  |
+---------------------------------------------------------------------------------------+
```

---

## 2. Deploying the Prototype as a Background Service

### Option A: Standard Node.js Process (Systemd or PM2)
```bash
# Production environment configuration
export PORT=3000
export NODE_ENV=production
export KASPA_RPC_URL="https://api-testnet-10.kaspa.org"

node src/server.ts
```

### Option B: Docker Compose (Optional Containerization)
For isolated containerized execution:
```yaml
version: '3.8'
services:
  exjanai-l2:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=3000
      - CHAIN_ID=1111
    restart: unless-stopped
```
