import { VERIFIED_SEED_DATA } from '../products/intelligence/collector.ts';

const BANNER = `
\x1b[36m╔═══════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m   \x1b[1m\x1b[37mEXJANAI INTELLIGENCE\x1b[0m \x1b[35m[EXTROPIAN JANUS MONITOR]\x1b[0m                      \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m   Upstream Kaspa KIPs, Releases, & ZK Research Feed                   \x1b[36m║\x1b[0m
\x1b[36m╚═══════════════════════════════════════════════════════════════════════╝\x1b[0m
`;

async function main() {
  console.log(BANNER);
  const args = process.argv.slice(2);
  const filterCat = args[0] ? args[0].toUpperCase() : undefined;

  let items = VERIFIED_SEED_DATA;
  if (filterCat) {
    items = items.filter((i) => i.category === filterCat);
  }

  console.log(`\x1b[1mTracked Upstream Intelligence Items (${items.length}):\x1b[0m\n`);

  for (const item of items) {
    console.log(`\x1b[36m[${item.category}]\x1b[0m \x1b[1m${item.title}\x1b[0m (\x1b[32m${item.repository}\x1b[0m)`);
    console.log(`  \x1b[33mSummary:\x1b[0m ${item.summary}`);
    console.log(`  \x1b[34mURL:\x1b[0m     ${item.url}`);
    console.log(`  \x1b[90mDate:    ${item.publishedAt} | Verified Upstream: ${item.isVerifiedUpstream}\x1b[0m\n`);
  }
}

main().catch(console.error);
