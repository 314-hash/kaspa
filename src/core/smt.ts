import { sha256, sha256Buffer } from './crypto.ts';
import type { ExJanAIAccount } from '../types/index.ts';

export interface SMTProof {
  key: string;
  valueHash: string;
  siblings: string[];
  root: string;
}

/**
 * Deterministic State Root and Merkle Patricia / SMT generator for ExJanAI Blockchain
 */
export class SparseMerkleTree {
  /**
   * Compute deterministic hash for a single account leaf
   */
  public static hashAccount(account: ExJanAIAccount): string {
    const raw = `${account.address.toLowerCase()}:${account.nonce}:${account.balance.toString()}:${account.storageRoot}`;
    return sha256(raw);
  }

  /**
   * Compute deterministic state root across all active accounts
   */
  public static computeStateRoot(accounts: Map<string, ExJanAIAccount> | Record<string, ExJanAIAccount>): string {
    const entries = accounts instanceof Map ? Array.from(accounts.entries()) : Object.entries(accounts);

    if (entries.length === 0) {
      return sha256('EMPTY_EXJANAI_STATE_ROOT');
    }

    // Sort deterministically by address
    entries.sort(([addrA], [addrB]) => addrA.toLowerCase().localeCompare(addrB.toLowerCase()));

    // Generate leaf hashes
    const leafHashes = entries.map(([_, acc]) => this.hashAccount(acc));

    // Reduce via binary tree
    let currentLevel = leafHashes;
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = sha256Buffer(
          Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])
        );
        nextLevel.push(combined.toString('hex'));
      }
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  /**
   * Generate Merkle inclusion proof for a specific account
   */
  public static getInclusionProof(
    targetAddress: string,
    accounts: Map<string, ExJanAIAccount>
  ): SMTProof | null {
    const entries = Array.from(accounts.entries());
    entries.sort(([addrA], [addrB]) => addrA.toLowerCase().localeCompare(addrB.toLowerCase()));

    const targetIdx = entries.findIndex(
      ([addr]) => addr.toLowerCase() === targetAddress.toLowerCase()
    );
    if (targetIdx === -1) return null;

    const leafHashes = entries.map(([_, acc]) => this.hashAccount(acc));
    const siblings: string[] = [];
    let idx = targetIdx;
    let currentLevel = leafHashes;

    while (currentLevel.length > 1) {
      const isEven = idx % 2 === 0;
      const siblingIdx = isEven ? idx + 1 : idx - 1;

      if (siblingIdx < currentLevel.length) {
        siblings.push(currentLevel[siblingIdx]);
      } else {
        // odd element paired with itself
        siblings.push(currentLevel[idx]);
      }

      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = sha256Buffer(
          Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])
        );
        nextLevel.push(combined.toString('hex'));
      }

      idx = Math.floor(idx / 2);
      currentLevel = nextLevel;
    }

    return {
      key: targetAddress.toLowerCase(),
      valueHash: leafHashes[targetIdx],
      siblings,
      root: currentLevel[0],
    };
  }

  /**
   * Verify an inclusion proof against a known state root
   */
  public static verifyProof(proof: SMTProof, targetIndex: number, totalLeaves: number): boolean {
    let currentHash = proof.valueHash;
    let idx = targetIndex;

    for (const sibling of proof.siblings) {
      const isLeft = idx % 2 === 0;
      const left = isLeft ? currentHash : sibling;
      const right = isLeft ? sibling : currentHash;
      currentHash = sha256Buffer(
        Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])
      ).toString('hex');
      idx = Math.floor(idx / 2);
    }

    return currentHash === proof.root;
  }
}
