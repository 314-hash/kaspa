import { performance } from 'node:perf_hooks';
import { safeFetch, validateSafeTargetUrl } from './ssrf.ts';
import type { ChainCheckTarget, ProbeResult } from '../../types/index.ts';

export class EvmProber {
  /**
   * Run protocol-aware diagnostics on an EVM JSON-RPC endpoint
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
      // 1. DNS & SSRF Validation
      const dnsStart = performance.now();
      const { safeUrl, resolvedIps } = await validateSafeTargetUrl(
        target.url,
        allowLocalhostForTesting
      );
      result.latency.dnsMs = Math.round(performance.now() - dnsStart);
      result.protocolDetails.resolvedIps = resolvedIps;

      // 2. Query eth_blockNumber via JSON-RPC
      const rpcPayload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      });

      const ttfbStart = performance.now();
      const res = await safeFetch(
        safeUrl.toString(),
        {
          timeoutMs: target.timeoutMs || 5000,
          allowLocalhostForTesting,
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rpcPayload,
        }
      );

      result.latency.ttfbMs = Math.round(performance.now() - ttfbStart);
      result.latency.totalMs = Math.round(performance.now() - startTime);
      result.statusCode = res.status;

      if (res.status === 200) {
        const data = res.json<{ result?: string; error?: { message?: string } }>();
        if (data.error) {
          result.error = `RPC Error: ${data.error.message}`;
        } else if (data.result) {
          result.isOnline = true;
          const blockNumber = parseInt(data.result, 16);
          result.protocolDetails.blockNumber = isNaN(blockNumber) ? data.result : blockNumber;

          // 3. Query eth_chainId
          try {
            const chainRes = await safeFetch(
              safeUrl.toString(),
              { timeoutMs: 3000, allowLocalhostForTesting },
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 2 }),
              }
            );
            if (chainRes.status === 200) {
              const chainData = chainRes.json<{ result?: string }>();
              if (chainData.result) {
                result.protocolDetails.chainId = parseInt(chainData.result, 16);
              }
            }
          } catch {
            // Non-fatal
          }
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
