# Extropian Janus — Honest List of Incomplete Features & Protocol Boundaries

**Project**: ExJanAI Blockchain (Extropian Janus)  
**Layer**: Proposed Kaspa-Integrated Layer 2  
**Date**: October 2026  
**Engineering Principle**: Extreme intellectual honesty. No feature is marked as production-ready without verifiable on-chain evidence.

---

## 1. On-Chain Kaspa Script Verification (Pending Consensus Upgrades)
- **Current State**: Batches commit state roots, transaction Merkle trees, and proof commitments onto Kaspa L1 via standard transaction data payloads.
- **Limitation**: Direct on-chain verification of zero-knowledge proofs inside Kaspa script cannot occur until **KIP-16 (`OpZkPrecompile`)** and **KIP-17 (`Covenant Capabilities`)** are activated in Kaspa consensus (Toccata hard fork).
- **Prototype Boundary**: Verification currently occurs off-chain in the node execution engine and trace prover.

---

## 2. Decentralized Sequencer Network
- **Current State**: Single sequencer engine aggregates mempool operations, computes state roots, and submits batches.
- **Limitation**: A single sequencer introduces temporary liveness reliance on the operator. If the sequencer goes offline, new batches pause until restarted.
- **Future Roadmap**: Multi-operator BFT consensus or Based Rollup delegation (where Kaspa L1 miners sequence L2 transactions directly).

---

## 3. General-Purpose EVM Bytecode Execution
- **Current State**: Deterministic native state machine with typed transactions (`TRANSFER`, `WITHDRAW`, `DEPOSIT`).
- **Limitation**: Full arbitrary Solidity smart contract bytecode (REVM / EVM execution) is not yet integrated. The prototype focuses on state transition determinism, account solvency, Sparse Merkle Trees, and settlement integrity first.

---

## 4. Trustless Bridge Custody
- **Current State**: L1 settlement commitments and L2 withdrawal queues track state transitions deterministically.
- **Limitation**: Because Kaspa mainnet lacks native covenant introspection today, withdrawals require operator fulfillment on L1. Trustless, math-enforced bridge exits require KIP-17 covenants.

---

## 5. Formal Cryptographic Security Audit
- **Current State**: Thorough internal test suite (23 passing automated tests covering replay protection, state divergence, invalid signatures, SSRF, and reorg resilience).
- **Limitation**: No external, third-party independent security audit has been performed. Real capital must not be deposited.
