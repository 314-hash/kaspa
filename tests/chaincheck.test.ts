import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  isPrivateIPv4,
  isPrivateIPv6,
  validateSafeTargetUrl,
} from '../src/products/chaincheck/ssrf.ts';
import { ReliabilityEngine } from '../src/products/chaincheck/reliability.ts';
import { ChainCheckReporter } from '../src/products/chaincheck/reporter.ts';
import { ChainCheckStore } from '../src/products/chaincheck/store.ts';
import type { ProbeResult } from '../src/types/index.ts';

describe('ExJanAI ChainCheck Diagnostics & Security Suite', () => {
  test('SSRF Protection: strictly detects private and loopback IPv4/IPv6', () => {
    // Loopback
    assert.equal(isPrivateIPv4('127.0.0.1'), true);
    assert.equal(isPrivateIPv4('127.255.255.254'), true);
    // RFC 1918 Private
    assert.equal(isPrivateIPv4('10.0.0.1'), true);
    assert.equal(isPrivateIPv4('172.16.0.5'), true);
    assert.equal(isPrivateIPv4('172.31.255.255'), true);
    assert.equal(isPrivateIPv4('192.168.1.1'), true);
    // Link-local & CGNAT
    assert.equal(isPrivateIPv4('169.254.169.254'), true); // AWS/cloud metadata IP
    assert.equal(isPrivateIPv4('100.64.0.1'), true);
    // Public IPs must pass
    assert.equal(isPrivateIPv4('8.8.8.8'), false);
    assert.equal(isPrivateIPv4('1.1.1.1'), false);

    // IPv6 checks
    assert.equal(isPrivateIPv6('::1'), true);
    assert.equal(isPrivateIPv6('fc00::1'), true);
    assert.equal(isPrivateIPv6('fe80::1'), true);
  });

  test('SSRF Protection: blocks disallowed protocols and internal hostnames', async () => {
    // Disallowed protocols
    await assert.rejects(
      () => validateSafeTargetUrl('file:///etc/passwd'),
      /Disallowed protocol/
    );
    await assert.rejects(
      () => validateSafeTargetUrl('ftp://example.com'),
      /Disallowed protocol/
    );

    // Internal destinations
    await assert.rejects(
      () => validateSafeTargetUrl('http://localhost:8080'),
      /Internal or localhost/
    );
    await assert.rejects(
      () => validateSafeTargetUrl('http://127.0.0.1:17110'),
      /Internal or localhost/
    );
    await assert.rejects(
      () => validateSafeTargetUrl('http://service.internal'),
      /Internal or localhost/
    );
  });

  test('Reliability Index: does NOT mark down on a single failed probe', () => {
    const baseSample: ProbeResult = {
      target: { name: 'Kaspa Public', protocol: 'KASPA_REST', url: 'https://api.kaspa.org' },
      timestamp: Date.now(),
      isOnline: true,
      latency: { dnsMs: 10, tcpMs: 20, tlsMs: 15, ttfbMs: 80, totalMs: 125 },
      protocolDetails: { tipHashesCount: 2 },
      reliabilityScore: 0,
    };

    // 10 successful samples
    const samples: ProbeResult[] = Array.from({ length: 9 }, (_, i) => ({
      ...baseSample,
      timestamp: Date.now() - (9 - i) * 10000,
    }));

    // Inject 1 single failure
    samples.push({
      ...baseSample,
      isOnline: false,
      error: 'Transient socket timeout',
      latency: { dnsMs: 10, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 5000 },
    });

    const analysis = ReliabilityEngine.calculateIndex(samples);

    // Score must remain healthy (Tier A), not plummet to 0
    assert.ok(analysis.score >= 80, `Score should remain >= 80 on single failure, got ${analysis.score}`);
    assert.equal(analysis.availabilityPct, 90);
    assert.equal(analysis.consecutiveFailures, 1);
    assert.equal(analysis.status, 'HEALTHY');
  });

  test('Reliability Index: detects sustained critical failure', () => {
    const baseSample: ProbeResult = {
      target: { name: 'Failing Node', protocol: 'KASPA_REST', url: 'https://failing.node.org' },
      timestamp: Date.now(),
      isOnline: false,
      error: 'Connection refused',
      latency: { dnsMs: 5, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 1000 },
      protocolDetails: {},
      reliabilityScore: 0,
    };

    const samples: ProbeResult[] = Array.from({ length: 5 }, (_, i) => ({
      ...baseSample,
      timestamp: Date.now() - (5 - i) * 10000,
    }));

    const analysis = ReliabilityEngine.calculateIndex(samples);
    assert.ok(analysis.score < 50, 'Sustained failures must drop score below 50');
    assert.equal(analysis.tier, 'D');
    assert.equal(analysis.status, 'CRITICAL');
  });

  test('Reporter & SQLite Store integration', () => {
    const db = new DatabaseSync(':memory:');
    const store = new ChainCheckStore(db);

    const sample: ProbeResult = {
      target: { name: 'Kaspa Testnet 10', protocol: 'KASPA_REST', url: 'https://api-testnet-10.kaspa.org' },
      timestamp: Date.now(),
      isOnline: true,
      statusCode: 200,
      latency: { dnsMs: 15, tcpMs: 25, tlsMs: 20, ttfbMs: 90, totalMs: 150 },
      protocolDetails: { tipHashesCount: 1, virtualBlueScore: 120000 },
      reliabilityScore: 98,
    };

    store.recordProbe(sample);
    const retrieved = store.getRecentProbes(sample.target.url, 10);
    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0].target.name, 'Kaspa Testnet 10');
    assert.equal(retrieved[0].isOnline, true);

    // Export JSON report
    const jsonReport = ChainCheckReporter.exportJson(retrieved);
    assert.ok(jsonReport.includes('Kaspa Testnet 10'));
    assert.ok(jsonReport.includes('historySummary'));

    // Export HTML report
    const htmlReport = ChainCheckReporter.exportHtml(retrieved);
    assert.ok(htmlReport.includes('<!DOCTYPE html>'));
    assert.ok(htmlReport.includes('EXTROPIAN'));
    assert.ok(htmlReport.includes('Kaspa Testnet 10'));
  });
});
