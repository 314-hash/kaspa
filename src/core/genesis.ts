import fs from 'node:fs';
import path from 'node:path';
import { StateManager } from './state.ts';
import { SparseMerkleTree } from './smt.ts';
import type { ExJanAIAccount } from '../types/index.ts';

export interface TokenAllocation {
  label: string;
  address: string;
  amount: string; // base units (with 18 decimals)
}

export interface GenesisConfig {
  network: string;
  chainId: number;
  nativeToken: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
  };
  allocations: TokenAllocation[];
  genesisTimestamp: number;
}

export class GenesisManager {
  /**
   * Load and validate genesis configuration from file or default object
   */
  public static loadConfig(configPath?: string): GenesisConfig {
    const resolvedPath = configPath || path.join(process.cwd(), 'config', 'genesis.json');
    if (fs.existsSync(resolvedPath)) {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      return JSON.parse(raw) as GenesisConfig;
    }

    // Default 100M EXJANAI fallback (100,000,000 * 10^18)
    const decimals = 18n;
    const oneHundredMillion = 100_000_000n * (10n ** decimals);

    return {
      network: 'exjanai-testnet',
      chainId: 1111,
      nativeToken: {
        name: 'Extropian Janus',
        symbol: 'EXJANAI',
        decimals: 18,
        totalSupply: oneHundredMillion.toString(),
      },
      allocations: [
        {
          label: 'Ecosystem & Faucet',
          address: '0x1111111111111111111111111111111111111111',
          amount: (40_000_000n * (10n ** decimals)).toString(),
        },
        {
          label: 'Protocol Treasury',
          address: '0x2222222222222222222222222222222222222222',
          amount: (30_000_000n * (10n ** decimals)).toString(),
        },
        {
          label: 'Settlement Liquidity Reserve',
          address: '0x3333333333333333333333333333333333333333',
          amount: (20_000_000n * (10n ** decimals)).toString(),
        },
        {
          label: 'Diagnostics Bounty',
          address: '0x4444444444444444444444444444444444444444',
          amount: (10_000_000n * (10n ** decimals)).toString(),
        },
      ],
      genesisTimestamp: 1729850000000,
    };
  }

  /**
   * Validates mathematical consistency of the 100M token supply
   */
  public static validateGenesis(config: GenesisConfig): { isValid: boolean; totalAllocated: bigint; expectedTotal: bigint; error?: string } {
    const expectedTotal = BigInt(config.nativeToken.totalSupply);
    let totalAllocated = 0n;

    for (const alloc of config.allocations) {
      if (!alloc.address.startsWith('0x') || alloc.address.length !== 42) {
        return { isValid: false, totalAllocated, expectedTotal, error: `Invalid allocation address: ${alloc.address}` };
      }
      const amount = BigInt(alloc.amount);
      if (amount <= 0n) {
        return { isValid: false, totalAllocated, expectedTotal, error: `Non-positive allocation for ${alloc.label}` };
      }
      totalAllocated += amount;
    }

    if (totalAllocated !== expectedTotal) {
      return {
        isValid: false,
        totalAllocated,
        expectedTotal,
        error: `Allocations sum (${totalAllocated}) does not equal total supply (${expectedTotal})`,
      };
    }

    return { isValid: true, totalAllocated, expectedTotal };
  }

  /**
   * Initializes a StateManager database with the verified 100M EXJANAI genesis state
   */
  public static initializeGenesisState(stateManager: StateManager, config?: GenesisConfig): { genesisRoot: string; accounts: Map<string, ExJanAIAccount> } {
    const genesisConfig = config || this.loadConfig();
    const validation = this.validateGenesis(genesisConfig);
    if (!validation.isValid) {
      throw new Error(`Genesis validation failed: ${validation.error}`);
    }

    const accountsMap = new Map<string, ExJanAIAccount>();

    for (const alloc of genesisConfig.allocations) {
      const account: ExJanAIAccount = {
        address: alloc.address.toLowerCase(),
        nonce: 0,
        balance: BigInt(alloc.amount),
        storageRoot: '0'.repeat(64),
        updatedAt: genesisConfig.genesisTimestamp,
      };
      stateManager.setAccount(account);
      accountsMap.set(account.address, account);
    }

    const genesisRoot = SparseMerkleTree.computeStateRoot(accountsMap);
    return { genesisRoot, accounts: accountsMap };
  }
}
