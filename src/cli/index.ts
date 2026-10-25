import { generateKeyPair, deriveAddress, signTransaction } from '../core/crypto.ts';
import { StateManager } from '../core/state.ts';
import { ExecutionEngine } from '../core/execution.ts';
import { KaspaSimulatedNode, SettlementAdapter } from '../core/settlement.ts';
import { ProofEngine } from '../core/proof.ts';

const BANNER = `
\x1b[36m╔═══════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m   \x1b[1m\x1b[37mEXTROPIAN \x1b[35mJANUS\x1b[0m \x1b[32m[EXJANAI BLOCKCHAIN]\x1b[0m                             \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m   Proposed Kaspa-Integrated Layer 2 Architecture & CLI               \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m   \x1b[33m"THE FUTURE IS NOT PREDICTED. IT IS CREATED."\x1b[0m                      \x1b[36m║\x1b[0m
\x1b[36m╚═══════════════════════════════════════════════════════════════════════╝\x1b[0m
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  console.log(BANNER);

  const state = new StateManager({ dbPath: './data/exjanai.db' });
  const operator = generateKeyPair();
  const engine = new ExecutionEngine(state, { chainId: 1111, operatorAddress: operator.address });
  const simNode = new KaspaSimulatedNode(operator.address);
  const adapter = new SettlementAdapter({
    operatorAddress: operator.address,
    operatorPrivateKeyPem: operator.privateKey,
    simulatedNode: simNode,
  });

  switch (command) {
    case 'keygen': {
      const keys = generateKeyPair();
      console.log('\x1b[32m✔ Generated New Extropian Janus secp256k1 Keypair:\x1b[0m');
      console.log(`  \x1b[1mAddress:\x1b[0m      ${keys.address}`);
      console.log(`  \x1b[1mPublic Key:\x1b[0m   ${keys.publicKey.replace(/\n/g, '')}`);
      console.log('\n\x1b[33mPrivate Key (Keep Confidential):\x1b[0m');
      console.log(keys.privateKey);
      break;
    }

    case 'status': {
      const stateRoot = state.getStateRoot();
      const latest = state.getLatestBatch();
      const blueScore = simNode.getVirtualChainBlueScore().blueScore;

      console.log('\x1b[1mNetwork Status:\x1b[0m');
      console.log(`  Chain ID:            1111 (ExJanAI L2 Testnet)`);
      console.log(`  State Root:          ${stateRoot}`);
      console.log(`  Latest Batch:        #${latest ? latest.batchId : 0}`);
      console.log(`  Mempool Pending:     ${engine.getMempool().length} transactions`);
      console.log(`  Kaspa L1 Settlement: ${simNode.networkName} (VSPBS: ${blueScore})`);
      break;
    }

    case 'produce-batch': {
      console.log('\x1b[34mℹ Aggregating mempool transactions into new batch...\x1b[0m');
      const accountsBefore = state.createSnapshot();
      const batch = engine.produceBatch();
      console.log(`✔ Batch #${batch.batchId} created with ${batch.txCount} transactions.`);

      console.log('\x1b[34mℹ Generating cryptographic trace proof...\x1b[0m');
      batch.proof = await ProofEngine.generateTraceProof(batch, accountsBefore);
      console.log(`✔ Proof commitment generated: ${batch.proof.proofData.slice(0, 16)}...`);

      console.log('\x1b[34mℹ Committing batch to Kaspa L1 Settlement Adapter...\x1b[0m');
      const sub = await adapter.submitBatchCommitment(batch);
      console.log(`✔ Anchored onto Kaspa L1 (TxID: ${sub.l1TxId.slice(0, 20)}..., BlueScore: ${sub.submittedBlueScore})`);

      simNode.advanceDag(11);
      const status = await adapter.updateConfirmationStatus(batch);
      state.persistBatch(batch);
      console.log(`\x1b[32m✔ Settlement Status: ${status} (Confirmed with >= 10 VSPBS ticks)\x1b[0m`);
      break;
    }

    case 'account': {
      const address = args[1];
      if (!address) {
        console.error('\x1b[31mError: Provide an address (e.g. exjanai account 0x123...)\x1b[0m');
        process.exit(1);
      }
      const acc = state.getAccount(address);
      console.log(`\x1b[1mAccount Details for ${address}:\x1b[0m`);
      console.log(`  Balance: ${acc.balance.toString()} sompi-equivalent`);
      console.log(`  Nonce:   ${acc.nonce}`);
      console.log(`  Storage: ${acc.storageRoot}`);
      break;
    }

    default:
      console.log(`Available commands:`);
      console.log(`  exjanai keygen          Generate a new secp256k1 keypair`);
      console.log(`  exjanai status          Inspect L2 node status and Kaspa L1 anchor`);
      console.log(`  exjanai produce-batch   Aggregate mempool, prove, and settle batch on Kaspa L1`);
      console.log(`  exjanai account <addr>  Query account balance and nonce`);
      break;
  }
}

main().catch((err) => {
  console.error('\x1b[31mCLI Error:\x1b[0m', err.message);
  process.exit(1);
});
