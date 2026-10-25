import type { ProbeResult } from '../../types/index.ts';

export interface ReliabilityAnalysis {
  score: number; // 0 - 100
  tier: 'A+' | 'A' | 'B' | 'C' | 'D';
  availabilityPct: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  sampleCount: number;
  consecutiveFailures: number;
  status: 'OPTIMAL' | 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  recommendation: string;
}

export class ReliabilityEngine {
  /**
   * Calculates a statistically sound reliability score over multiple samples.
   * Does NOT claim down on a single failed sample.
   */
  public static calculateIndex(samples: ProbeResult[]): ReliabilityAnalysis {
    if (samples.length === 0) {
      return {
        score: 0,
        tier: 'D',
        availabilityPct: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        sampleCount: 0,
        consecutiveFailures: 0,
        status: 'CRITICAL',
        recommendation: 'No samples collected yet for endpoint.',
      };
    }

    // 1. Availability calculation
    const successful = samples.filter((s) => s.isOnline);
    const availabilityRatio = successful.length / samples.length;
    const availabilityPct = Math.round(availabilityRatio * 100);

    // Track trailing consecutive failures
    let consecutiveFailures = 0;
    for (let i = samples.length - 1; i >= 0; i--) {
      if (!samples[i].isOnline) {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    // 2. Latency percentiles over successful runs
    const latencies = successful.map((s) => s.latency.totalMs).sort((a, b) => a - b);
    let p50LatencyMs = 0;
    let p95LatencyMs = 0;

    if (latencies.length > 0) {
      const idx50 = Math.floor(latencies.length * 0.5);
      const idx95 = Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1);
      p50LatencyMs = latencies[idx50];
      p95LatencyMs = latencies[idx95];
    }

    // 3. Weighted Scoring Components:
    // A. Availability Weight: 40 points
    const scoreAvail = availabilityRatio * 40;

    // B. Latency Weight: 30 points
    let scoreLatency = 0;
    if (latencies.length > 0) {
      if (p50LatencyMs <= 150) scoreLatency = 30;
      else if (p50LatencyMs <= 300) scoreLatency = 25;
      else if (p50LatencyMs <= 600) scoreLatency = 18;
      else if (p50LatencyMs <= 1200) scoreLatency = 10;
      else scoreLatency = 3;
    }

    // C. Error & Stability Weight: 20 points
    let scoreStability = 20;
    if (consecutiveFailures === 1) {
      scoreStability = 16; // Single transient fail drops only 4 points
    } else if (consecutiveFailures === 2) {
      scoreStability = 10;
    } else if (consecutiveFailures >= 3) {
      scoreStability = 0; // Sustained outage
    }

    // D. Protocol Data Quality Weight: 10 points
    let scoreQuality = 10;
    if (successful.length > 0) {
      const latestSuccess = successful[successful.length - 1];
      if (latestSuccess.target.protocol === 'KASPA_REST') {
        const tips = latestSuccess.protocolDetails.tipHashesCount as number | undefined;
        if (!tips || tips === 0) scoreQuality -= 5;
      }
    } else {
      scoreQuality = 0;
    }

    const totalScore = Math.max(0, Math.min(100, Math.round(scoreAvail + scoreLatency + scoreStability + scoreQuality)));

    // Tier assignment
    let tier: 'A+' | 'A' | 'B' | 'C' | 'D' = 'D';
    let status: 'OPTIMAL' | 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'CRITICAL';
    let recommendation = '';

    if (totalScore >= 95) {
      tier = 'A+';
      status = 'OPTIMAL';
      recommendation = 'Endpoint performance is optimal with exceptional latency and high availability.';
    } else if (totalScore >= 85) {
      tier = 'A';
      status = 'HEALTHY';
      recommendation = 'Endpoint is healthy and suitable for production settlement traffic.';
    } else if (totalScore >= 70) {
      tier = 'B';
      status = 'DEGRADED';
      recommendation = 'Occasional latency spikes or intermittent errors observed. Monitor closely.';
    } else if (totalScore >= 50) {
      tier = 'C';
      status = 'DEGRADED';
      recommendation = 'High error rate or severe latency. Not recommended for automated L2 settlement.';
    } else {
      tier = 'D';
      status = 'CRITICAL';
      recommendation = 'Endpoint has sustained failure or is unreachable. Failover recommended immediately.';
    }

    return {
      score: totalScore,
      tier,
      availabilityPct,
      p50LatencyMs,
      p95LatencyMs,
      sampleCount: samples.length,
      consecutiveFailures,
      status,
      recommendation,
    };
  }
}
