import dns from 'node:dns/promises';
import { URL } from 'node:url';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowLocalhostForTesting?: boolean;
}

/**
 * Validates if an IPv4 string belongs to private, loopback, or reserved subnets
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  const [b0, b1] = parts;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;
  // 10.0.0.0/8 (Private)
  if (b0 === 10) return true;
  // 172.16.0.0/12 (Private)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (b0 === 192 && b1 === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (b0 === 169 && b1 === 254) return true;
  // 100.64.0.0/10 (Shared carrier CGNAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  // 0.0.0.0/8
  if (b0 === 0) return true;
  // 224.0.0.0/4 (Multicast) or 240.0.0.0/4 (Reserved)
  if (b0 >= 224) return true;

  return false;
}

/**
 * Validates if an IPv6 string belongs to private, loopback, or reserved subnets
 */
export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback ::1
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  // Unique local fc00::/7
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // Link-local fe80::/10
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // IPv4-mapped
  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.slice(7);
    return isPrivateIPv4(ipv4);
  }
  return false;
}

/**
 * Strict SSRF & DNS Rebinding validation for any target URL
 */
export async function validateSafeTargetUrl(
  rawUrl: string,
  allowLocalhostForTesting: boolean = false
): Promise<{ safeUrl: URL; resolvedIps: string[] }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF Block: Malformed URL: ${rawUrl}`);
  }

  // Only allow standard http / https / ws / wss
  const allowedProtocols = ['http:', 'https:', 'ws:', 'wss:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`SSRF Block: Disallowed protocol '${parsed.protocol}'. Only HTTP(S) and WS(S) are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Handle localhost test exemption
  if (allowLocalhostForTesting && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
    return { safeUrl: parsed, resolvedIps: ['127.0.0.1'] };
  }

  // Block obvious localhost / internal domains
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    throw new Error(`SSRF Block: Internal or localhost destination '${hostname}' is prohibited`);
  }

  // Resolve hostname via DNS to prevent DNS rebinding
  let resolvedIps: string[] = [];
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    resolvedIps = addresses.map((a) => a.address);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SSRF Block: Failed to resolve hostname '${hostname}': ${msg}`);
  }

  if (resolvedIps.length === 0) {
    throw new Error(`SSRF Block: Hostname '${hostname}' resolved to 0 IP addresses`);
  }

  // Check every resolved IP address
  for (const ip of resolvedIps) {
    const isV4 = ip.includes('.');
    const isBlocked = isV4 ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
    if (isBlocked) {
      throw new Error(`SSRF Block: Host '${hostname}' resolved to prohibited private/internal IP: ${ip}`);
    }
  }

  return { safeUrl: parsed, resolvedIps };
}

/**
 * Safe HTTP fetch with SSRF, timeout, redirect bounds, and response byte caps
 */
export async function safeFetch(
  targetUrl: string,
  options: SafeFetchOptions = {},
  fetchInit: RequestInit = {}
): Promise<{ status: number; text: string; json: <T>() => T; headers: Headers }> {
  const timeoutMs = options.timeoutMs || 5000;
  const maxBytes = options.maxBytes || 1024 * 1024; // 1 MB cap

  const { safeUrl } = await validateSafeTargetUrl(targetUrl, options.allowLocalhostForTesting);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(safeUrl.toString(), {
      ...fetchInit,
      signal: controller.signal,
      redirect: 'manual', // Do not automatically follow redirects to internal networks
    });

    // Check for redirect protection
    if (res.status >= 300 && res.status < 400) {
      const redirectLoc = res.headers.get('location');
      if (redirectLoc) {
        const fullRedirect = new URL(redirectLoc, safeUrl).toString();
        // Validate redirect target before following
        await validateSafeTargetUrl(fullRedirect, options.allowLocalhostForTesting);
      }
    }

    // Stream and enforce byte limits to avoid memory exhaustion
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.length;
          if (receivedBytes > maxBytes) {
            throw new Error(`Response size limit exceeded: received > ${maxBytes} bytes`);
          }
          chunks.push(value);
        }
      }
    }

    const totalBuffer = Buffer.concat(chunks);
    const text = totalBuffer.toString('utf-8');

    return {
      status: res.status,
      headers: res.headers,
      text,
      json: <T>() => JSON.parse(text) as T,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
