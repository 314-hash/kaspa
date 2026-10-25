import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeBatchCommitment,
  decodeBatchCommitment,
  KaspaSimulatedNode,
  SettlementAdapter,
} from '../src/core/settlement.ts';
import { generateKeyPair, sha256 } from '../src/core/crypto.ts';
import type { ExJanAIBatch } from '../src/types/index.ts';

describe('ExJanAI Kaspa Settlement & L1 Adapter', () => {
  const operator = generateKeyPair();
  let simNode: KaspaSimulatedNode;
  let adapter: SettlementAdapter;

  const sampleBatch: ExJanAIBatch = {
    batchId: 42,
    preStateRoot: sha256('pre_root'),
    postStateRoot: sha256('post_root'),
    txRoot: sha256('tx_root'),
    txCount: 15,
    transactions: [],
    receipts: [],
    timestamp: Date.now(),
    settlement: {
      status: 'PENDING',
    },
  };

  beforeEach(() => {
    simNode = new KaspaSimulatedNode(operator.address);
    adapter = new SettlementAdapter({
      operatorAddress: operator.address,
      operatorPrivateKeyPem: operator.privateKey,
      confirmationDepth: 10,
      simulatedNode: simNode,
    });
  });

  test('Batch commitment binary encoding & decoding fidelity', () => {
    const blueScore = 125_450n;
    const encoded = encodeBatchCommitment(sampleBatch, blueScore, operator.privateKey);

    assert.ok(encoded.length >= 153, 'Encoded buffer must be at least 153 bytes');

    const decoded = decodeBatchCommitment(encoded);
    assert.equal(decoded.magic, 'EXJA');
    assert.equal(decoded.version, 1);
    assert.equal(decoded.batchId, 42);
    assert.equal(decoded.preStateRoot, sampleBatch.preStateRoot);
    assert.equal(decoded.postStateRoot, sampleBatch.postStateRoot);
    assert.equal(decoded.txRoot, sampleBatch.txRoot);
    assert.equal(decoded.txCount, 15);
    assert.equal(decoded.blueScore, blueScore);
    assert.ok(decoded.signatureHex.length > 0, 'Signature must be attached');
  });

  test('Settlement lifecycle: SUBMITTED -> INCLUDED -> SETTLED', async () => {
    const batch: ExJanAIBatch = { ...sampleBatch, settlement: { status: 'PENDING' } };

    // 1. Submit commitment to simulated Kaspa DAG
    const sub = await adapter.submitBatchCommitment(batch);
    assert.equal(sub.status, 'SUBMITTED');
    assert.ok(sub.l1TxId && sub.l1TxId.length === 64);
    assert.equal(batch.settlement.status, 'SUBMITTED');

    // 2. Advance 1 tick: transaction enters DAG block (INCLUDED)
    simNode.advanceDag(1);
    const status1 = await adapter.updateConfirmationStatus(batch);
    assert.equal(status1, 'INCLUDED');

    // 3. Advance until confirmationDepth (10 ticks) is achieved -> SETTLED
    simNode.advanceDag(10);
    const status2 = await adapter.updateConfirmationStatus(batch);
    assert.equal(status2, 'SETTLED');
    assert.ok(batch.settlement.confirmedAt! > 0);
  });

  test('Reorganization detection and handling', async () => {
    const batch: ExJanAIBatch = { ...sampleBatch, settlement: { status: 'PENDING' } };
    await adapter.submitBatchCommitment(batch);

    // Advance 2 ticks (tx confirmed in recent block)
    simNode.advanceDag(2);
    let status = await adapter.updateConfirmationStatus(batch);
    assert.equal(status, 'INCLUDED');

    // Inject DAG reorganization rolling back blue score by 10 ticks
    simNode.injectReorg(10);
    status = await adapter.updateConfirmationStatus(batch);
    // Detected eviction from virtual selected chain
    assert.equal(status, 'REORGANIZED');
  });

  test('Withdrawal queue unlocks upon batch settlement', async () => {
    const batch: ExJanAIBatch = { ...sampleBatch, batchId: 99, settlement: { status: 'PENDING' } };

    const withdrawal = adapter.queueWithdrawal({
      id: 'w-1',
      batchId: 99,
      l2Sender: '0xAlice',
      l1Recipient: 'kaspatest:qz123',
      amount: 10_000n,
    });

    assert.equal(withdrawal.status, 'PENDING_SETTLEMENT');

    await adapter.submitBatchCommitment(batch);
    simNode.advanceDag(12);
    await adapter.updateConfirmationStatus(batch);

    assert.equal(batch.settlement.status, 'SETTLED');
    const queue = adapter.getWithdrawalQueue();
    const updatedWithdrawal = queue.find((w) => w.id === 'w-1');
    assert.equal(updatedWithdrawal?.status, 'READY_FOR_CLAIM');
  });
});
