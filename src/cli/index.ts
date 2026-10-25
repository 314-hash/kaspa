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
      console.log(`  Balance: ${acc.balance.toString()} base units`);
      console.log(`  Nonce:   ${acc.nonce}`);
      console.log(`  Storage: ${acc.storageRoot}`);
      break;
    }

    case 'faucet': {
      const recipient = args[1];
      if (!recipient) {
        console.error('\x1b[31mError: Provide a recipient address (e.g. exjanai faucet 0x123...)\x1b[0m');
        process.exit(1);
      }
      const faucetAddr = '0x1111111111111111111111111111111111111111';
      const faucetAcc = state.getAccount(faucetAddr);
      const dispenseAmount = 1000n * (10n ** 18n);

      if (faucetAcc.balance < dispenseAmount) {
        console.error('\x1b[31mError: Faucet allocation exhausted\x1b[0m');
        process.exit(1);
      }

      const recipientAcc = state.getAccount(recipient);
      state.setAccount({
        ...faucetAcc,
        balance: faucetAcc.balance - dispenseAmount,
        nonce: faucetAcc.nonce + 1,
        updatedAt: Date.now(),
      });
      state.setAccount({
        ...recipientAcc,
        balance: recipientAcc.balance + dispenseAmount,
        updatedAt: Date.now(),
      });

      console.log(`\x1b[32m✔ Dispensed 1,000 EXJANAI to ${recipient}\x1b[0m`);
      console.log(`  New Recipient Balance: ${(recipientAcc.balance + dispenseAmount).toString()} base units`);
      break;
    }

    case 'mainnet-check': {
      const { MainnetPreflightChecker } = await import('../core/mainnet-readiness.ts');
      const operatorAddress = args[1]; // optional kaspa:q... address
      console.log('\x1b[34mℹ Running live pre-flight audit against Kaspa Mainnet (https://api.kaspa.org)...\x1b[0m\n');
      const report = await MainnetPreflightChecker.runCheck({ operatorAddress });

      console.log('\x1b[1m═══ KASPA MAINNET L1 CONNECTIVITY ═══\x1b[0m');
      console.log(`  Network:           \x1b[32m${report.networkDetails.networkName.toUpperCase()}\x1b[0m`);
      console.log(`  Virtual BlueScore: \x1b[36m${report.networkDetails.virtualBlueScore}\x1b[0m`);
      console.log(`  DAG Block Count:   ${report.networkDetails.blockCount}`);
      console.log(`  Current Fee Rate:  ${report.networkDetails.feeRateSompiPerGram} sompi/gram`);

      console.log('\n\x1b[1m═══ SETTLEMENT ANCHORING ECONOMICS ═══\x1b[0m');
      console.log(`  Binary Commitment Payload: ${report.settlementEconomics.batchPayloadSizeBytes} bytes`);
      console.log(`  Est. L1 Transaction Mass:  ${report.settlementEconomics.estimatedTxMassGrams} grams`);
      console.log(`  Cost Per Batch Settlement: \x1b[33m${report.settlementEconomics.costPerBatchCommitmentKas.toFixed(8)} KAS\x1b[0m`);
      console.log(`  Batches per 1 KAS:         \x1b[32m~${report.settlementEconomics.batchesPerSingleKas.toLocaleString()} batches\x1b[0m`);

      console.log('\n\x1b[1m═══ 100M EXJANAI GENESIS SPECIFICATION ═══\x1b[0m');
      console.log(`  Native Token:     ${report.genesisValidation.tokenSymbol}`);
      console.log(`  Total Supply:     ${report.genesisValidation.totalSupplyFormatted}`);
      console.log(`  Supply Conserved: \x1b[32m${report.genesisValidation.isSupplyConserved ? 'VERIFIED' : 'FAILED'}\x1b[0m`);
      console.log(`  Genesis Root R0:  ${report.genesisValidation.genesisStateRoot}`);

      console.log('\n\x1b[1m═══ READINESS CHECKLIST ═══\x1b[0m');
      for (const [k, v] of Object.entries(report.readinessChecklist)) {
        const icon = v ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[33m▲ PENDING\x1b[0m';
        console.log(`  ${k.padEnd(26)} : ${icon}`);
      }

      console.log(`\n\x1b[1mOverall Status:\x1b[0m \x1b[36m${report.overallStatus}\x1b[0m`);
      console.log('\x1b[1mRecommendations:\x1b[0m');
      for (const rec of report.recommendations) {
        console.log(`  • ${rec}`);
      }
      break;
    }

    default:
      console.log(`Available commands:`);
      console.log(`  exjanai keygen          Generate a new secp256k1 keypair`);
      console.log(`  exjanai status          Inspect L2 node status and Kaspa L1 anchor`);
      console.log(`  exjanai produce-batch   Aggregate mempool, prove, and settle batch on Kaspa L1`);
      console.log(`  exjanai account <addr>  Query account balance and nonce`);
      console.log(`  exjanai faucet <addr>   Dispense 1,000 EXJANAI testnet tokens`);
      console.log(`  exjanai mainnet-check   Run live pre-flight readiness audit against Kaspa Mainnet`);
      break;
  }
}

main().catch((err) => {
  console.error('\x1b[31mCLI Error:\x1b[0m', err.message);
  process.exit(1);
});
