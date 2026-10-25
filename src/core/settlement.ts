import crypto from 'node:crypto';
import type { ExJanAIBatch, SettlementStatus, WithdrawalRequest } from '../types/index.ts';
import { sha256, sha256Buffer } from './crypto.ts';

export const EXJANAI_MAGIC = Buffer.from('EXJA', 'ascii'); // 4 bytes
export const COMMITMENT_VERSION = 1;

export interface DecodedBatchCommitment {
  magic: string;
  version: number;
  batchId: number;
  preStateRoot: string;
  postStateRoot: string;
  txRoot: string;
  txCount: number;
  proofHash: string;
  blueScore: bigint;
  signatureHex: string;
}

/**
 * Encodes an ExJanAI batch commitment into a standard binary payload for Kaspa L1 anchoring
 */
export function encodeBatchCommitment(
  batch: ExJanAIBatch,
  blueScore: bigint,
  operatorPrivateKeyPem?: string
): Buffer {
  const buf = Buffer.alloc(4 + 1 + 8 + 32 + 32 + 32 + 4 + 32 + 8);
  let offset = 0;

  // 1. Magic (4 bytes)
  EXJANAI_MAGIC.copy(buf, offset);
  offset += 4;

  // 2. Version (1 byte)
  buf.writeUInt8(COMMITMENT_VERSION, offset);
  offset += 1;

  // 3. Batch ID (8 bytes BigInt Big-Endian)
  buf.writeBigUInt64BE(BigInt(batch.batchId), offset);
  offset += 8;

  // 4. Pre State Root (32 bytes)
  Buffer.from(batch.preStateRoot, 'hex').copy(buf, offset);
  offset += 32;

  // 5. Post State Root (32 bytes)
  Buffer.from(batch.postStateRoot, 'hex').copy(buf, offset);
  offset += 32;

  // 6. Tx Merkle Root (32 bytes)
  Buffer.from(batch.txRoot, 'hex').copy(buf, offset);
  offset += 32;

  // 7. Tx Count (4 bytes uint32)
  buf.writeUInt32BE(batch.txCount, offset);
  offset += 4;

  // 8. Proof Hash (32 bytes)
  const proofHash = batch.proof ? sha256(batch.proof.proofData) : '0'.repeat(64);
  Buffer.from(proofHash, 'hex').copy(buf, offset);
  offset += 32;

  // 9. Blue Score (8 bytes BigInt Big-Endian)
  buf.writeBigUInt64BE(blueScore, offset);
  offset += 8;

  // 10. Optional signature
  if (operatorPrivateKeyPem) {
    const signature = crypto.sign('SHA256', buf, operatorPrivateKeyPem);
    return Buffer.concat([buf, signature]);
  }

  return buf;
}

/**
 * Decodes an ExJanAI batch commitment from a raw binary payload
 */
export function decodeBatchCommitment(buffer: Buffer): DecodedBatchCommitment {
  if (buffer.length < 153) {
    throw new Error(`Invalid commitment buffer length: ${buffer.length} < 153 bytes`);
  }

  const magic = buffer.subarray(0, 4).toString('ascii');
  if (magic !== 'EXJA') {
    throw new Error(`Invalid commitment magic: expected EXJA, got ${magic}`);
  }

  const version = buffer.readUInt8(4);
  const batchId = Number(buffer.readBigUInt64BE(5));
  const preStateRoot = buffer.subarray(13, 45).toString('hex');
  const postStateRoot = buffer.subarray(45, 77).toString('hex');
  const txRoot = buffer.subarray(77, 109).toString('hex');
  const txCount = buffer.readUInt32BE(109);
  const proofHash = buffer.subarray(113, 145).toString('hex');
  const blueScore = buffer.readBigUInt64BE(145);
  const signatureHex = buffer.length > 153 ? buffer.subarray(153).toString('hex') : '';

  return {
    magic,
    version,
    batchId,
    preStateRoot,
    postStateRoot,
    txRoot,
    txCount,
    proofHash,
    blueScore,
    signatureHex,
  };
}

/**
 * High-fidelity Kaspa BlockDAG Simulator Node for local testing ($0 operational budget)
 */
export class KaspaSimulatedNode {
  public networkName: string = 'kaspa-simulated-testnet';
  public currentBlueScore: bigint = 100_000n;
  public blockCount: number = 250_000;
  public tips: string[] = [sha256('tip_1'), sha256('tip_2')];
  public mempool: Map<string, { payloadHex: string; blueScore: bigint; address: string }> = new Map();
  public confirmedTxs: Map<string, { payloadHex: string; includedAtBlueScore: bigint; address: string }> = new Map();
  public utxos: Map<string, Array<{ txId: string; outputIndex: number; amount: bigint }>> = new Map();

  constructor(operatorAddress: string = 'kaspatest:qzp000000000000000000000000000000000000000') {
    // Seed initial UTXO for fee funding
    this.utxos.set(operatorAddress, [
      { txId: sha256('genesis_utxo_1'), outputIndex: 0, amount: 500_000_000_000n }, // 5000 KAS
    ]);
  }

  public getVirtualChainBlueScore(): { blueScore: bigint } {
    return { blueScore: this.currentBlueScore };
  }

  public getBlockDagInfo() {
    return {
      networkName: this.networkName,
      blockCount: this.blockCount,
      headerCount: this.blockCount + 10,
      tipHashes: this.tips,
      difficulty: 12450.85,
      pastMedianTime: Date.now(),
      virtualParentHashes: this.tips,
    };
  }

  public getFeeEstimate() {
    return {
      priorityBucket: { feerate: 1.0 },
      normalBuckets: [{ feerate: 1.0 }],
      lowBuckets: [{ feerate: 1.0 }],
    };
  }

  public getUtxos(address: string) {
    return this.utxos.get(address) || [];
  }

  public submitTransaction(txPayloadHex: string, senderAddress: string): { transactionId: string } {
    const txId = sha256(txPayloadHex + Date.now().toString());
    this.mempool.set(txId, {
      payloadHex: txPayloadHex,
      blueScore: this.currentBlueScore,
      address: senderAddress,
    });
    return { transactionId: txId };
  }

  /**
   * Advance the BlockDAG simulated clock: includes mempool txs and increments blue score
   */
  public advanceDag(ticks: number = 1): void {
    for (let i = 0; i < ticks; i++) {
      this.currentBlueScore += 1n;
      this.blockCount += 1;
      this.tips = [sha256(`tip_${this.currentBlueScore}`)];

      // Move mempool items to confirmed if at least 1 tick has passed
      for (const [txId, item] of this.mempool.entries()) {
        this.confirmedTxs.set(txId, {
          payloadHex: item.payloadHex,
          includedAtBlueScore: this.currentBlueScore,
          address: item.address,
        });
        this.mempool.delete(txId);
      }
    }
  }

  /**
   * Simulate a DAG reorganization by winding back blue score and evicting recent txs
   */
  public injectReorg(blueScoreDelta: number = 5): void {
    this.currentBlueScore = this.currentBlueScore > BigInt(blueScoreDelta)
      ? this.currentBlueScore - BigInt(blueScoreDelta)
      : 1n;
    this.tips = [sha256(`reorg_tip_${this.currentBlueScore}`)];
    // Invalidate txs confirmed after the rollback point
    for (const [txId, item] of this.confirmedTxs.entries()) {
      if (item.includedAtBlueScore > this.currentBlueScore) {
        this.confirmedTxs.delete(txId);
        // Put back in mempool
        this.mempool.set(txId, item);
      }
    }
  }
}

export interface SettlementAdapterConfig {
  kaspaRpcUrl?: string; // e.g. 'https://api-testnet-10.kaspa.org'
  operatorAddress: string;
  operatorPrivateKeyPem?: string;
  confirmationDepth?: number; // default 10 blue score ticks for testnet
  simulatedNode?: KaspaSimulatedNode;
}

/**
 * Kaspa Settlement Adapter
 * Connects ExJanAI Layer 2 batches to Kaspa Layer 1 BlockDAG
 */
export class SettlementAdapter {
  private config: SettlementAdapterConfig;
  private simNode?: KaspaSimulatedNode;
  private confirmationDepth: number;
  private withdrawalQueue: WithdrawalRequest[] = [];

  constructor(config: SettlementAdapterConfig) {
    this.config = config;
    this.simNode = config.simulatedNode;
    this.confirmationDepth = config.confirmationDepth || 10;
  }

  /**
   * Submit an ExJanAI batch state commitment to Kaspa Layer 1
   */
  public async submitBatchCommitment(batch: ExJanAIBatch): Promise<{
    l1TxId: string;
    submittedBlueScore: bigint;
    status: SettlementStatus;
  }> {
    let currentBlueScore = 0n;

    if (this.simNode) {
      currentBlueScore = this.simNode.getVirtualChainBlueScore().blueScore;
    } else if (this.config.kaspaRpcUrl) {
      const res = await fetch(`${this.config.kaspaRpcUrl}/info/virtual-chain-blue-score`);
      if (!res.ok) throw new Error(`Kaspa RPC error: ${res.statusText}`);
      const data = (await res.json()) as { blueScore: number | string };
      currentBlueScore = BigInt(data.blueScore);
    } else {
      throw new Error('Neither simulatedNode nor kaspaRpcUrl configured for SettlementAdapter');
    }

    const payload = encodeBatchCommitment(
      batch,
      currentBlueScore,
      this.config.operatorPrivateKeyPem
    );
    const payloadHex = payload.toString('hex');

    let l1TxId: string;
    if (this.simNode) {
      const sub = this.simNode.submitTransaction(payloadHex, this.config.operatorAddress);
      l1TxId = sub.transactionId;
    } else {
      // In live network mode: POST raw settlement transaction to kaspa-rest-server /transactions
      const submitRes = await fetch(`${this.config.kaspaRpcUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: payloadHex,
          sender: this.config.operatorAddress,
        }),
      });
      if (!submitRes.ok) throw new Error(`L1 transaction broadcast failed: ${submitRes.statusText}`);
      const result = (await submitRes.json()) as { transactionId: string };
      l1TxId = result.transactionId;
    }

    batch.settlement = {
      status: 'SUBMITTED',
      l1TxId,
      l1BlueScore: Number(currentBlueScore),
      submittedAt: Date.now(),
    };

    return {
      l1TxId,
      submittedBlueScore: currentBlueScore,
      status: 'SUBMITTED',
    };
  }

  /**
   * Check and update confirmation progress of an anchoring settlement transaction
   */
  public async updateConfirmationStatus(batch: ExJanAIBatch): Promise<SettlementStatus> {
    if (!batch.settlement.l1TxId || !batch.settlement.l1BlueScore) {
      return 'PENDING';
    }

    let currentBlueScore = 0n;
    let isIncluded = false;

    if (this.simNode) {
      currentBlueScore = this.simNode.getVirtualChainBlueScore().blueScore;
      const tx = this.simNode.confirmedTxs.get(batch.settlement.l1TxId);
      if (tx) {
        isIncluded = true;
      } else if (this.simNode.mempool.has(batch.settlement.l1TxId)) {
        if (batch.settlement.status === 'INCLUDED' || batch.settlement.status === 'SETTLED') {
          batch.settlement.status = 'REORGANIZED';
          return 'REORGANIZED';
        }
        isIncluded = false;
      } else {
        // Was evicted by a reorg
        batch.settlement.status = 'REORGANIZED';
        return 'REORGANIZED';
      }
    } else if (this.config.kaspaRpcUrl) {
      const res = await fetch(`${this.config.kaspaRpcUrl}/info/virtual-chain-blue-score`);
      if (!res.ok) return batch.settlement.status;
      const data = (await res.json()) as { blueScore: number | string };
      currentBlueScore = BigInt(data.blueScore);
      isIncluded = true;
    }

    if (!isIncluded) {
      batch.settlement.status = 'SUBMITTED';
      return 'SUBMITTED';
    }

    const delta = currentBlueScore - BigInt(batch.settlement.l1BlueScore);
    if (delta >= BigInt(this.confirmationDepth)) {
      batch.settlement.status = 'SETTLED';
      batch.settlement.confirmedAt = Date.now();
      // Unlock associated withdrawal requests
      this.processWithdrawalsForBatch(batch.batchId);
      return 'SETTLED';
    } else {
      batch.settlement.status = 'INCLUDED';
      return 'INCLUDED';
    }
  }

  /**
   * Queue a withdrawal request from L2
   */
  public queueWithdrawal(request: Omit<WithdrawalRequest, 'status' | 'createdAt'>): WithdrawalRequest {
    const fullRequest: WithdrawalRequest = {
      ...request,
      status: 'PENDING_SETTLEMENT',
      createdAt: Date.now(),
    };
    this.withdrawalQueue.push(fullRequest);
    return fullRequest;
  }

  private processWithdrawalsForBatch(batchId: number): void {
    for (const req of this.withdrawalQueue) {
      if (req.batchId === batchId && req.status === 'PENDING_SETTLEMENT') {
        req.status = 'READY_FOR_CLAIM';
      }
    }
  }

  public getWithdrawalQueue(): WithdrawalRequest[] {
    return [...this.withdrawalQueue];
  }
}
