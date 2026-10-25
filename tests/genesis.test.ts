import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GenesisManager, type GenesisConfig } from '../src/core/genesis.ts';
import { StateManager } from '../src/core/state.ts';

describe('ExJanAI 100M Native Token Genesis Minting Logic', () => {
  test('Genesis configuration defines exactly 100M EXJANAI with 18 decimals', () => {
    const config = GenesisManager.loadConfig();

    assert.equal(config.nativeToken.symbol, 'EXJANAI');
    assert.equal(config.nativeToken.decimals, 18);

    const expected100M = 100_000_000n * (10n ** 18n);
    assert.equal(BigInt(config.nativeToken.totalSupply), expected100M);

    const validation = GenesisManager.validateGenesis(config);
    assert.equal(validation.isValid, true);
    assert.equal(validation.totalAllocated, expected100M);
  });

  test('Rejects genesis if allocations do not sum to total supply', () => {
    const config = GenesisManager.loadConfig();
    const tampered: GenesisConfig = {
      ...config,
      allocations: [
        ...config.allocations,
        {
          label: 'Rogue Allocation',
          address: '0x9999999999999999999999999999999999999999',
          amount: '1000', // extra units
        },
      ],
    };

    const validation = GenesisManager.validateGenesis(tampered);
    assert.equal(validation.isValid, false);
    assert.ok(validation.error?.includes('does not equal total supply'));
  });

  test('Initializes state manager with deterministic genesis state root', () => {
    const stateManager = new StateManager({ dbPath: ':memory:' });
    const { genesisRoot, accounts } = GenesisManager.initializeGenesisState(stateManager);

    assert.ok(genesisRoot && genesisRoot.length === 64);
    assert.equal(accounts.size, 4);

    // Verify balances in SQLite state
    const faucet = stateManager.getAccount('0x1111111111111111111111111111111111111111');
    assert.equal(faucet.balance, 40_000_000n * (10n ** 18n));
    assert.equal(faucet.nonce, 0);

    const stateRootFromDb = stateManager.getStateRoot();
    assert.equal(stateRootFromDb, genesisRoot);
  });
});
