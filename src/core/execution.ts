import type {
  ExJanAITransaction,
  ExJanAIBatch,
  TransactionReceipt,
  ExJanAIAccount,
} from '../types/index.ts';
import { StateManager } from './state.ts';
import {
  hashTransaction,
  verifyTransactionSignature,
  computeMerkleRoot,
  sha256,
} from './crypto.ts';

export interface ExecutionEngineConfig {
  chainId: number;
  operatorAddress: string;
  maxBatchSize?: number;
  maxPayloadBytes?: number;
}

export interface ExecutionResult {
  receipt: TransactionReceipt;
  success: boolean;
  error?: string;
}

export class ExecutionEngine {
  private stateManager: StateManager;
  private config: ExecutionEngineConfig;
  private mempool: ExJanAITransaction[] = [];
  private currentBatchId: number = 0;

  constructor(stateManager: StateManager, config: ExecutionEngineConfig) {
    this.stateManager = stateManager;
    this.config = {
      maxBatchSize: 100,
      maxPayloadBytes: 32768,
      ...config,
    };

    // Recover current batch id from state
    const latest = this.stateManager.getLatestBatch();
    if (latest) {
      this.currentBatchId = latest.batchId;
    }
  }

  /**
   * Add a transaction to the mempool with preliminary checks
   */
  public submitToMempool(tx: ExJanAITransaction, senderPublicKeyPem?: string): { success: boolean; error?: string; txHash?: string } {
    const txHash = tx.hash || hashTransaction(tx);
    const enrichedTx: ExJanAITransaction = { ...tx, hash: txHash };

    // Basic format validation
    if (enrichedTx.version !== 1) {
      return { success: false, error: `Unsupported transaction version: ${enrichedTx.version}` };
    }
    if (enrichedTx.chainId !== this.config.chainId) {
      return { success: false, error: `Invalid chainId: expected ${this.config.chainId}, got ${enrichedTx.chainId}` };
    }
    if (enrichedTx.payload && enrichedTx.payload.length > (this.config.maxPayloadBytes! * 2)) {
      return { success: false, error: `Payload exceeds maximum permitted size` };
    }

    // Signature verification if public key provided
    if (senderPublicKeyPem) {
      const isValidSig = verifyTransactionSignature(enrichedTx, senderPublicKeyPem);
      if (!isValidSig) {
        return { success: false, error: 'Cryptographic signature verification failed' };
      }
    }

    // Nonce replay check against state
    const sender = this.stateManager.getAccount(enrichedTx.from);
    if (enrichedTx.nonce < sender.nonce) {
      return {
        success: false,
        error: `Transaction replay rejected: nonce ${enrichedTx.nonce} has already been consumed (current: ${sender.nonce})`,
      };
    }

    // Check duplicate in mempool
    const duplicateInMempool = this.mempool.some(
      (m) => m.from.toLowerCase() === enrichedTx.from.toLowerCase() && m.nonce === enrichedTx.nonce
    );
    if (duplicateInMempool) {
      return { success: false, error: `Conflicting transaction with nonce ${enrichedTx.nonce} already in mempool` };
    }

    this.mempool.push(enrichedTx);
    return { success: true, txHash };
  }

  /**
   * Deterministically execute a single transaction against current state
   */
  public executeTransaction(tx: ExJanAITransaction): ExecutionResult {
    const txHash = tx.hash || hashTransaction(tx);
    const sender = this.stateManager.getAccount(tx.from);
    const recipient = this.stateManager.getAccount(tx.to);
    const operator = this.stateManager.getAccount(this.config.operatorAddress);

    // 1. Nonce check
    if (tx.nonce !== sender.nonce) {
      return {
        success: false,
        error: `Nonce mismatch: expected ${sender.nonce}, got ${tx.nonce}`,
        receipt: {
          txHash,
          status: 0,
          gasUsed: 21000n,
          blockNumber: this.currentBatchId + 1,
          errorMessage: `Nonce mismatch: expected ${sender.nonce}, got ${tx.nonce}`,
          stateDelta: {
            from: tx.from,
            to: tx.to,
            amount: 0n,
            fee: 0n,
            newNonce: sender.nonce,
          },
        },
      };
    }

    // 2. Solvency check
    const totalRequired = BigInt(tx.amount) + BigInt(tx.fee);
    if (sender.balance < totalRequired) {
      return {
        success: false,
        error: `Insufficient balance: required ${totalRequired}, balance ${sender.balance}`,
        receipt: {
          txHash,
          status: 0,
          gasUsed: 21000n,
          blockNumber: this.currentBatchId + 1,
          errorMessage: `Insufficient balance: required ${totalRequired}, balance ${sender.balance}`,
          stateDelta: {
            from: tx.from,
            to: tx.to,
            amount: 0n,
            fee: 0n,
            newNonce: sender.nonce,
          },
        },
      };
    }

    // 3. State transitions
    const updatedSender: ExJanAIAccount = {
      ...sender,
      nonce: sender.nonce + 1,
      balance: sender.balance - totalRequired,
      updatedAt: Date.now(),
    };

    const updatedRecipient: ExJanAIAccount = {
      ...recipient,
      balance: recipient.balance + BigInt(tx.amount),
      updatedAt: Date.now(),
    };

    const updatedOperator: ExJanAIAccount = {
      ...operator,
      balance: operator.balance + BigInt(tx.fee),
      updatedAt: Date.now(),
    };

    // Apply updates atomically
    this.stateManager.setAccount(updatedSender);
    this.stateManager.setAccount(updatedRecipient);
    this.stateManager.setAccount(updatedOperator);

    const gasUsed = 21000n + BigInt(tx.payload ? Math.ceil(tx.payload.length / 2) * 16 : 0);

    return {
      success: true,
      receipt: {
        txHash,
        status: 1,
        gasUsed,
        blockNumber: this.currentBatchId + 1,
        stateDelta: {
          from: tx.from,
          to: tx.to,
          amount: BigInt(tx.amount),
          fee: BigInt(tx.fee),
          newNonce: updatedSender.nonce,
        },
      },
    };
  }

  /**
   * Process transactions and construct a new deterministic batch
   */
  public produceBatch(transactionsToInclude?: ExJanAITransaction[]): ExJanAIBatch {
    const preStateRoot = this.stateManager.getStateRoot();
    const batchId = this.currentBatchId + 1;

    let txs: ExJanAITransaction[] = [];
    if (transactionsToInclude) {
      txs = transactionsToInclude;
    } else {
      // Drain up to maxBatchSize from mempool
      const count = Math.min(this.mempool.length, this.config.maxBatchSize!);
      txs = this.mempool.splice(0, count);
    }

    const receipts: TransactionReceipt[] = [];
    const validTxs: ExJanAITransaction[] = [];

    for (const tx of txs) {
      const result = this.executeTransaction(tx);
      receipts.push(result.receipt);
      if (result.success) {
        validTxs.push(tx);
      }
    }

    const postStateRoot = this.stateManager.getStateRoot();
    const txHashes = txs.map((t) => t.hash || hashTransaction(t));
    const txRoot = computeMerkleRoot(txHashes);

    const batch: ExJanAIBatch = {
      batchId,
      preStateRoot,
      postStateRoot,
      txRoot,
      txCount: txs.length,
      transactions: txs,
      receipts,
      timestamp: Date.now(),
      settlement: {
        status: 'PENDING',
      },
    };

    this.stateManager.persistBatch(batch);
    this.currentBatchId = batchId;
    return batch;
  }

  public getMempool(): ExJanAITransaction[] {
    return [...this.mempool];
  }

  public clearMempool(): void {
    this.mempool = [];
  }

  public getStateManager(): StateManager {
    return this.stateManager;
  }
}
