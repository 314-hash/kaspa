import { performance } from 'node:perf_hooks';
import { safeFetch, validateSafeTargetUrl } from './ssrf.ts';
import type { ChainCheckTarget, ProbeResult, LatencyBreakdown } from '../../types/index.ts';

export class KaspaProber {
  /**
   * Run full protocol-aware diagnostics on a Kaspa REST or RPC endpoint
   */
  public static async probeEndpoint(
    target: ChainCheckTarget,
    allowLocalhostForTesting: boolean = false
  ): Promise<ProbeResult> {
    const startTime = performance.now();
    const result: ProbeResult = {
      target,
      timestamp: Date.now(),
      isOnline: false,
      latency: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 0 },
      protocolDetails: {},
      reliabilityScore: 0,
    };

    try {
      // 1. Validate URL & DNS lookup
      const dnsStart = performance.now();
      const { safeUrl, resolvedIps } = await validateSafeTargetUrl(
        target.url,
        allowLocalhostForTesting
      );
      const dnsMs = Math.round(performance.now() - dnsStart);
      result.latency.dnsMs = dnsMs;
      result.protocolDetails.resolvedIps = resolvedIps;

      // 2. Query /info/blockdag
      const blockdagUrl = new URL('/info/blockdag', safeUrl).toString();
      const ttfbStart = performance.now();

      const res = await safeFetch(
        blockdagUrl,
        {
          timeoutMs: target.timeoutMs || 5000,
          allowLocalhostForTesting,
        },
        { headers: { Accept: 'application/json' } }
      );

      const totalMs = Math.round(performance.now() - startTime);
      const ttfbMs = Math.round(performance.now() - ttfbStart);

      result.latency.ttfbMs = ttfbMs;
      result.latency.totalMs = totalMs;
      result.statusCode = res.status;

      if (res.status === 200) {
        result.isOnline = true;
        const blockdagData = res.json<{
          networkName?: string;
          blockCount?: number;
          headerCount?: number;
          tipHashes?: string[];
          difficulty?: number;
          pastMedianTime?: number;
        }>();

        result.protocolDetails.networkName = blockdagData.networkName || 'unknown';
        result.protocolDetails.blockCount = blockdagData.blockCount || 0;
        result.protocolDetails.tipHashesCount = blockdagData.tipHashes?.length || 0;
        result.protocolDetails.difficulty = blockdagData.difficulty || 0;
        result.protocolDetails.pastMedianTime = blockdagData.pastMedianTime;

        // Verify expected network if specified
        if (target.expectedNetwork && blockdagData.networkName) {
          result.protocolDetails.networkMatch =
            blockdagData.networkName.toLowerCase() === target.expectedNetwork.toLowerCase();
        }

        // 3. Query /info/virtual-chain-blue-score
        try {
          const bsUrl = new URL('/info/virtual-chain-blue-score', safeUrl).toString();
          const bsRes = await safeFetch(bsUrl, { timeoutMs: 3000, allowLocalhostForTesting });
          if (bsRes.status === 200) {
            const bsData = bsRes.json<{ blueScore: number | string }>();
            result.protocolDetails.virtualBlueScore = bsData.blueScore;
          }
        } catch {
          // Non-fatal, continue
        }

        // 4. Query /info/fee-estimate
        try {
          const feeUrl = new URL('/info/fee-estimate', safeUrl).toString();
          const feeRes = await safeFetch(feeUrl, { timeoutMs: 3000, allowLocalhostForTesting });
          if (feeRes.status === 200) {
            const feeData = feeRes.json<{ priorityBucket?: { feerate?: number } }>();
            result.protocolDetails.feeRate = feeData.priorityBucket?.feerate || 1.0;
          }
        } catch {
          // Non-fatal, continue
        }
      } else {
        result.error = `HTTP status ${res.status}: ${res.text.slice(0, 100)}`;
      }
    } catch (err: unknown) {
      result.isOnline = false;
      result.latency.totalMs = Math.round(performance.now() - startTime);
      result.error = err instanceof Error ? err.message : String(err);
    }

    return result;
  }
}
