# ExJanAI Blockchain — Research Report

**Project**: ExJanAI Blockchain  
**Layer**: Proposed Kaspa-Integrated Layer 2  
**Date**: October 2026  
**Status**: Pre-Alpha / Development & Testnet Prototype  
**Author**: ExJanAI Core Engineering  

---

## 1. Executive Summary

ExJanAI Blockchain is an independently developed Layer 2 execution and settlement architecture designed to interface with the Kaspa BlockDAG network. The initial capital budget is strictly constrained (~$1 USD), mandating an engineering posture centered around local determinism, open-source cryptographic building blocks, zero-cost development tooling, and lightweight operational footprints.

This document compiles technical research conducted across twelve upstream repositories, protocol specifications, Kaspa Improvement Proposals (KIPs), zero-knowledge proving systems, and monitoring architectures. It critically assesses the feasibility of layer 2 paradigms under current Kaspa mainnet constraints versus the forthcoming Toccata consensus upgrade.

---

## 2. Upstream Repository Inspections

### 2.1 kaspanet/rusty-kaspa
- **Repository URL**: [https://github.com/kaspanet/rusty-kaspa](https://github.com/kaspanet/rusty-kaspa)
- **Project Purpose**: The official high-performance reference implementation of the Kaspa full node, consensus engine (GHOSTDAG / KnightDAG), CLI wallet, and RPC subsystems written in Rust.
- **License**: MIT / Apache-2.0 dual license.
- **Version & Compatibility**: Stable series v0.14.x / v0.15.x on Mainnet and Testnet-10; v1.0.x / Toccata branch on Testnet-11.
- **Reusable Components**:
  - `kaspa-rpc-core` & `kaspa-wrpc-client`: Protocol definitions for wRPC (WebSocket RPC using binary Borsh or JSON encoding).
  - Transaction serialization and mass calculation logic.
  - Subnetwork ID mechanisms (`SUBNETWORK_ID_NATIVE` vs custom payloads).
  - Public RPC surface: `getInfo`, `getBlockDagInfo`, `getVirtualChainBlueScore`, `getFeeEstimate`, `submitTransaction`.
- **Maturity & Maintenance**: Production-grade, active development by the core Kaspa team. Extremely high throughput (1 to 10 blocks per second).
- **Security Considerations**: High block rate means transaction reorganization depth is evaluated differently than sequential single-chain models; finality must track Virtual Selected Parent Blue Score (VSPBS) confirmation depth rather than simple block confirmations.
- **Proposed Integration in ExJanAI**: Primary L1 target for settlement transaction broadcast, UTXO tracking, fee estimation, and blue score confirmation tracking.
- **Rejected Alternatives**: Relying strictly on third-party centralized indexers without direct node connectivity.

---

### 2.2 kaspanet/kips
- **Repository URL**: [https://github.com/kaspanet/kips](https://github.com/kaspanet/kips)
- **Project Purpose**: Kaspa Improvement Proposals specifying architectural consensus upgrades, transaction format updates, covenant designs, and ZK capabilities.
- **License**: MIT / CC0.
- **Version & Compatibility**: Active RFCs for the Toccata hard fork and post-Toccata evolutions.
- **Key KIP Specifications Evaluated**:
  - **KIP-16 (ZK Precompile Opcode / `OpZkPrecompile`)**: Specifies native verification of zero-knowledge proofs (such as Groth16 over BN254) inside Kaspa's script engine. Allows on-chain settlement validation of rollups without trusted bridge multi-sigs.
  - **KIP-17 (Covenant Capabilities & Introspection)**: Introduces introspection opcodes (`OP_INSPECTOUTPUT`, `OP_INSPECTINPUT`) enabling stateful script continuity where spending outputs must satisfy constraints dictated by current script preimages.
  - **KIP-20 (Covenant Identifiers)**: Establishes standardized stable IDs for stateful covenant lineages across multiple chained spends without breaking deterministic UTXO validation.
  - **KIP-21 (Partitioned Sequencing Commitment with O(activity) Proving / User Lanes)**: Defines specialized transaction sequencing lanes and partitioned commitments to scale off-chain state transitions without congesting the base DAG consensus.
  - **KIP-24 (Transaction Version 1: New Fields & Hashing)**: Expands transaction header fields and implements modernized cryptographic hashing schemes for covenants.
  - **KIP-25 (Compute Budget & Script Pricing)**: Implements dynamic resource metering to cap script execution complexity and prevent script-based denial-of-service.
- **Maturity**: In active specification and testnet rollout (Toccata). Not yet activated on Kaspa mainnet.
- **Security Considerations**: Until KIP-16 and KIP-17 reach mainnet consensus activation, an L2 cannot enforce on-chain ZK verification purely through L1 script execution without operator settlement transactions.
- **Proposed Integration in ExJanAI**: Design ExJanAI’s batch commitment structure and settlement interface to be directly compatible with KIP-16 and KIP-21 interfaces, while executing verifiable batch settlement today via Kaspa testnet transaction payloads.

---

### 2.3 kaspanet/silverscript
- **Repository URL**: [https://github.com/kaspanet/silverscript](https://github.com/kaspanet/silverscript)
- **Project Purpose**: High-level, CashScript-inspired covenant language and compiler (`silverc`) targeting the Kaspa Script VM.
- **License**: MIT / Apache-2.0.
- **Version & Compatibility**: Alpha / Pre-release compiler targeting the Toccata opcode set.
- **Reusable Components**: Contract specification patterns for UTXO state-passing covenants, contract verification test harnesses.
- **Maturity & Maintenance**: Actively developed by ecosystem contributors; experimental.
- **Security Considerations**: The UTXO paradigm differs fundamentally from EVM state. State lives in output script preimages, not global contract storage. Every covenant state transition requires an explicit transaction consuming the prior UTXO and producing a successor UTXO.
- **Proposed Integration in ExJanAI**: Reference target for Phase 2/3 testnet covenant experiments (modeling the settlement bridge as a stateful Silverscript covenant).

---

### 2.4 kaspanet/vprogs
- **Repository URL**: [https://github.com/kaspanet/vprogs](https://github.com/kaspanet/vprogs)
- **Project Purpose**: Verifiable Programs architectural framework for Kaspa, defining modular, resource-bounded provable computation over Kaspa's covenant and ZK stack.
- **License**: MIT / Apache-2.0.
- **Version & Compatibility**: Experimental research / architectural specification.
- **Reusable Components**: Layered execution separation models (consensus scheduling layer vs off-chain deterministic execution runtimes).
- **Maturity & Maintenance**: Early research / yellow paper stage.
- **Proposed Integration in ExJanAI**: Architectural alignment with vProgs execution interface standards so ExJanAI batch execution runtimes can plug into vProgs schedulers in future network iterations.

---

### 2.5 risc0/risc0
- **Repository URL**: [https://github.com/risc0/risc0](https://github.com/risc0/risc0)
- **Project Purpose**: General-purpose RISC-V zero-knowledge virtual machine (zkVM) and cryptographic proving system.
- **License**: Apache-2.0.
- **Version & Compatibility**: Release series v1.x+.
- **Reusable Components**: Prover/verifier abstractions, Bonsai SNARK wrapper for converting STARK proofs into Groth16 proofs over BN254.
- **Maturity & Maintenance**: Highly mature, heavily funded, widely used in Ethereum and L2 ecosystems.
- **Resource & Budget Impact**: Proving full RISC-V executions locally requires substantial CPU/GPU RAM (minimum 16GB-32GB RAM). On a developer machine without high-end GPU or paid Bonsai API credits ($1 budget), full RISC-V ZK generation is computationally constrained.
- **Proposed Integration in ExJanAI**: ExJanAI defines an explicit cryptographic proving interface (`Prover` / `Verifier`). We build a deterministic arithmetic state transition validator with Merkle trace validation and Poseidon/SHA256 commitments for local execution, providing clear boundaries between local deterministic proof commitments and optional heavyweight zkVM modules.

---

### 2.6 kaspa-ng/kaspa-rest-server
- **Repository URL**: [https://github.com/kaspa-ng/kaspa-rest-server](https://github.com/kaspa-ng/kaspa-rest-server)
- **Project Purpose**: Python FastAPI server wrapping `kaspad` RPC and `simply-kaspa-indexer` PostgreSQL database to expose REST endpoints (powering `api.kaspa.org`).
- **License**: MIT.
- **Version & Compatibility**: Production endpoint standard.
- **Key Endpoints**:
  - `/info/health`: Node sync and database health.
  - `/info/blockdag`: Current DAG tips, block counts, difficulty.
  - `/info/virtual-chain-blue-score`: Current virtual blue score for finality tracking.
  - `/info/fee-estimate`: Real-time fee estimations in sompis/gram.
  - `/addresses/{address}/utxos`: Unspent outputs for fee funding and settlement inputs.
  - `/transactions`: Raw transaction broadcasting.
- **Maturity & Maintenance**: Proven production infrastructure for Kaspa explorers and wallets.
- **Proposed Integration in ExJanAI**: Core settlement and monitoring adapter target for both ExJanAI Settlement Adapter and ChainCheck diagnostics.

---

### 2.7 kaspa-ng/kaspa-explorer
- **Repository URL**: [https://github.com/kaspa-ng/kaspa-explorer](https://github.com/kaspa-ng/kaspa-explorer)
- **Project Purpose**: Official community web frontend explorer for visualizing Kaspa blocks, transactions, DAG blue score graphs, and network statistics.
- **License**: MIT.
- **Version & Compatibility**: Next.js / TypeScript frontend.
- **Reusable Components**: UI patterns for visualizing DAG tips, sompi-to-KAS conversions, address format handling.
- **Proposed Integration in ExJanAI**: Informing the design of ExJanAI Explorer UI to provide seamless navigation between L2 batches and their anchoring L1 Kaspa transactions.

---

### 2.8 prometheus/blackbox_exporter
- **Repository URL**: [https://github.com/prometheus/blackbox_exporter](https://github.com/prometheus/blackbox_exporter)
- **Project Purpose**: Standard Prometheus blackbox prober for network endpoints over HTTP, HTTPS, DNS, TCP, and gRPC.
- **License**: Apache-2.0.
- **Maturity & Maintenance**: Gold standard for infrastructure probing.
- **Reusable Concepts**: Multi-stage probe timing (DNS resolution, TCP connect, TLS handshake, first-byte TTFB, transfer completion), synthetic validation.
- **Proposed Integration in ExJanAI / ChainCheck**: ChainCheck incorporates blackbox probe timing mechanics into its native protocol checks, measuring multi-stage network latency without external heavyweight binary dependencies.

---

### 2.9 louislam/uptime-kuma
- **Repository URL**: [https://github.com/louislam/uptime-kuma](https://github.com/louislam/uptime-kuma)
- **Project Purpose**: Self-hosted open-source monitoring tool with reactive web interface and alerting.
- **License**: AGPL-3.0.
- **Reusable Concepts**: Incident detection, historical ping latency calculation, certificate validity tracking, user-friendly status pages.
- **Proposed Integration in ExJanAI / ChainCheck**: Informing ChainCheck’s reliability index algorithm, historical tracking database schema (SQLite), and standalone HTML report generator.

---

### 2.10 docs.kaspa.org/toccata/agent-brief
- **Source URL**: [https://docs.kaspa.org/toccata/agent-brief](https://docs.kaspa.org/toccata/agent-brief)
- **Project Purpose**: Official Kaspa developer briefing for engineering covenants and stateful operations on Kaspa.
- **Core Principles Identified**:
  - Kaspa is strictly UTXO-native; there is no global mutable world state or EVM on L1.
  - State continuity is maintained across linear spends of covenants where the output script dictates valid successor UTXO scripts.
  - Scripts verify transactions via introspection rather than running side-effectful state modifications.
- **Application to ExJanAI**: Reinforces that ExJanAI’s L2 state execution MUST remain off-chain, using Kaspa L1 for deterministic sequencing, batch settlement commitments, and dispute/exit enforcement.

---

### 2.11 docs-kasplex.gitbook.io/l2-network & kasplex.org
- **Source URLs**: [https://docs-kasplex.gitbook.io/l2-network](https://docs-kasplex.gitbook.io/l2-network) & [https://kasplex.org/](https://kasplex.org/)
- **Project Purpose**: Kasplex zkEVM Based Rollup architecture specifications on Kaspa.
- **Architecture Highlights**:
  - Based Rollup model: Sequencer delegates ordering directly to Kaspa L1 transaction timestamps / GHOSTDAG blue score ordering.
  - Data Availability: Calldata/payloads recorded directly in Kaspa L1 transaction payloads.
  - Proofs: PLONK / zk-SNARK verification network.
- **Assessment**: Demonstrates real ecosystem demand for L2 execution on Kaspa. However, closed/proprietary indexer and sequencer dependencies make it unsuitable for an independent, open-source local-first prototype. ExJanAI will establish its own clean, auditable protocol.

---

## 3. Comparative Architecture Selection (Prompt Section 4)

We evaluate the three prescribed architectural options:

| Criterion | Option A: Kaspa-Based ZK Application | Option B: Existing Kaspa L2 Integration (Kasplex) | Option C: New Independent Rollup Design |
| :--- | :--- | :--- | :--- |
| **Ordering Mechanism** | Kaspa L1 Based Sequencing (L1 blocks dictate L2 tx order) | Dependent on Kasplex proprietary sequencer/relay | Sovereign ExJanAI Sequencer with L1 Batch Commitments |
| **Execution Engine** | Deterministic Off-Chain VM / State Machine | Kasplex EVM node | Sovereign Deterministic State Transition Engine |
| **Data Availability** | Kaspa L1 Transaction Payloads | Kaspa L1 OP_RETURN / Inscriptions | Batched State Diff & Tx Merkle Root anchored to Kaspa L1 |
| **Settlement Primitives** | Kaspa Testnet Payloads + Toccata KIP-16/17 compatibility | Kasplex bridge contracts | Verifiable L1 Anchoring Transactions with Virtual Blue Score finality |
| **Budget Feasibility ($1)** | **High**: Zero proprietary costs; runs locally & on public testnet | **Low**: High reliance on external closed APIs; cannot independently modify core rules | **High**: Complete local determinism; transparent testnet settlement |
| **Security Origin** | Inherits L1 censorship resistance for ordering | Inherits Kasplex operator assumptions | Hybrid: Off-chain operator validity with verifiable L1 batch anchoring |
| **Implementation Complexity** | Medium-High: Requires clean L1 adapter and state engine | Low independence: Mere wrapper around third-party service | High: Requires custom p2p/consensus if fully decentralized |

### Selection Decision & Technical Justification:

**Selected Architecture: Hybrid Architecture (Option A + Option C Prototype)**:
We select a **Verifiable Sovereign Execution Rollup with Kaspa L1 Batch Settlement (Option A core with Option C execution independence)**:
1. **Feasibility**: Full on-chain ZK verification in Kaspa script is pending mainnet activation of KIP-16 and KIP-17. Building a prototype that couples deterministic state transitions, cryptographic state roots (Sparse Merkle Tree), and structured L1 settlement payloads directly bridges today's testnet reality with tomorrow's Toccata capabilities.
2. **Independence & Auditability**: Avoids copying Kasplex branding or relying on unverified third-party services.
3. **Budget ($1 Cash)**: The entire stack can be run locally, tested deterministically, and anchored onto Kaspa Testnet-10 / Testnet-11 without commercial licenses or paid cloud infrastructure.

---

## 4. Conclusion & Next Steps

With upstream references analyzed and the architectural decision formalized, we proceed immediately to authoring `docs/ARCHITECTURE.md` to define the technical specifications for Layer 1 interfaces, deterministic execution, state roots, proof abstraction, settlement lifecycles, and security threat vectors.
