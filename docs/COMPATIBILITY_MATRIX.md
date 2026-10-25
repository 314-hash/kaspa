# Extropian Janus — Protocol Compatibility Matrix

**Project**: ExJanAI Blockchain (Extropian Janus)  
**Layer**: Proposed Kaspa-Integrated Layer 2  
**Date**: October 2026  

---

## 1. Network Compatibility

| Target Network | Kaspa Base Version | RPC Protocol | ExJanAI Settlement Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Kaspa Mainnet** | `rusty-kaspa v0.14.x` / `v0.15.x` | wRPC / REST | Spec Defined / Not Deployed | Mainnet deployment awaits KIP-16/17 consensus activation to avoid centralized bridge custody. |
| **Kaspa Testnet-10** | `rusty-kaspa v0.15.x` | REST (`api-testnet-10.kaspa.org`) & wRPC | Compatible (Live Testnet) | Used for public testnet payload anchoring, UTXO tracking, and fee estimation. |
| **Kaspa Testnet-11 (Toccata)** | `rusty-kaspa v1.0.0-toccata` | wRPC (Borsh/JSON) & gRPC | Target Reference Architecture | Compatible with Toccata opcode set, KIP-17 introspection, and KIP-20 covenant IDs. |
| **Local Devnet / Simulation** | In-Memory / Local Node | Embedded Node / HTTP | Fully Verified (Active CI) | $0 budget execution; instant DAG blocks, configurable blue score, reorg injection. |

---

## 2. Kaspa Improvement Proposal (KIP) Support

| Proposal | Title | Status in Kaspa | ExJanAI Integration Mechanism |
| :--- | :--- | :--- | :--- |
| **KIP-16** | ZK Precompile Opcode (`OpZkPrecompile`) | Testnet-11 / Draft | Public inputs formatted for BN254 Groth16 pairings; trace commitment verification engine ready. |
| **KIP-17** | Covenant Capabilities & Introspection | Testnet-11 / Draft | UTXO spending constraints modeled in Silverscript covenant bridge specification. |
| **KIP-20** | Covenant Identifiers | Testnet-11 / Draft | Unique settlement commitment lineage tracking. |
| **KIP-21** | Partitioned Sequencing Commitments (User Lanes) | Draft RFC | Batch ordering and partitioned sequencing lane compatibility. |
| **KIP-24** | Transaction Version 1: New Fields & Hashing | Testnet-11 / Staged | Serialization and hashing compliance with v1 standards. |
| **KIP-25** | Compute Budget for Script Execution | Testnet-11 / Staged | Resource metering (gas bounds) mapped to Kaspa compute mass limits. |

---

## 3. Cryptographic Primitives

| Primitive | Standard | Implementation | Usage |
| :--- | :--- | :--- | :--- |
| **Signature Scheme** | ECDSA over `secp256k1` | Node `node:crypto` / WebCrypto | L2 transaction signing and address derivation. |
| **Hashing Engine** | SHA-256 | Node `node:crypto` | Canonical transaction hashing, SMT leaf hashes, commitment digest. |
| **State Trie** | Binary Sparse Merkle Tree (SMT) | Deterministic TypeScript (`smt.ts`) | 32-byte global state root calculation and inclusion proofs. |
| **Batch Commitment** | 153-byte binary packed payload | `settlement.ts` | Magic bytes `EXJA`, version, batchId, preRoot, postRoot, txRoot, blueScore. |

---

## 4. Software Dependencies & Runtime Requirements

- **Runtime**: Node.js v22.x or v24.x (uses native `node:sqlite` and native `node:crypto`).
- **External C/C++ Compilers**: None required (no `node-gyp` or Python native build steps).
- **RAM Footprint**: $< 120\text{ MB}$ for node, indexer, and explorer dashboard.
- **Operating Systems**: Windows 10/11, Linux (Ubuntu, Debian, Alpine), macOS.
