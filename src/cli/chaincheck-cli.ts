import fs from 'node:fs';
import { KaspaProber } from '../products/chaincheck/kaspa-prober.ts';
import { EvmProber } from '../products/chaincheck/evm-prober.ts';
import { ReliabilityEngine } from '../products/chaincheck/reliability.ts';
import { ChainCheckReporter } from '../products/chaincheck/reporter.ts';
import type { ChainCheckTarget, ProbeResult } from '../types/index.ts';

const BANNER = `
\x1b[36m╔═══════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m   \x1b[1m\x1b[37mCHAINCHECK\x1b[0m \x1b[35m[EXTROPIAN JANUS DIAGNOSTICS]\x1b[0m                            \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m   Protocol-Aware RPC & Infrastructure Reliability CLI                 \x1b[36m║\x1b[0m
\x1b[36m╚═══════════════════════════════════════════════════════════════════════╝\x1b[0m
`;

async function main() {
  console.log(BANNER);
  const args = process.argv.slice(2);
  const targetUrl = args[0] || 'https://api.kaspa.org';
  const format = args.includes('--json') ? 'json' : args.includes('--html') ? 'html' : 'cli';
  const isEvm = args.includes('--evm');

  const target: ChainCheckTarget = {
    name: 'Diagnostic Target',
    protocol: isEvm ? 'EVM_RPC' : 'KASPA_REST',
    url: targetUrl,
    timeoutMs: 5000,
  };

  console.log(`\x1b[34mℹ Initiating SSRF-guarded probe on:\x1b[0m ${target.url} [${target.protocol}]...`);

  let probe: ProbeResult;
  if (isEvm) {
    probe = await EvmProber.probeEndpoint(target, false);
  } else {
    probe = await KaspaProber.probeEndpoint(target, false);
  }

  if (probe.error && !probe.isOnline) {
    console.error(`\x1b[31m✖ Diagnostic probe failed:\x1b[0m ${probe.error}`);
    process.exit(1);
  }

  const analysis = ReliabilityEngine.calculateIndex([probe]);

  if (format === 'json') {
    console.log(ChainCheckReporter.exportJson([probe]));
    return;
  }

  if (format === 'html') {
    const html = ChainCheckReporter.exportHtml([probe]);
    const outFile = 'chaincheck_report.html';
    fs.writeFileSync(outFile, html, 'utf-8');
    console.log(`\x1b[32m✔ Standalone HTML diagnostic report exported to: ${outFile}\x1b[0m`);
    return;
  }

  // CLI output
  console.log(`\n\x1b[32m✔ Target is ONLINE (${probe.statusCode || 200})\x1b[0m`);
  console.log(`\x1b[1mLatency Telemetry:\x1b[0m`);
  console.log(`  DNS Resolution: ${probe.latency.dnsMs} ms`);
  console.log(`  Time to 1st Byte: ${probe.latency.ttfbMs} ms`);
  console.log(`  Total Response:   ${probe.latency.totalMs} ms`);

  console.log(`\n\x1b[1mReliability Index:\x1b[0m`);
  console.log(`  Score:            \x1b[36m${analysis.score}/100\x1b[0m (Tier \x1b[1m${analysis.tier}\x1b[0m - ${analysis.status})`);
  console.log(`  Recommendation:   ${analysis.recommendation}`);

  console.log(`\n\x1b[1mProtocol Specifics:\x1b[0m`);
  for (const [k, v] of Object.entries(probe.protocolDetails)) {
    console.log(`  ${k}: ${v}`);
  }
}

main().catch((err) => {
  console.error('\x1b[31mChainCheck Error:\x1b[0m', err.message);
  process.exit(1);
});
