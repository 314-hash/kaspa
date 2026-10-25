# Extropian Janus — Operational Cost Breakdown ($1 Cash Budget)

**Project**: ExJanAI Blockchain (Extropian Janus)  
**Initial Capital Budget**: ~$1.00 USD  
**Posture**: Open-Source, Local-First, Zero Proprietary SaaS Dependencies  

---

## 1. Cost Allocation Table

| Operational Component | Selected Tool / Infrastructure | Monthly Cost (USD) | Source & Terms |
| :--- | :--- | :--- | :--- |
| **Execution Engine & Node** | Node.js v24 (Native ESM + SQLite + Crypto) | $0.00 | Open Source (MIT) |
| **State Storage & Indexing** | SQLite (`node:sqlite` WAL mode) | $0.00 | Public Domain |
| **Cryptographic Prover/Verifier** | Deterministic SMT & Trace Circuit (`proof.ts`) | $0.00 | Local Compute |
| **L1 Settlement Network** | Kaspa Testnet-10 / Testnet-11 (Toccata) | $0.00 | Free Public Testnet Faucets |
| **Kaspa Node RPC & REST** | `kaspa-rest-server` & Public wRPC Endpoints | $0.00 | Public Community Endpoints |
| **Continuous Integration (CI)** | GitHub Actions (Ubuntu-latest) | $0.00 | Free Tier (2,000 mins/month) |
| **Web Explorer & Dashboard** | Lightweight Vanilla HTML/CSS/JS (Served by node) | $0.00 | Self-hosted local or free VPS / Cloudflare Pages |
| **Domain / Testing Tunnel** | `localhost` or Cloudflare Tunnel (Free) | $0.00 | Free Tier |
| **Reserve Buffer** | Emergency testnet faucet donation or gas reserve | $1.00 | Cash in Reserve |
| **Total Monthly Spend** | | **$0.00 - $1.00** | **100% Within Budget** |

---

## 2. Compute and Memory Requirements

| Component | Minimum RAM | Recommended RAM | Storage | CPU Architecture |
| :--- | :--- | :--- | :--- | :--- |
| **ExJanAI Node & Web Explorer** | 512 MB | 1 GB | 200 MB SSD | x86_64 or ARM64 (Apple Silicon, Raspberry Pi 4) |
| **ChainCheck Diagnostic Worker** | 256 MB | 512 MB | 50 MB SSD | Any modern dual-core CPU |
| **Simulated Kaspa Node** | 128 MB | 256 MB | In-Memory | Single-core sufficient |
| **Full Kaspa Node (`rusty-kaspa`)** *(Optional for local L1)* | 8 GB | 16 GB | 100+ GB NVMe | 8+ Cores (high BlockDAG throughput) |
| **Full RISC Zero zkVM Prover** *(Optional heavyweight circuit)* | 16 GB | 32 GB + GPU | 50 GB | AVX-512 capable CPU or NVIDIA CUDA GPU |

> [!NOTE]
> Running full local proving of multi-million cycle RISC-V programs requires substantial hardware (16GB-32GB RAM). ExJanAI's architecture deliberately separates the lightweight deterministic execution engine from optional heavyweight prover hardware, allowing anyone on a standard laptop to run and verify the L2 state machine at zero cost.
