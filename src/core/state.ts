import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { ExJanAIAccount, ExJanAIBatch } from '../types/index.ts';
import { SparseMerkleTree } from './smt.ts';

export interface StateManagerConfig {
  dbPath?: string; // ':memory:' or file path
  initialAccounts?: Array<{ address: string; balance: bigint }>;
}

export class StateManager {
  private db: DatabaseSync;
  private accounts: Map<string, ExJanAIAccount> = new Map();

  constructor(config: StateManagerConfig = {}) {
    const dbPath = config.dbPath || ':memory:';
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    this.loadAccounts();

    if (config.initialAccounts && config.initialAccounts.length > 0) {
      for (const init of config.initialAccounts) {
        if (!this.accounts.has(init.address.toLowerCase())) {
          this.setAccount({
            address: init.address.toLowerCase(),
            nonce: 0,
            balance: init.balance,
            storageRoot: '0'.repeat(64),
            updatedAt: Date.now(),
          });
        }
      }
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        address TEXT PRIMARY KEY,
        nonce INTEGER NOT NULL,
        balance TEXT NOT NULL,
        storage_root TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS batches (
        batch_id INTEGER PRIMARY KEY,
        pre_state_root TEXT NOT NULL,
        post_state_root TEXT NOT NULL,
        tx_root TEXT NOT NULL,
        tx_count INTEGER NOT NULL,
        raw_json TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        l1_tx_id TEXT,
        l1_blue_score INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        tx_hash TEXT PRIMARY KEY,
        batch_id INTEGER NOT NULL,
        tx_from TEXT NOT NULL,
        tx_to TEXT NOT NULL,
        amount TEXT NOT NULL,
        fee TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        op_type TEXT NOT NULL,
        status INTEGER NOT NULL,
        raw_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  private loadAccounts(): void {
    const stmt = this.db.prepare('SELECT * FROM accounts');
    const rows = stmt.all() as Array<{
      address: string;
      nonce: number;
      balance: string;
      storage_root: string;
      updated_at: number;
    }>;

    for (const row of rows) {
      this.accounts.set(row.address.toLowerCase(), {
        address: row.address.toLowerCase(),
        nonce: row.nonce,
        balance: BigInt(row.balance),
        storageRoot: row.storage_root,
        updatedAt: row.updated_at,
      });
    }
  }

  public getAccount(address: string): ExJanAIAccount {
    const key = address.toLowerCase();
    const existing = this.accounts.get(key);
    if (existing) {
      return { ...existing };
    }
    // Return empty account defaults
    return {
      address: key,
      nonce: 0,
      balance: 0n,
      storageRoot: '0'.repeat(64),
      updatedAt: Date.now(),
    };
  }

  public setAccount(account: ExJanAIAccount): void {
    const key = account.address.toLowerCase();
    this.accounts.set(key, { ...account });

    const stmt = this.db.prepare(`
      INSERT INTO accounts (address, nonce, balance, storage_root, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        nonce = excluded.nonce,
        balance = excluded.balance,
        storage_root = excluded.storage_root,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      key,
      account.nonce,
      account.balance.toString(),
      account.storageRoot,
      account.updatedAt
    );
  }

  public getAllAccounts(): Map<string, ExJanAIAccount> {
    return new Map(this.accounts);
  }

  public getStateRoot(): string {
    return SparseMerkleTree.computeStateRoot(this.accounts);
  }

  public createSnapshot(): Map<string, ExJanAIAccount> {
    const copy = new Map<string, ExJanAIAccount>();
    for (const [k, v] of this.accounts.entries()) {
      copy.set(k, { ...v });
    }
    return copy;
  }

  public restoreSnapshot(snapshot: Map<string, ExJanAIAccount>): void {
    this.accounts = new Map();
    this.db.exec('DELETE FROM accounts');
    for (const acc of snapshot.values()) {
      this.setAccount(acc);
    }
  }

  public persistBatch(batch: ExJanAIBatch): void {
    const stmt = this.db.prepare(`
      INSERT INTO batches (
        batch_id, pre_state_root, post_state_root, tx_root, tx_count,
        raw_json, settlement_status, l1_tx_id, l1_blue_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id) DO UPDATE SET
        raw_json = excluded.raw_json,
        settlement_status = excluded.settlement_status,
        l1_tx_id = excluded.l1_tx_id,
        l1_blue_score = excluded.l1_blue_score
    `);

    const serializeWithBigInt = (obj: unknown) =>
      JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

    stmt.run(
      batch.batchId,
      batch.preStateRoot,
      batch.postStateRoot,
      batch.txRoot,
      batch.txCount,
      serializeWithBigInt(batch),
      batch.settlement.status,
      batch.settlement.l1TxId || null,
      batch.settlement.l1BlueScore || null,
      batch.timestamp
    );

    const txStmt = this.db.prepare(`
      INSERT OR REPLACE INTO transactions (
        tx_hash, batch_id, tx_from, tx_to, amount, fee, nonce, op_type, status, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < batch.transactions.length; i++) {
      const tx = batch.transactions[i];
      const receipt = batch.receipts[i];
      txStmt.run(
        tx.hash || tx.signature,
        batch.batchId,
        tx.from.toLowerCase(),
        tx.to.toLowerCase(),
        tx.amount.toString(),
        tx.fee.toString(),
        tx.nonce,
        tx.opType,
        receipt ? receipt.status : 1,
        serializeWithBigInt(tx),
        batch.timestamp
      );
    }
  }

  public getBatch(batchId: number): ExJanAIBatch | null {
    const stmt = this.db.prepare('SELECT raw_json FROM batches WHERE batch_id = ?');
    const row = stmt.get(batchId) as { raw_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.raw_json) as ExJanAIBatch;
  }

  public getLatestBatch(): ExJanAIBatch | null {
    const stmt = this.db.prepare('SELECT raw_json FROM batches ORDER BY batch_id DESC LIMIT 1');
    const row = stmt.get() as { raw_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.raw_json) as ExJanAIBatch;
  }

  public getAllBatches(): ExJanAIBatch[] {
    const stmt = this.db.prepare('SELECT raw_json FROM batches ORDER BY batch_id ASC');
    const rows = stmt.all() as Array<{ raw_json: string }>;
    return rows.map((r) => JSON.parse(r.raw_json) as ExJanAIBatch);
  }

  public getTransaction(txHash: string): { tx: ExJanAITransaction; batchId: number; status: number } | null {
    const stmt = this.db.prepare('SELECT raw_json, batch_id, status FROM transactions WHERE tx_hash = ?');
    const row = stmt.get(txHash) as { raw_json: string; batch_id: number; status: number } | undefined;
    if (!row) return null;
    return {
      tx: JSON.parse(row.raw_json) as ExJanAITransaction,
      batchId: row.batch_id,
      status: row.status,
    };
  }

  public close(): void {
    this.db.close();
  }
}
