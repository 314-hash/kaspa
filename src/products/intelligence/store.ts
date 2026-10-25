import { DatabaseSync } from 'node:sqlite';
import type { IntelligenceItem } from '../../types/index.ts';

export class IntelligenceStore {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intelligence_feed (
        id TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        summary TEXT NOT NULL,
        raw_details TEXT,
        published_at TEXT NOT NULL,
        collected_at INTEGER NOT NULL,
        is_verified_upstream INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_intel_category ON intelligence_feed(category);
      CREATE INDEX IF NOT EXISTS idx_intel_repo ON intelligence_feed(repository);
      CREATE INDEX IF NOT EXISTS idx_intel_time ON intelligence_feed(published_at);
    `);
  }

  public upsertItem(item: IntelligenceItem): void {
    const stmt = this.db.prepare(`
      INSERT INTO intelligence_feed (
        id, repository, category, title, url, summary,
        raw_details, published_at, collected_at, is_verified_upstream
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        raw_details = excluded.raw_details,
        collected_at = excluded.collected_at
    `);

    stmt.run(
      item.id,
      item.repository,
      item.category,
      item.title,
      item.url,
      item.summary,
      item.rawDetails || null,
      item.publishedAt,
      item.collectedAt,
      item.isVerifiedUpstream ? 1 : 0
    );
  }

  public getFeed(options: { category?: string; repository?: string; limit?: number } = {}): IntelligenceItem[] {
    const limit = options.limit || 50;
    let query = 'SELECT * FROM intelligence_feed';
    const params: any[] = [];
    const conditions: string[] = [];

    if (options.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }
    if (options.repository) {
      conditions.push('repository = ?');
      params.push(options.repository);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY published_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: string;
      repository: string;
      category: string;
      title: string;
      url: string;
      summary: string;
      raw_details: string | null;
      published_at: string;
      collected_at: number;
      is_verified_upstream: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      repository: r.repository,
      category: r.category as any,
      title: r.title,
      url: r.url,
      summary: r.summary,
      rawDetails: r.raw_details || undefined,
      publishedAt: r.published_at,
      collectedAt: r.collected_at,
      isVerifiedUpstream: r.is_verified_upstream === 1,
    }));
  }

  public getCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as cnt FROM intelligence_feed');
    const row = stmt.get() as { cnt: number };
    return row.cnt;
  }
}
