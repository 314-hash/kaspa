import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  IntelligenceCollector,
  VERIFIED_SEED_DATA,
  TRACKED_REPOSITORIES,
} from '../src/products/intelligence/collector.ts';
import { IntelligenceStore } from '../src/products/intelligence/store.ts';

describe('ExJanAI Intelligence & Repository Monitoring Suite', () => {
  test('Seed dataset includes all mandated KIPs and upstream repositories', () => {
    const kipTitles = VERIFIED_SEED_DATA.filter((i) => i.category === 'KIP').map((i) => i.title);

    assert.ok(kipTitles.some((t) => t.includes('KIP-0016')), 'Must include KIP-16');
    assert.ok(kipTitles.some((t) => t.includes('KIP-0017')), 'Must include KIP-17');
    assert.ok(kipTitles.some((t) => t.includes('KIP-0020')), 'Must include KIP-20');
    assert.ok(kipTitles.some((t) => t.includes('KIP-0021')), 'Must include KIP-21');
    assert.ok(kipTitles.some((t) => t.includes('KIP-0024')), 'Must include KIP-24');
    assert.ok(kipTitles.some((t) => t.includes('KIP-0025')), 'Must include KIP-25');

    // Check upstream tracked repositories
    assert.ok(TRACKED_REPOSITORIES.includes('kaspanet/rusty-kaspa'));
    assert.ok(TRACKED_REPOSITORIES.includes('kaspanet/kips'));
    assert.ok(TRACKED_REPOSITORIES.includes('kaspanet/silverscript'));
    assert.ok(TRACKED_REPOSITORIES.includes('kaspanet/vprogs'));
    assert.ok(TRACKED_REPOSITORIES.includes('kaspa-ng/kaspa-rest-server'));
    assert.ok(TRACKED_REPOSITORIES.includes('kaspa-ng/kaspa-explorer'));
    assert.ok(TRACKED_REPOSITORIES.includes('risc0/risc0'));
  });

  test('All items preserve original URLs, timestamps, and verified upstream flag', () => {
    for (const item of VERIFIED_SEED_DATA) {
      assert.ok(item.url.startsWith('https://github.com/'), `URL must be a valid GitHub link: ${item.url}`);
      assert.ok(item.publishedAt.length > 0, 'Published timestamp must be set');
      assert.equal(item.isVerifiedUpstream, true, 'Upstream seed must be verified');
    }
  });

  test('IntelligenceStore: upsert, query by category, deduplication', () => {
    const db = new DatabaseSync(':memory:');
    const store = new IntelligenceStore(db);

    for (const item of VERIFIED_SEED_DATA) {
      store.upsertItem(item);
    }

    assert.equal(store.getCount(), VERIFIED_SEED_DATA.length);

    // Filter by KIP category
    const kips = store.getFeed({ category: 'KIP' });
    assert.equal(kips.length, 6);

    // Filter by repository
    const rustyItems = store.getFeed({ repository: 'kaspanet/rusty-kaspa' });
    assert.ok(rustyItems.length >= 1);

    // Deduplication test
    const duplicate = { ...VERIFIED_SEED_DATA[0], summary: 'Updated summary note' };
    store.upsertItem(duplicate);
    assert.equal(store.getCount(), VERIFIED_SEED_DATA.length, 'Upserting duplicate ID must not increase count');

    const updated = store.getFeed({ limit: 1 })[0];
    assert.ok(updated !== undefined);
  });
});
