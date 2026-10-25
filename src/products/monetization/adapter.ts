import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type MonetizationTier = 'FREE' | 'PRO';

export interface SubscriptionRecord {
  apiKey: string;
  tier: MonetizationTier;
  customerEmail?: string;
  provider: 'STRIPE' | 'COINBASE_COMMERCE' | 'BTCPAY' | 'UNCONFIGURED_FREE';
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  expiresAt: number;
  createdAt: number;
}

export interface PaymentWebhookPayload {
  provider: string;
  eventId: string;
  customerEmail: string;
  tier: MonetizationTier;
  signature?: string;
  rawBody: string;
}

/**
 * Provider-Independent Monetization & Subscription Adapter
 * Designed for zero-cost operation when unconfigured, with pluggable payment gateways.
 */
export class MonetizationAdapter {
  private db: DatabaseSync;
  private webhookSecret?: string;

  constructor(db: DatabaseSync, webhookSecret?: string) {
    this.db = db;
    this.webhookSecret = webhookSecret;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        api_key TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        customer_email TEXT,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Generates a free-tier API key for testing and diagnostics
   */
  public createFreeApiKey(customerEmail?: string): string {
    const key = `exj_free_${crypto.randomBytes(16).toString('hex')}`;
    const stmt = this.db.prepare(`
      INSERT INTO subscriptions (api_key, tier, customer_email, provider, status, expires_at, created_at)
      VALUES (?, 'FREE', ?, 'UNCONFIGURED_FREE', 'ACTIVE', ?, ?)
    `);
    // Free keys don't expire
    stmt.run(key, customerEmail || null, Date.now() + 100 * 365 * 24 * 3600 * 1000, Date.now());
    return key;
  }

  /**
   * Evaluates tier entitlements for a given API key.
   * Free product is fully functional without payment configuration.
   */
  public verifyEntitlement(apiKey?: string): {
    tier: MonetizationTier;
    canAccessHistoricalData: boolean;
    maxHistoryRetentionDays: number;
    canSetAutomatedAlerts: boolean;
    rateLimitPerMin: number;
  } {
    if (!apiKey) {
      // Default anonymous free access
      return {
        tier: 'FREE',
        canAccessHistoricalData: true,
        maxHistoryRetentionDays: 7,
        canSetAutomatedAlerts: false,
        rateLimitPerMin: 60,
      };
    }

    const stmt = this.db.prepare('SELECT * FROM subscriptions WHERE api_key = ?');
    const row = stmt.get(apiKey) as {
      tier: string;
      status: string;
      expires_at: number;
    } | undefined;

    if (!row || row.status !== 'ACTIVE' || row.expires_at < Date.now()) {
      return {
        tier: 'FREE',
        canAccessHistoricalData: true,
        maxHistoryRetentionDays: 7,
        canSetAutomatedAlerts: false,
        rateLimitPerMin: 60,
      };
    }

    if (row.tier === 'PRO') {
      return {
        tier: 'PRO',
        canAccessHistoricalData: true,
        maxHistoryRetentionDays: 365,
        canSetAutomatedAlerts: true,
        rateLimitPerMin: 600,
      };
    }

    return {
      tier: 'FREE',
      canAccessHistoricalData: true,
      maxHistoryRetentionDays: 7,
      canSetAutomatedAlerts: false,
      rateLimitPerMin: 60,
    };
  }

  /**
   * Process a validated webhook from a payment processor (Stripe, BTCPay, etc.)
   */
  public processWebhook(payload: PaymentWebhookPayload): { success: boolean; apiKey?: string; error?: string } {
    // Cryptographic signature check if webhook secret configured
    if (this.webhookSecret && payload.signature) {
      const expectedSig = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload.rawBody)
        .digest('hex');
      if (payload.signature !== expectedSig) {
        return { success: false, error: 'Invalid webhook signature' };
      }
    }

    const newKey = `exj_pro_${crypto.randomBytes(16).toString('hex')}`;
    const oneYear = 365 * 24 * 3600 * 1000;

    const stmt = this.db.prepare(`
      INSERT INTO subscriptions (api_key, tier, customer_email, provider, status, expires_at, created_at)
      VALUES (?, 'PRO', ?, ?, 'ACTIVE', ?, ?)
    `);

    stmt.run(newKey, payload.customerEmail, payload.provider, Date.now() + oneYear, Date.now());

    return { success: true, apiKey: newKey };
  }
}
