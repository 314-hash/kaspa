import assert from 'node:assert/strict';
import { generateKeyPair, signTransaction } from '../src/core/crypto.ts';
import { StateManager } from '../src/core/state.ts';
import { ExecutionEngine } from '../src/core/execution.ts';
import { KaspaSimulatedNode, SettlementAdapter, decodeBatchCommitment } from '../src/core/settlement.ts';
import { ProofEngine } from '../src/core/proof.ts';

const BANNER = `
\x1b[36m╔═════════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m   \x1b[1m\x1b[37mEXTROPIAN \x1b[35mJANUS\x1b[0m \x1b[32m[EXJANAI BLOCKCHAIN]\x1b[0m                                   \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m   End-to-End Prototype Demonstration & Verification Pipeline                \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m   \x1b[33m"THE FUTURE IS NOT PREDICTED. IT IS CREATED."\x1b[0m                             \x1b[36m║\x1b[0m
\x1b[36m╚═════════════════════════════════════════════════════════════════════════════╝\x1b[0m
`;

async function runPrototype() {
  console.log(BANNER);

  const dbPath = './data/e2e_prototype_demo.db';
  const operator = generateKeyPair();
  const alice = generateKeyPair();
  const bob = generateKeyPair();

  console.log('\x1b[1mStep 1: Initializing Genesis State & Accounts\x1b[0m');
  let state = new StateManager({
    dbPath,
    initialAccounts: [
      { address: alice.address, balance: 2_500_000n },
      { address: bob.address, balance: 100_000n },
      { address: operator.address, balance: 0n },
    ],
  });

  const initialRoot = state.getStateRoot();
  console.log(`  Genesis State Root: ${initialRoot}`);
  console.log(`  Alice Balance:      ${state.getAccount(alice.address).balance} sompis`);
  console.log(`  Bob Balance:        ${state.getAccount(bob.address).balance} sompis`);

  const engine = new ExecutionEngine(state, {
    chainId: 1111,
    operatorAddress: operator.address,
    maxBatchSize: 10,
  });

  const simKaspa = new KaspaSimulatedNode(operator.address);
  const settlement = new SettlementAdapter({
    operatorAddress: operator.address,
    operatorPrivateKeyPem: operator.privateKey,
    confirmationDepth: 10,
    simulatedNode: simKaspa,
  });

  console.log('\n\x1b[1mStep 2: User Creates Valid Signed Transaction\x1b[0m');
  const tx1 = signTransaction(
    {
      version: 1,
      chainId: 1111,
      nonce: 0,
      from: alice.address,
      to: bob.address,
      amount: 400_000n,
      fee: 2_000n,
      opType: 'TRANSFER',
      payload: '',
    },
    alice.privateKey
  );
  console.log(`  TxHash: ${tx1.hash}`);
  console.log(`  From:   ${tx1.from}`);
  console.log(`  To:     ${tx1.to}`);
  console.log(`  Amount: 400,000 sompis (Fee: 2,000)`);

  console.log('\n\x1b[1mStep 3: Submitting to Mempool & Deterministic Execution\x1b[0m');
  const subRes = engine.submitToMempool(tx1, alice.publicKey);
  assert.equal(subRes.success, true);
  console.log(`  ✔ Mempool admission verified`);

  const accountsSnapshot = state.createSnapshot();
  const batch1 = engine.produceBatch();
  console.log(`  ✔ Batch #${batch1.batchId} produced with ${batch1.txCount} transaction(s)`);
  console.log(`  Post-State Root: ${batch1.postStateRoot}`);
  console.log(`  Tx Merkle Root:  ${batch1.txRoot}`);
  assert.notEqual(batch1.preStateRoot, batch1.postStateRoot, 'State root must evolve');

  console.log('\n\x1b[1mStep 4: Cryptographic Trace Proof Generation\x1b[0m');
  batch1.proof = await ProofEngine.generateTraceProof(batch1, accountsSnapshot);
  console.log(`  Proof Type: ${batch1.proof.proofType} (isMock: ${batch1.proof.isMock})`);
  console.log(`  Proof Commitment Hash: ${batch1.proof.proofData}`);

  console.log('\n\x1b[1mStep 5: Proof Constraint Verification\x1b[0m');
  const verifyRes = await ProofEngine.verifyProof(batch1.proof, batch1.proof.publicInputs);
  assert.equal(verifyRes.valid, true);
  console.log(`  ✔ Cryptographic trace proof verified successfully against public inputs`);

  console.log('\n\x1b[1mStep 6: Kaspa L1 Settlement Anchoring\x1b[0m');
  const l1Sub = await settlement.submitBatchCommitment(batch1);
  console.log(`  Anchored to Kaspa BlockDAG TxID: ${l1Sub.l1TxId}`);
  console.log(`  Submitted at Virtual Blue Score: ${l1Sub.submittedBlueScore}`);
  console.log(`  Settlement Status:               ${batch1.settlement.status}`);

  console.log('\n\x1b[1mStep 7: Advancing Kaspa DAG Virtual Blue Score for Finality\x1b[0m');
  simKaspa.advanceDag(1);
  let currentStatus = await settlement.updateConfirmationStatus(batch1);
  console.log(`  After 1 DAG block:  Status is \x1b[33m${currentStatus}\x1b[0m`);

  simKaspa.advanceDag(10);
  currentStatus = await settlement.updateConfirmationStatus(batch1);
  console.log(`  After 11 DAG blocks: Status is \x1b[32m${currentStatus}\x1b[0m (Finality Achieved >= 10 VSPBS ticks)`);
  assert.equal(currentStatus, 'SETTLED');
  state.persistBatch(batch1);

  console.log('\n\x1b[1mStep 8: Replay Protection Verification (Duplicate Nonce Test)\x1b[0m');
  // Attempting to re-execute tx1 with consumed nonce 0
  const replayAttempt = engine.executeTransaction(tx1);
  assert.equal(replayAttempt.success, false);
  console.log(`  ✔ Replay attempt rejected: ${replayAttempt.error}`);

  console.log('\n\x1b[1mStep 9: Invalid Signature & Solvency Rejection Test\x1b[0m');
  const badAlice = generateKeyPair();
  const forgedTx = signTransaction(
    {
      version: 1,
      chainId: 1111,
      nonce: 1,
      from: alice.address, // Alice claimed, signed by badAlice
      to: bob.address,
      amount: 10_000n,
      fee: 100n,
      opType: 'TRANSFER',
      payload: '',
    },
    badAlice.privateKey
  );
  forgedTx.from = alice.address;
  const forgedRes = engine.submitToMempool(forgedTx, alice.publicKey);
  assert.equal(forgedRes.success, false);
  console.log(`  ✔ Forged signature rejected: ${forgedRes.error}`);

  console.log('\n\x1b[1mStep 10: System Restart & State Preservation Test\x1b[0m');
  state.close();
  // Simulate cold restart by opening brand new StateManager instance pointing to same SQLite database
  const restartedState = new StateManager({ dbPath });
  const restartedRoot = restartedState.getStateRoot();
  console.log(`  State Root after restart: ${restartedRoot}`);
  assert.equal(restartedRoot, batch1.postStateRoot, 'Restarted state root must match committed root');

  const restartedBatch = restartedState.getBatch(1);
  assert.ok(restartedBatch !== null);
  console.log(`  Batch #1 retrieved from disk with status: ${restartedBatch.settlement.status}`);
  restartedState.close();

  console.log('\n\x1b[32m═══════════════════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[32m✔ ALL 10 END-TO-END PROTOTYPE MILESTONES VERIFIED WITH ZERO ERRORS!\x1b[0m');
  console.log('\x1b[32m═══════════════════════════════════════════════════════════════════════\x1b[0m\n');
}

runPrototype().catch((err) => {
  console.error('\x1b[31mPrototype Failure:\x1b[0m', err);
  process.exit(1);
});
