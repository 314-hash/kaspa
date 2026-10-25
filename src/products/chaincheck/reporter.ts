import type { ProbeResult } from '../../types/index.ts';
import { ReliabilityEngine, type ReliabilityAnalysis } from './reliability.ts';

export interface ChainCheckReport {
  generatedAt: string;
  target: {
    name: string;
    protocol: string;
    url: string;
  };
  reliability: ReliabilityAnalysis;
  latestProbe: ProbeResult;
  historySummary: {
    totalSamples: number;
    uptimePercentage: number;
    latencyP50: number;
    latencyP95: number;
  };
}

export class ChainCheckReporter {
  public static buildReportData(samples: ProbeResult[]): ChainCheckReport {
    if (samples.length === 0) {
      throw new Error('Cannot build report: no probe samples provided');
    }

    const latest = samples[samples.length - 1];
    const reliability = ReliabilityEngine.calculateIndex(samples);

    return {
      generatedAt: new Date().toISOString(),
      target: {
        name: latest.target.name,
        protocol: latest.target.protocol,
        url: latest.target.url,
      },
      reliability,
      latestProbe: latest,
      historySummary: {
        totalSamples: samples.length,
        uptimePercentage: reliability.availabilityPct,
        latencyP50: reliability.p50LatencyMs,
        latencyP95: reliability.p95LatencyMs,
      },
    };
  }

  public static exportJson(samples: ProbeResult[]): string {
    const data = this.buildReportData(samples);
    return JSON.stringify(data, null, 2);
  }

  public static exportHtml(samples: ProbeResult[]): string {
    const data = this.buildReportData(samples);
    const scoreColor =
      data.reliability.score >= 85
        ? '#10b981'
        : data.reliability.score >= 70
        ? '#f59e0b'
        : '#ef4444';

    const recentSamplesRows = samples
      .slice(-10)
      .reverse()
      .map((s) => {
        const time = new Date(s.timestamp).toLocaleTimeString();
        const badge = s.isOnline
          ? '<span style="color:#10b981;font-weight:600;">ONLINE (200)</span>'
          : '<span style="color:#ef4444;font-weight:600;">OFFLINE</span>';
        return `
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #1f2937;">${time}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #1f2937;">${badge}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #1f2937;font-family:monospace;">${s.latency.totalMs} ms</td>
            <td style="padding:10px 14px;border-bottom:1px solid #1f2937;font-family:monospace;">${s.latency.dnsMs} ms</td>
            <td style="padding:10px 14px;border-bottom:1px solid #1f2937;color:#9ca3af;font-size:12px;">${s.error || 'None'}</td>
          </tr>
        `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extropian Janus — ChainCheck Report: ${data.target.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #160d38 0%, #060918 50%, #02040a 100%);
      background-attachment: fixed;
      color: #f3f4f6;
      font-family: 'Inter', -apple-system, sans-serif;
      padding: 36px 20px;
      line-height: 1.5;
    }
    .container { max-width: 920px; margin: 0 auto; }
    .motto-bar {
      text-align: center;
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: #94a3b8;
      padding-bottom: 20px;
      margin-bottom: 20px;
      border-bottom: 1px solid rgba(56, 189, 248, 0.2);
    }
    .motto-bar span {
      background: linear-gradient(90deg, #00f2fe, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 800;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 28px;
    }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .brand { font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 800; }
    .brand .b-ext { color: #ffffff; }
    .brand .b-jan {
      background: linear-gradient(135deg, #38bdf8, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-left: 4px;
    }
    .brand-sub { font-size: 12px; color: #70c7ba; font-family: 'Outfit', sans-serif; font-weight: 700; letter-spacing: 1px; }
    .badge-protocol {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #38bdf8;
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      padding: 5px 12px;
      border-radius: 9999px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .card {
      background: rgba(12, 19, 38, 0.75);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 14px;
      padding: 22px;
    }
    .card-title { font-family: 'Outfit', sans-serif; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px; }
    .card-value { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 800; color: #ffffff; }
    .score-circle {
      color: ${scoreColor};
      border: 3px solid ${scoreColor};
      border-radius: 50%;
      width: 76px;
      height: 76px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 26px;
      font-weight: 800;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
    }
    .recommendation-box {
      background: rgba(14, 23, 48, 0.85);
      border-left: 4px solid ${scoreColor};
      padding: 18px 20px;
      border-radius: 0 10px 10px 0;
      margin-bottom: 28px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { padding: 14px; background: rgba(15, 23, 42, 0.9); color: #94a3b8; font-family: 'Outfit', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid rgba(56, 189, 248, 0.2); }
    td { padding: 12px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
    .footer { margin-top: 36px; text-align: center; font-size: 12px; color: #64748b; font-family: 'Outfit', sans-serif; }
  </style>
</head>
<body>
  <div class="container">
    <div class="motto-bar">
      THE FUTURE IS NOT PREDICTED. <span>IT IS CREATED.</span> • CHAINCHECK RELIABILITY INTELLIGENCE
    </div>

    <div class="header">
      <div class="brand-wrap">
        <div>
          <div class="brand"><span class="b-ext">EXTROPIAN</span><span class="b-jan">JANUS</span></div>
          <div class="brand-sub">ExJanAI Blockchain • ChainCheck Diagnostics</div>
        </div>
      </div>
      <div style="text-align:right;">
        <span class="badge-protocol">${data.target.protocol}</span>
        <div style="font-size:12px;color:#64748b;margin-top:6px;font-family:monospace;">${data.generatedAt}</div>
      </div>
    </div>

    <div style="margin-bottom:24px;">
      <h1 style="font-family:'Outfit',sans-serif;font-size:26px;font-weight:800;letter-spacing:-0.5px;">${data.target.name}</h1>
      <p style="color:#38bdf8;font-family:'JetBrains Mono',monospace;font-size:13px;margin-top:4px;">${data.target.url}</p>
    </div>

    <div class="grid">
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div class="card-title">Reliability Index</div>
          <div style="font-size:14px;color:#9ca3af;">Tier <strong>${data.reliability.tier}</strong> (${data.reliability.status})</div>
        </div>
        <div class="score-circle">${data.reliability.score}</div>
      </div>

      <div class="card">
        <div class="card-title">Availability</div>
        <div class="card-value" style="color:#10b981;">${data.reliability.availabilityPct}%</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${data.reliability.sampleCount} total probes</div>
      </div>

      <div class="card">
        <div class="card-title">Median Latency (p50)</div>
        <div class="card-value">${data.reliability.p50LatencyMs}<span style="font-size:16px;font-weight:500;"> ms</span></div>
        <div style="font-size:12px;color:#9ca3af;margin-top:4px;">p95: ${data.reliability.p95LatencyMs} ms</div>
      </div>
    </div>

    <div class="recommendation-box">
      <div style="font-weight:700;color:#f3f4f6;margin-bottom:4px;">Diagnostic Assessment</div>
      <div style="color:#cbd5e1;font-size:14px;">${data.reliability.recommendation}</div>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #1f2937;font-weight:700;">Recent Diagnostic Probes</div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Health Status</th>
            <th>Latency (Total)</th>
            <th>DNS Time</th>
            <th>Notes / Error</th>
          </tr>
        </thead>
        <tbody>
          ${recentSamplesRows}
        </tbody>
      </table>
    </div>

    <div class="footer">
      Generated automatically by ExJanAI ChainCheck • Independent Kaspa L2 Diagnostics Engine
    </div>
  </div>
</body>
</html>`;
  }
}
