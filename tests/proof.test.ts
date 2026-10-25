import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine, type PublicInputs } from '../src/core/proof.ts';
import { sha256 } from '../src/core/crypto.ts';
import type { ExJanAIBatch } from '../src/types/index.ts';

describe('ExJanAI Proof Engine & Verification Boundaries', () => {
  const publicInputs: PublicInputs = {
    batchId: 1,
    preStateRoot: sha256('root_pre'),
    postStateRoot: sha256('root_post'),
    txRoot: sha256('tx_merkle'),
    txCount: 3,
    timestamp: 1729000000000,
  };

  const sampleBatch: ExJanAIBatch = {
    ...publicInputs,
    transactions: [],
    receipts: [],
    settlement: { status: 'PENDING' },
  };

  test('Generates verifiable trace commitment proof for valid batch', async () => {
    const proof = await ProofEngine.generateTraceProof(sampleBatch, new Map());

    assert.equal(proof.proofType, 'TRACE_COMMITMENT_V1');
    assert.equal(proof.isMock, false);
    assert.equal(proof.proofData.length, 64);

    const verification = await ProofEngine.verifyProof(proof, publicInputs);
    assert.equal(verification.valid, true);
  });

  test('Rejects proof if postStateRoot does not match public inputs', async () => {
    const proof = await ProofEngine.generateTraceProof(sampleBatch, new Map());
    const tamperedInputs = {
      ...publicInputs,
      postStateRoot: sha256('forged_post_root'),
    };

    const verification = await ProofEngine.verifyProof(proof, tamperedInputs);
    assert.equal(verification.valid, false);
    assert.ok(verification.reason?.includes('Post-state root mismatch'));
  });

  test('Rejects proof if batch ID does not match', async () => {
    const proof = await ProofEngine.generateTraceProof(sampleBatch, new Map());
    const tamperedInputs = {
      ...publicInputs,
      batchId: 999,
    };

    const verification = await ProofEngine.verifyProof(proof, tamperedInputs);
    assert.equal(verification.valid, false);
    assert.ok(verification.reason?.includes('Batch ID mismatch'));
  });

  test('Mock proof is strictly rejected in standard verification mode', async () => {
    const mockProof = ProofEngine.generateMockProof(publicInputs);
    assert.equal(mockProof.isMock, true);
    assert.equal(mockProof.proofType, 'MOCK_TEST_VECTOR');

    const verification = await ProofEngine.verifyProof(mockProof, publicInputs, false);
    assert.equal(verification.valid, false);
    assert.ok(verification.reason?.includes('mock test vector'));
  });

  test('Mock proof only accepted in explicitly enabled test harness', async () => {
    const mockProof = ProofEngine.generateMockProof(publicInputs);
    const verification = await ProofEngine.verifyProof(mockProof, publicInputs, true);
    assert.equal(verification.valid, true);
  });
});
