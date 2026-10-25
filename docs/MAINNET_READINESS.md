# Extropian Janus — Mainnet Layer 2 Readiness & Deployment Architecture

**Project**: ExJanAI Blockchain (Extropian Janus)  
**Target Layer 1**: Kaspa BlockDAG Mainnet (`https://api.kaspa.org`)  
**Native Token**: EXJANAI (100,000,000 Total Supply)  

---

## 1. How ExJanAI Anchors to Kaspa Mainnet Today

ExJanAI utilizes a **Two-Tier Evolution Architecture** to bridge today's live Kaspa Mainnet with tomorrow's Toccata consensus upgrade:

```
+--------------------------------------------------------------------------------------------------+
| TIER 1: Live Mainnet State Commitment & Data Availability (ACTIVE TODAY)                        |
| - Off-chain deterministic execution engine calculates Sparse Merkle Tree state roots.           |
| - Binary batch commitment payloads (153 bytes with magic 'EXJA') anchored into Kaspa Mainnet.     |
| - Inherits Kaspa BlockDAG timestamping, censorship-resistant ordering, and immutable history.   |
| - Economic Cost: ~0.0021 KAS per batch (1 KAS funds ~473 batch anchors).                        |
+--------------------------------------------------------------------------------------------------+
                                                |
                                                v  [Upon Kaspa Hard Fork Activation]
+--------------------------------------------------------------------------------------------------+
| TIER 2: Trustless On-Chain ZK Covenant Bridge (KIP-16 & KIP-17)                                  |
| - KIP-16 OpZkPrecompile validates Groth16 / BN254 proofs directly inside Kaspa script.           |
| - KIP-17 Introspection covenants mathematically enforce output state transitions and withdrawals.|
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Live Mainnet Pre-Flight Audit

To audit the connection against live Kaspa Mainnet:

```bash
npm run mainnet:preflight
```

Live telemetry collected from `https://api.kaspa.org`:
- **Network**: `KASPA-MAINNET`
- **Live Virtual Blue Score**: `> 572,870,000`
- **Batch Payload Mass**: `2,112 grams` (well within standard Kaspa 100,000 mass limit)
- **Settlement Cost**: `~0.0021 KAS` per batch anchor
- **100M EXJANAI Supply**: `VERIFIED`

---

## 3. How to Configure a Live Mainnet Operator

To anchor batches on Kaspa Mainnet:

1. **Generate or Provide a Kaspa Mainnet Address**:
   ```bash
   # Standard kaspa:q... address
   export KASPA_OPERATOR_ADDRESS="kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
   ```

2. **Fund with 1 to 5 KAS**:
   - A single 5 KAS funding covers over **2,300 batch settlement anchors** on Kaspa Mainnet.

3. **Set Environment Variables**:
   ```bash
   export KASPA_RPC_URL="https://api.kaspa.org"
   export KASPA_CONFIRMATION_DEPTH=120
   export NODE_ENV=production
   ```

4. **Verify Readiness**:
   ```bash
   node src/cli/index.ts mainnet-check kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq
   ```

---

## 4. Operational Guardrails

> [!CAUTION]
> Per the Master Engineering Rules, ExJanAI never executes mainnet transactions or spends real user funds without explicit configuration and operator authorization. Always run preflight checks on testnet before directing settlement to mainnet RPCs.
