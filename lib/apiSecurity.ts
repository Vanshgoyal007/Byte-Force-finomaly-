import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, isAllowedOrigin } from './security';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_REQUESTS = 45;

/**
 * Extracts client IP securely.
 * On Vercel / reverse proxies, the proxy appends the genuine client IP to the end,
 * while a malicious client can prepend arbitrary fake IPs in the x-forwarded-for header.
 */
export function getClientIp(req: NextRequest): string {
  const vercelIp = req.headers.get('x-vercel-proxied-for');
  if (vercelIp && vercelIp.trim()) {
    return vercelIp.split(',').pop()?.trim() || vercelIp.trim();
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim()) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    // Take the rightmost IP (last trusted proxy hop)
    return parts[parts.length - 1] || '127.0.0.1';
  }

  return '127.0.0.1';
}

/**
 * Rate limiter supporting per-route and per-IP buckets.
 */
export function checkRateLimit(
  req: NextRequest,
  options: { maxRequests?: number; windowMs?: number; routeKey?: string } = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const route = options.routeKey ?? 'global';
  const ip = getClientIp(req);
  const key = `${route}:${ip}`;

  const now = Date.now();
  const existing = rateLimitStore.get(key);

  // Periodically clean up stale entries if store grows
  if (rateLimitStore.size > 2000) {
    rateLimitStore.forEach((record, k) => {
      if (record.resetAt < now) {
        rateLimitStore.delete(k);
      }
    });
  }

  if (!existing || existing.resetAt < now) {
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: maxRequests - existing.count, resetAt: existing.resetAt };
}

/**
 * Validates whether the request is authorized:
 * 1. Checks API_KEY using timing-safe comparison.
 * 2. OR validates same-origin browser requests (CSRF / Origin check).
 */
export function validateApiAuth(req: NextRequest): { valid: boolean; isSameOrigin: boolean; error?: string } {
  const expectedKey = process.env.API_KEY;
  const authHeader = req.headers.get('authorization');
  const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const providedKey = req.headers.get('x-api-key')?.trim() || bearerKey;

  // 1. Direct API Key authentication via timingSafeEqual
  if (expectedKey && providedKey && timingSafeEqual(providedKey, expectedKey)) {
    return { valid: true, isSameOrigin: false };
  }

  // 2. Strict Same-Origin validation for demo browser client
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  const secFetchSite = req.headers.get('sec-fetch-site');

  const sameOriginValid =
    secFetchSite === 'same-origin' ||
    isAllowedOrigin(origin, host) ||
    (!origin && secFetchSite === 'none'); // direct navigation / local test

  if (sameOriginValid) {
    return { valid: true, isSameOrigin: true };
  }

  return {
    valid: false,
    isSameOrigin: false,
    error: 'Unauthorized: Invalid or missing API key',
  };
}

/**
 * Validates Admin-level authorization.
 * Required for viewing all users' audit logs or sensitive administrative actions.
 */
export function validateAdminAuth(req: NextRequest): { valid: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY || process.env.API_KEY;
  if (!adminKey) {
    // If no admin key configured, deny cross-user access in production
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, error: 'Admin access not configured on server' };
    }
    return { valid: true };
  }

  const authHeader = req.headers.get('authorization');
  const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const providedKey = req.headers.get('x-admin-key')?.trim() || req.headers.get('x-api-key')?.trim() || bearerKey;

  if (providedKey && timingSafeEqual(providedKey, adminKey)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: 'Forbidden: Admin authorization required to access cross-user records',
  };
}

/**
 * Constructs secure CORS response headers.
 */
export function getCorsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  const allowed = isAllowedOrigin(origin, host);

  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-admin-key, x-finomaly-client',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Creates standard preflight response for OPTIONS requests.
 */
export function handleCorsPreflight(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}
