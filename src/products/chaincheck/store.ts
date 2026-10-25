import { DatabaseSync } from 'node:sqlite';
import type { ProbeResult } from '../../types/index.ts';

export class ChainCheckStore {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chaincheck_probes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        url TEXT NOT NULL,
        is_online INTEGER NOT NULL,
        status_code INTEGER,
        latency_total_ms INTEGER NOT NULL,
        latency_dns_ms INTEGER NOT NULL,
        latency_ttfb_ms INTEGER NOT NULL,
        protocol_details_json TEXT NOT NULL,
        error_msg TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_probes_url ON chaincheck_probes(url);
      CREATE INDEX IF NOT EXISTS idx_probes_time ON chaincheck_probes(created_at);
    `);
  }

  public recordProbe(result: ProbeResult): void {
    const stmt = this.db.prepare(`
      INSERT INTO chaincheck_probes (
        target_name, protocol, url, is_online, status_code,
        latency_total_ms, latency_dns_ms, latency_ttfb_ms,
        protocol_details_json, error_msg, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      result.target.name,
      result.target.protocol,
      result.target.url,
      result.isOnline ? 1 : 0,
      result.statusCode || null,
      result.latency.totalMs,
      result.latency.dnsMs,
      result.latency.ttfbMs,
      JSON.stringify(result.protocolDetails),
      result.error || null,
      result.timestamp
    );
  }

  public getRecentProbes(url: string, limit: number = 50): ProbeResult[] {
    const stmt = this.db.prepare(`
      SELECT * FROM chaincheck_probes
      WHERE url = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(url, limit) as Array<{
      target_name: string;
      protocol: string;
      url: string;
      is_online: number;
      status_code: number | null;
      latency_total_ms: number;
      latency_dns_ms: number;
      latency_ttfb_ms: number;
      protocol_details_json: string;
      error_msg: string | null;
      created_at: number;
    }>;

    // Convert back to chronological order (oldest to newest)
    return rows.reverse().map((r) => ({
      target: {
        name: r.target_name,
        protocol: r.protocol as any,
        url: r.url,
      },
      timestamp: r.created_at,
      isOnline: r.is_online === 1,
      statusCode: r.status_code || undefined,
      latency: {
        dnsMs: r.latency_dns_ms,
        tcpMs: 0,
        tlsMs: 0,
        ttfbMs: r.latency_ttfb_ms,
        totalMs: r.latency_total_ms,
      },
      protocolDetails: JSON.parse(r.protocol_details_json),
      reliabilityScore: 0,
      error: r.error_msg || undefined,
    }));
  }

  public getAllMonitoredTargets(): Array<{ name: string; url: string; protocol: string; lastSeen: number }> {
    const stmt = this.db.prepare(`
      SELECT target_name, url, protocol, MAX(created_at) as last_seen
      FROM chaincheck_probes
      GROUP BY url
      ORDER BY last_seen DESC
    `);

    const rows = stmt.all() as Array<{
      target_name: string;
      url: string;
      protocol: string;
      last_seen: number;
    }>;

    return rows.map((r) => ({
      name: r.target_name,
      url: r.url,
      protocol: r.protocol,
      lastSeen: r.last_seen,
    }));
  }
}
