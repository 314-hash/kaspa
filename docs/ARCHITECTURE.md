# ExJanAI Blockchain — Architecture Specification

**Project**: ExJanAI Blockchain  
**Layer**: Proposed Kaspa-Integrated Layer 2  
**Document Version**: 1.0.0-PROTOTYPE  
**Date**: October 2026  
**Status**: Development & Testnet Prototype  

---

## 1. Architectural Overview & Identity

**ExJanAI Blockchain** is an independently developed Layer 2 execution and settlement architecture designed to integrate with the Kaspa BlockDAG network. The architecture provides deterministic off-chain transaction execution, cryptographic state commitment calculation (Sparse Merkle State Root), zero-knowledge proof abstraction, and verifiable settlement anchoring onto Kaspa Layer 1.

```
                      +---------------------------------------+
                      |       ExJanAI Client Applications     |
                      |   (CLI, Test Wallet, Web Explorer)    |
                      +-------------------+-------------------+
                                          |
                                          v  [Signed L2 Operations]
+---------------------------------------------------------------------------------+
|                        ExJanAI Layer 2 Node & Engine                            |
|                                                                                 |
|  +--------------------+   +-----------------------+   +----------------------+  |
|  | Mempool & Nonce    |-->| Deterministic State   |-->| Sparse Merkle Tree   |  |
|  | Replay Guard       |   | Transition Machine    |   | State Root Engine    |  |
|  +--------------------+   +-----------------------+   +----------------------+  |
|                                       |                                         |
|                                       v                                         |
|  +--------------------+   +-----------------------+   +----------------------+  |
|  | Batch Aggregator   |-->| Prover / Verifier     |-->| L1 Settlement        |  |
|  | (Block Builder)    |   | Circuit Interface     |   | Adapter Engine       |  |
|  +--------------------+   +-----------------------+   +----------------------+  |
+---------------------------------------------------------------------------------+
                                        |
                   [Anchored Settlement Commitments & Blue Score Tracking]
                                        v
+---------------------------------------------------------------------------------+
|                               Kaspa Layer 1 (L1)                                |
|             (GHOSTDAG Consensus / Testnet-10 / Testnet-11 Toccata)              |
+---------------------------------------------------------------------------------+
```

---

## 2. Layer 1 Interface Specification

### 2.1 Supported Kaspa Networks
1. **Kaspa Testnet-10**: Current live public testnet (1 BPS). Ideal for standard payload anchoring, UTXO tracking, and fee estimation experiments.
2. **Kaspa Testnet-11 (Toccata)**: High-speed testnet (10 BPS) featuring advanced script capabilities, introspection (KIP-17), and preparatory ZK precompile infrastructure (KIP-16).
3. **Local Devnet / Simulation Node**: In-memory and local mock daemon simulating Kaspa wRPC and REST endpoints with deterministic DAG block generation, blue score increments, and reorg injection for local CI testing ($0 cost).

### 2.2 RPC and SDK Interface
ExJanAI interacts with Kaspa L1 through a dual-channel interface:
- **wRPC Interface**: Connects to `rusty-kaspa` via WebSocket using JSON/Borsh framing (`ws://127.0.0.1:17110` or public wRPC nodes). Used for low-latency notifications (new DAG blocks, mempool events).
- **REST Interface**: Interfaces with `kaspa-rest-server` endpoints (`/info/virtual-chain-blue-score`, `/info/fee-estimate`, `/info/blockdag`, `/addresses/{address}/utxos`, `/transactions`).
- **Dependencies**: Native TypeScript/Node protocol client with zero proprietary SDK requirements.

### 2.3 Transaction Submission and Confirmation Handling
- Settlement transactions commit L2 batch headers to Kaspa L1.
- Each settlement transaction spends one or more L1 UTXOs owned by the ExJanAI Settlement Operator, pays the required network fee (calculated via `/info/fee-estimate`), and creates:
  1. A change output returning unspent sompis to the operator address.
  2. A data-carrying payload output or script embedding the serialized ExJanAI State Commitment.
- **Confirmation Tracking**: Rather than relying on simple block counts, ExJanAI tracks the **Virtual Selected Parent Blue Score (VSPBS)** of the DAG. A settlement transaction is considered:
  - `Submitted`: Broadcast to mempool, transaction ID received.
  - `Included`: Present in at least one accepted DAG block.
  - `Settled` (Final): Virtual blue score delta exceeds finality threshold $\Delta_{BS} \ge 10$ (testnet) or $\Delta_{BS} \ge 120$ (mainnet specification).

### 2.4 Reorganization Handling
In Kaspa's BlockDAG, blocks in parallel chains can merge without reorging state unless conflicting UTXO spends occur. When a virtual selected parent chain reorganization occurs:
- ExJanAI tracks DAG tip changes and virtual selected parent history.
- If a blue score fork invalidates a block containing a settlement transaction, the settlement adapter detects the confirmation regression.
- Unconfirmed settlement transactions are re-broadcast or reconstituted with updated inputs if the prior UTXO spend was invalidated.

### 2.5 Network Upgrade Compatibility
- Designed to comply with **KIP-24** (Transaction Version 1 format) and **KIP-25** (Compute Budgeting).
- Prepares for **KIP-16** (`OpZkPrecompile`) by adopting SNARK proof data representations that map directly to the planned Groth16 verification precompile on BN254.

---

## 3. Execution Layer Specification

### 3.1 Transaction and Operation Format
ExJanAI operations are strictly typed and deterministically serialized:

```typescript
interface ExJanAITransaction {
  version: number;           // Transaction protocol version (default 1)
  chainId: number;           // Network identifier (prevent cross-network replay)
  nonce: number;             // Sequential sender account nonce
  from: string;              // Sender public key / hex address
  to: string;                // Recipient hex address
  amount: bigint;            // Transferred amount in fundamental units (wei-equivalent)
  fee: bigint;               // Execution fee paid to L2 operator
  opType: 'TRANSFER' | 'DEPLOY' | 'CALL' | 'WITHDRAW';
  payload: string;           // Hex-encoded arbitrary data or contract call payload
  signature: string;         // Cryptographic signature over canonical transaction hash
}
```

### 3.2 Canonical Transaction Hashing & Signing
The canonical transaction hash $H_{tx}$ is computed over the deterministic serialization of fields:
$$H_{tx} = \text{SHA256}(\text{version} \parallel \text{chainId} \parallel \text{nonce} \parallel \text{from} \parallel \text{to} \parallel \text{amount} \parallel \text{fee} \parallel \text{opType} \parallel \text{payload})$$
Signatures are validated using ECDSA over secp256k1 or Ed25519 public keys.

### 3.3 Account Model and Justification
ExJanAI adopts an **Account-Based Model** with explicit nonces for L2 execution, justified by:
1. **State Density**: Accounts allow compact state storage (address $\to$ {balance, nonce, storageRoot}), minimizing Merkle tree leaf count.
2. **Deterministic Sequence**: Nonces strictly serialize an account's transactions, eliminating ambiguous race conditions off-chain.
3. **Rollup Batch Efficiency**: An account update requires updating a single leaf in the Sparse Merkle Tree, whereas UTXO models require tracking dynamic nullifier and coin trees.

### 3.4 Deterministic State Transition Rules
For each transaction $T$ applied to state $S$:
1. **Format Validation**: Ensure all fields are within bounded sizes (e.g. payload $\le$ 32 KB).
2. **Signature Verification**: Recover signer from $H_{tx}$ and verify $\text{signer} == T.\text{from}$.
3. **Chain ID Verification**: Verify $T.\text{chainId} == \text{Config.chainId}$.
4. **Nonce Verification**: Verify $T.\text{nonce} == S[T.\text{from}].\text{nonce}$. (If mismatched, reject as invalid or replay).
5. **Solvency Verification**: Verify $S[T.\text{from}].\text{balance} \ge T.\text{amount} + T.\text{fee}$.
6. **State Mutation**:
   - $S[T.\text{from}].\text{balance} \leftarrow S[T.\text{from}].\text{balance} - (T.\text{amount} + T.\text{fee})$
   - $S[T.\text{from}].\text{nonce} \leftarrow S[T.\text{from}].\text{nonce} + 1$
   - $S[T.\text{to}].\text{balance} \leftarrow S[T.\text{to}].\text{balance} + T.\text{amount}$
   - $\text{OperatorAccount}.\text{balance} \leftarrow \text{OperatorAccount}.\text{balance} + T.\text{fee}$
7. **Receipt Generation**: Emit deterministic receipt containing status ($0 = \text{Failed}, 1 = \text{Success}$), gas used, and cumulative state delta.

### 3.5 Resource Metering & Compute Limits
- Maximum batch size: 500 transactions per L2 batch (configurable for testnet).
- Maximum payload size per transaction: 32,768 bytes.
- Base transaction gas cost: 21,000 gas units; payload bytes: 16 gas units per non-zero byte.
- Total batch compute budget: 10,000,000 gas units.

### 3.6 State Root Construction (Sparse Merkle Tree)
The global state root $R$ is calculated over the key-value dictionary of account states using a deterministic Sparse Merkle Tree (SMT):
- Leaf Key: $K = \text{SHA256}(\text{address})$
- Leaf Value: $V = \text{SHA256}(\text{nonce} \parallel \text{balance} \parallel \text{storageRoot})$
- Internal Nodes: $N_{parent} = \text{SHA256}(N_{left} \parallel N_{right})$
The resulting 32-byte hash uniquely and cryptographically binds the entire state of ExJanAI Blockchain.

### 3.7 State Persistence and Recovery
- **Storage Backend**: SQLite engine with ACID write-ahead logging (WAL) for local prototype and zero-cost hosting.
- **Journaling**: Every batch commits its transaction list, pre-state root, post-state root, and state diffs into an atomic database transaction.
- **Crash Recovery**: On startup, the engine queries the latest committed batch, computes the SMT state root from local account records, and compares it against the recorded root. If a mismatch is detected, it rolls back to the last verifiable checkpoint and replays valid batches from genesis.

---

## 4. Proof System & Verification Specification

### 4.1 Proof Architecture & Candidate System
- **Candidate System**: Groth16 / STARK over BN254.
- **Rationale**: Kaspa's KIP-16 (`OpZkPrecompile`) specifies pairing checks compatible with BN254 Groth16 proofs. Choosing this structure ensures forward compatibility with Kaspa L1 without redesigning public input representations.
- **Operational Reality ($1 Budget & Local Execution)**: Proving large circuits via RISC Zero / SP1 requires multi-gigabyte RAM and specialized proving hardware. ExJanAI implements a formal **Prover/Verifier Interface** with:
  1. Complete public input serialization: $[R_{pre}, R_{post}, H_{batch}, \text{batchId}, \text{txCount}]$.
  2. Cryptographic constraint validation (verifying execution trace continuity, state root transitions, and transaction inclusion Merkle proofs).
  3. Pluggable ZK verification modules with explicit unit test mock vectors and rigorous separation between verified execution trace proofs and external proving hardware.

### 4.2 Public Inputs and Private Witness
- **Public Inputs** $\mathcal{P}$:
  - $R_{pre}$: Pre-state root (32 bytes)
  - $R_{post}$: Post-state root (32 bytes)
  - $H_{batch}$: Merkle root of transactions in the batch (32 bytes)
  - $\text{batchId}$: Monotonically increasing batch sequence number (uint64)
  - $\text{timestamp}$: UTC timestamp of batch creation (uint64)
- **Private Witness** $\mathcal{W}$:
  - Array of raw signed transactions $T_0, \dots, T_{n-1}$
  - Account state pre-images and SMT inclusion proofs before execution
  - Intermediate state transition receipts

### 4.3 Verification Interface
```typescript
interface ProofVerificationInterface {
  verifyProof(
    publicInputs: PublicInputs,
    proofData: Uint8Array | string
  ): Promise<boolean>;
}
```

---

## 5. Settlement Specification

### 5.1 State Commitment Format
The batch state commitment is encoded into a compact, standardized binary payload anchored onto Kaspa L1:

```
+---------------+----------------+----------------+----------------+----------------+
| Magic (4B)    | Version (1B)   | Batch ID (8B)  | Pre-Root (32B) | Post-Root (32B)|
| "EXJA"        | 0x01           | uint64_be      | bytes32        | bytes32        |
+---------------+----------------+----------------+----------------+----------------+
| Tx Root (32B) | Tx Count (4B)  | Proof Hash(32B)| Blue Score (8B)| Signature (64B)|
| bytes32       | uint32_be      | bytes32        | uint64_be      | secp256k1 sig  |
+---------------+----------------+----------------+----------------+----------------+
```
Total payload size: 217 bytes (well within Kaspa's standard transaction mass limit).

### 5.2 Settlement Transaction Construction
1. Operator gathers pending batches into a settlement request.
2. Formats commitment payload $C$.
3. Resolves current UTXOs from Kaspa L1 for the operator wallet via `/addresses/{addr}/utxos`.
4. Estimates current sompis/gram fee via `/info/fee-estimate`.
5. Builds standard Kaspa transaction embedding $C$ in the transaction payload.
6. Signs inputs and broadcasts via Kaspa REST `/transactions` or wRPC `submitTransaction`.

### 5.3 Finality & Blue Score Confirmations
- Kaspa produces blocks at 1–10 BPS. A batch is marked `Settled` once its anchoring transaction has been accepted by the virtual chain and the Virtual Blue Score has progressed by at least $\Delta_{BS} \ge 10$ ticks.

### 5.4 Withdrawal Authorization and Exit Queue
1. **L2 Withdrawal Request**: User submits a signed `WITHDRAW` transaction on L2 specifying amount and Kaspa L1 destination address.
2. **State Transition**: L2 tokens are burned/locked; state root updates; withdrawal is added to the batch's Exit Queue.
3. **L1 Settlement Spend**: Once the batch achieves `Settled` status on Kaspa L1, the withdrawal claim becomes valid.
4. **Dispute Window**: In the initial prototype, withdrawals require operator confirmation following batch settlement. In full Toccata deployment, withdrawals are unlocked via KIP-17 covenant introspection verifying the SMT withdrawal proof against the settled state root.

---

## 6. Threat Model & Security Analysis

| Threat Vector | Severity | Attack Mechanism | ExJanAI Mitigation |
| :--- | :--- | :--- | :--- |
| **Malicious Sequencer** | High | Sequencer reorders or inserts invalid state transitions | All state transitions must deterministically match the Sparse Merkle Root; any node can verify the batch execution trace from raw transactions; L1 anchors commitments. |
| **Invalid State Transition** | Critical | Batch commits state root without valid signatures or balances | Node execution engine validates all signatures, nonces, and balances before committing state root; invalid batches are rejected. |
| **Replayed Transaction** | High | Attacker replays valid past transaction to drain funds | Strict monotonically increasing account nonces + unique `chainId` in signing preimage. |
| **Double-Spend Attempt** | High | User spends same balance in two concurrent transactions | Sequencer applies transactions strictly in nonce order within the mempool; second transaction fails balance check. |
| **Forged Proof** | Critical | Attacker presents fake proof for unexecuted state transition | Proof verifier checks cryptographic polynomial commitments / verification key; invalid proofs fail verification. |
| **Stale State Root** | Medium | Sequencer commits batch with outdated pre-state root | Settlement adapter enforces $R_{pre}^{(k)} == R_{post}^{(k-1)}$; mismatched lineage is rejected on L1. |
| **Data Withholding** | High | Sequencer settles state root on L1 but hides transaction data | Batches publish transaction hashes and compressed state diffs; local testnet allows full replication. |
| **L1 Reorganization** | Medium | Deep Kaspa DAG reorg alters block containing settlement tx | Adapter tracks Virtual Selected Parent Blue Score depth ($\ge 10$ ticks) before marking finality. |
| **Bridge Failure** | High | Withdrawal queue processing fails or drains operator wallet | Bridge balances strictly bounded to verified deposits; rate limits on outbound withdrawals. |
| **Denial of Service** | Medium | Flooding node with junk transactions or invalid signatures | Pre-mempool signature and nonce check, IP rate-limiting, and max payload bounds (32 KB). |
| **Compromised Key** | Critical | Settlement operator private key leaked | Cold/hot key separation; multi-sig settlement coordinator support. |

---

## 7. Operational Status & Prototype Boundary

- **Prototype Boundary Definition**:
  - The current implementation provides **Deterministic Execution**, **Sparse Merkle Tree State Roots**, **Account Nonce Replay Guards**, **Kaspa L1 Settlement Anchoring**, **Virtual Blue Score Finality Tracking**, and **Cryptographic Trace Verification**.
  - As mandated by engineering rules: until KIP-16 (`OpZkPrecompile`) is activated on Kaspa mainnet, full on-chain ZK verification is demonstrated via local verification interfaces and test vectors. It is not represented as a production mainnet ZK rollup.
