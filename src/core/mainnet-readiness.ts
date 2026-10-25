import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../products/chaincheck/ssrf.ts';
import { GenesisManager } from './genesis.ts';
import { encodeBatchCommitment } from './settlement.ts';
import { sha256 } from './crypto.ts';
import type { ExJanAIBatch } from '../types/index.ts';

export interface MainnetReadinessReport {
  timestamp: string;
  isMainnetReachable: boolean;
  networkDetails: {
    networkName: string;
    virtualBlueScore: number | string;
    blockCount: number;
    difficulty: number;
    tipCount: number;
    feeRateSompiPerGram: number;
  };
  settlementEconomics: {
    batchPayloadSizeBytes: number;
    estimatedTxMassGrams: number;
    costPerBatchCommitmentKas: number;
    batchesPerSingleKas: number;
  };
  genesisValidation: {
    tokenSymbol: string;
    totalSupplyFormatted: string;
    isSupplyConserved: boolean;
    genesisStateRoot: string;
  };
  operatorWalletStatus?: {
    address: string;
    balanceKas: number;
    utxoCount: number;
    isFundedForSettlement: boolean;
  };
  readinessChecklist: {
    l1Connectivity: boolean;
    l1FeeSanity: boolean;
    genesisSupplyVerified: boolean;
    mainnetPayloadCompliant: boolean;
    operatorFunded: boolean;
  };
  overallStatus: 'READY_FOR_MAINNET_ANCHORING' | 'CONFIG_REQUIRED' | 'OFFLINE';
  recommendations: string[];
}

export class MainnetPreflightChecker {
  /**
   * Run comprehensive pre-flight verification against Kaspa Mainnet
   */
  public static async runCheck(options: {
    rpcUrl?: string;
    operatorAddress?: string;
    genesisPath?: string;
  } = {}): Promise<MainnetReadinessReport> {
    const rpcUrl = options.rpcUrl || 'https://api.kaspa.org';
    const genesisPath = options.genesisPath || path.join(process.cwd(), 'config', 'genesis.json');
    const recommendations: string[] = [];

    // 1. Probe Live Kaspa Mainnet
    let isMainnetReachable = false;
    let networkDetails = {
      networkName: 'unknown',
      virtualBlueScore: 0 as number | string,
      blockCount: 0,
      difficulty: 0,
      tipCount: 0,
      feeRateSompiPerGram: 1.0,
    };

    try {
      const dagRes = await safeFetch(`${rpcUrl}/info/blockdag`, { timeoutMs: 6000 });
      if (dagRes.status === 200) {
        const dagData = dagRes.json<{
          networkName?: string;
          blockCount?: number;
          difficulty?: number;
          tipHashes?: string[];
        }>();
        isMainnetReachable = true;
        networkDetails.networkName = dagData.networkName || 'mainnet';
        networkDetails.blockCount = dagData.blockCount || 0;
        networkDetails.difficulty = dagData.difficulty || 0;
        networkDetails.tipCount = dagData.tipHashes?.length || 0;
      }

      // Fetch Blue Score
      const bsRes = await safeFetch(`${rpcUrl}/info/virtual-chain-blue-score`, { timeoutMs: 4000 });
      if (bsRes.status === 200) {
        const bsData = bsRes.json<{ blueScore: number | string }>();
        networkDetails.virtualBlueScore = bsData.blueScore;
      }

      // Fetch Fee Estimate
      const feeRes = await safeFetch(`${rpcUrl}/info/fee-estimate`, { timeoutMs: 4000 });
      if (feeRes.status === 200) {
        const feeData = feeRes.json<{ priorityBucket?: { feerate?: number } }>();
        networkDetails.feeRateSompiPerGram = feeData.priorityBucket?.feerate || 1.0;
      }
    } catch (err: unknown) {
      isMainnetReachable = false;
      recommendations.push(`Failed to connect to Kaspa mainnet RPC (${rpcUrl}): ${String(err)}`);
    }

    // 2. Settlement Economics & Mass Calculation
    const dummyBatch: ExJanAIBatch = {
      batchId: 1,
      preStateRoot: sha256('pre'),
      postStateRoot: sha256('post'),
      txRoot: sha256('tx'),
      txCount: 100,
      transactions: [],
      receipts: [],
      timestamp: Date.now(),
      settlement: { status: 'PENDING' },
    };
    const binaryPayload = encodeBatchCommitment(dummyBatch, BigInt(networkDetails.virtualBlueScore || 0));
    const payloadBytes = binaryPayload.length;
    // Standard Kaspa tx mass estimation: header (approx 1500) + payload mass (approx 4 mass per byte)
    const estimatedMass = 1500 + payloadBytes * 4;
    const sompiCost = estimatedMass * networkDetails.feeRateSompiPerGram;
    const costPerBatchCommitmentKas = sompiCost / 100_000_000;
    const batchesPerSingleKas = Math.floor(100_000_000 / sompiCost);

    // 3. Genesis Validation
    const genesisConfig = GenesisManager.loadConfig(genesisPath);
    const genesisVal = GenesisManager.validateGenesis(genesisConfig);

    // Compute Genesis State Root
    const genesisRoot = sha256(
      genesisConfig.allocations
        .map((a) => `${a.address}:${a.amount}`)
        .sort()
        .join('|')
    );

    // 4. Operator Wallet Check if provided
    let operatorStatus: MainnetReadinessReport['operatorWalletStatus'] | undefined;
    if (options.operatorAddress) {
      try {
        const balRes = await safeFetch(`${rpcUrl}/addresses/${options.operatorAddress}/balance`);
        if (balRes.status === 200) {
          const balData = balRes.json<{ balance?: number }>();
          const balanceSompi = balData.balance || 0;
          const balanceKas = balanceSompi / 100_000_000;
          operatorStatus = {
            address: options.operatorAddress,
            balanceKas,
            utxoCount: 1,
            isFundedForSettlement: balanceKas >= 1.0,
          };
          if (balanceKas < 1.0) {
            recommendations.push(`Operator address has only ${balanceKas.toFixed(4)} KAS. Recommended: >= 2.0 KAS for continuous anchoring.`);
          }
        }
      } catch {
        recommendations.push(`Could not query balance for operator address ${options.operatorAddress}`);
      }
    } else {
      recommendations.push('No mainnet operator address specified. Settlement will operate in simulation mode until configured.');
    }

    const checklist = {
      l1Connectivity: isMainnetReachable,
      l1FeeSanity: networkDetails.feeRateSompiPerGram > 0 && networkDetails.feeRateSompiPerGram <= 500,
      genesisSupplyVerified: genesisVal.isValid,
      mainnetPayloadCompliant: payloadBytes < 1000,
      operatorFunded: operatorStatus ? operatorStatus.isFundedForSettlement : false,
    };

    let overallStatus: MainnetReadinessReport['overallStatus'] = 'CONFIG_REQUIRED';
    if (!isMainnetReachable) {
      overallStatus = 'OFFLINE';
    } else if (checklist.l1Connectivity && checklist.genesisSupplyVerified && checklist.mainnetPayloadCompliant) {
      overallStatus = checklist.operatorFunded ? 'READY_FOR_MAINNET_ANCHORING' : 'CONFIG_REQUIRED';
    }

    if (checklist.operatorFunded) {
      recommendations.push('Operator wallet is funded. Live mainnet settlement anchoring can proceed upon command.');
    } else {
      recommendations.push('Fund the Kaspa mainnet operator address with 1 to 5 KAS to enable live on-chain anchoring.');
    }

    return {
      timestamp: new Date().toISOString(),
      isMainnetReachable,
      networkDetails,
      settlementEconomics: {
        batchPayloadSizeBytes: payloadBytes,
        estimatedTxMassGrams: estimatedMass,
        costPerBatchCommitmentKas,
        batchesPerSingleKas,
      },
      genesisValidation: {
        tokenSymbol: genesisConfig.nativeToken.symbol,
        totalSupplyFormatted: '100,000,000 EXJANAI',
        isSupplyConserved: genesisVal.isValid,
        genesisStateRoot: genesisRoot,
      },
      operatorWalletStatus: operatorStatus,
      readinessChecklist: checklist,
      overallStatus,
      recommendations,
    };
  }
}
