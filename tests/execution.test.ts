import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/core/state.ts';
import { ExecutionEngine } from '../src/core/execution.ts';
import { generateKeyPair, signTransaction, hashTransaction } from '../src/core/crypto.ts';
import { SparseMerkleTree } from '../src/core/smt.ts';
import type { ExJanAITransaction } from '../src/types/index.ts';

describe('ExJanAI Deterministic Execution & State Engine', () => {
  let stateManager: StateManager;
  let engine: ExecutionEngine;
  const operator = generateKeyPair();
  const alice = generateKeyPair();
  const bob = generateKeyPair();

  beforeEach(() => {
    stateManager = new StateManager({
      dbPath: ':memory:',
      initialAccounts: [
        { address: alice.address, balance: 1_000_000n },
        { address: bob.address, balance: 100_000n },
        { address: operator.address, balance: 0n },
      ],
    });

    engine = new ExecutionEngine(stateManager, {
      chainId: 1111,
      operatorAddress: operator.address,
      maxBatchSize: 10,
    });
  });

  test('Deterministic execution of valid transfer', () => {
    const preRoot = stateManager.getStateRoot();
    assert.ok(preRoot && preRoot.length === 64, 'Initial state root must be 32 bytes hex');

    const unsignedTx = {
      version: 1,
      chainId: 1111,
      nonce: 0,
      from: alice.address,
      to: bob.address,
      amount: 50_000n,
      fee: 1_000n,
      opType: 'TRANSFER' as const,
      payload: '',
    };

    const signedTx = signTransaction(unsignedTx, alice.privateKey);
    const result = engine.executeTransaction(signedTx);

    assert.equal(result.success, true);
    assert.equal(result.receipt.status, 1);

    const updatedAlice = stateManager.getAccount(alice.address);
    const updatedBob = stateManager.getAccount(bob.address);
    const updatedOp = stateManager.getAccount(operator.address);

    assert.equal(updatedAlice.balance, 1_000_000n - 51_000n);
    assert.equal(updatedAlice.nonce, 1);
    assert.equal(updatedBob.balance, 100_000n + 50_000n);
    assert.equal(updatedOp.balance, 1_000n);

    const postRoot = stateManager.getStateRoot();
    assert.notEqual(preRoot, postRoot, 'State root must deterministically evolve after execution');
  });

  test('Strict nonce replay protection: repeated nonce must be rejected', () => {
    const unsignedTx = {
      version: 1,
      chainId: 1111,
      nonce: 0,
      from: alice.address,
      to: bob.address,
      amount: 10_000n,
      fee: 500n,
      opType: 'TRANSFER' as const,
      payload: '',
    };

    const signedTx = signTransaction(unsignedTx, alice.privateKey);

    // First execution succeeds
    const res1 = engine.executeTransaction(signedTx);
    assert.equal(res1.success, true);

    // Second execution with identical nonce MUST fail
    const res2 = engine.executeTransaction(signedTx);
    assert.equal(res2.success, false);
    assert.ok(res2.error?.includes('Nonce mismatch'), 'Must reject repeated nonce');

    // Mempool submission must also reject consumed nonce
    const mempoolRes = engine.submitToMempool(signedTx);
    assert.equal(mempoolRes.success, false);
    assert.ok(mempoolRes.error?.includes('Transaction replay rejected'));
  });

  test('Solvency check: transaction requiring more than account balance fails', () => {
    const excessiveTx = {
      version: 1,
      chainId: 1111,
      nonce: 0,
      from: alice.address,
      to: bob.address,
      amount: 2_000_000n, // Alice only has 1,000,000
      fee: 1_000n,
      opType: 'TRANSFER' as const,
      payload: '',
    };

    const signedTx = signTransaction(excessiveTx, alice.privateKey);
    const result = engine.executeTransaction(signedTx);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Insufficient balance'));

    // Verify Alice balance and nonce did not mutate
    const aliceAccount = stateManager.getAccount(alice.address);
    assert.equal(aliceAccount.balance, 1_000_000n);
    assert.equal(aliceAccount.nonce, 0);
  });

  test('Invalid signature rejection', () => {
    const impostor = generateKeyPair();
    const forgedTx: ExJanAITransaction = {
      version: 1,
      chainId: 1111,
      nonce: 0,
      from: alice.address, // Alice claimed as sender
      to: bob.address,
      amount: 10_000n,
      fee: 500n,
      opType: 'TRANSFER',
      payload: '',
      signature: '',
    };

    // Signed with impostor private key instead of Alice's
    const forgedSignedTx = signTransaction(forgedTx, impostor.privateKey);
    // Force sender to Alice
    forgedSignedTx.from = alice.address;

    const submission = engine.submitToMempool(forgedSignedTx, alice.publicKey);
    assert.equal(submission.success, false);
    assert.ok(submission.error?.includes('signature verification failed'));
  });

  test('Sparse Merkle Tree: inclusion proof verification', () => {
    const accounts = stateManager.getAllAccounts();
    const root = stateManager.getStateRoot();

    const proof = SparseMerkleTree.getInclusionProof(alice.address, accounts);
    assert.ok(proof !== null, 'Proof must exist for Alice');
    assert.equal(proof.root, root, 'Proof root must match state root');

    const totalLeaves = accounts.size;
    const entries = Array.from(accounts.entries()).sort(([a], [b]) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    const aliceIdx = entries.findIndex(([a]) => a.toLowerCase() === alice.address.toLowerCase());

    const isValid = SparseMerkleTree.verifyProof(proof, aliceIdx, totalLeaves);
    assert.equal(isValid, true, 'Inclusion proof must verify');
  });

  test('Batch production and atomic state persistence', () => {
    const tx1 = signTransaction(
      {
        version: 1,
        chainId: 1111,
        nonce: 0,
        from: alice.address,
        to: bob.address,
        amount: 25_000n,
        fee: 100n,
        opType: 'TRANSFER',
        payload: '',
      },
      alice.privateKey
    );

    const tx2 = signTransaction(
      {
        version: 1,
        chainId: 1111,
        nonce: 1,
        from: alice.address,
        to: bob.address,
        amount: 15_000n,
        fee: 100n,
        opType: 'TRANSFER',
        payload: '',
      },
      alice.privateKey
    );

    engine.submitToMempool(tx1);
    engine.submitToMempool(tx2);

    const batch = engine.produceBatch();
    assert.equal(batch.batchId, 1);
    assert.equal(batch.txCount, 2);
    assert.equal(batch.receipts.length, 2);
    assert.equal(batch.receipts[0].status, 1);
    assert.equal(batch.receipts[1].status, 1);

    // Verify stored in DB
    const savedBatch = stateManager.getBatch(1);
    assert.ok(savedBatch !== null);
    assert.equal(savedBatch.postStateRoot, batch.postStateRoot);
    assert.equal(savedBatch.txRoot, batch.txRoot);
  });
});
