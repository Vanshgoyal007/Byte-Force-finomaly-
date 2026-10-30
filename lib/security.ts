import crypto from 'crypto';

/**
 * Timing-safe string comparison to protect against timing side-channel attacks
 * when comparing secret API keys or authentication tokens.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Constant-time dummy comparison to prevent length leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Sanitizes generic user-supplied strings:
 * - Trims whitespace
 * - Strips ASCII control characters (0x00-0x1F, 0x7F)
 * - Escapes dangerous HTML characters to prevent XSS
 * - Truncates to max length
 */
export function sanitizeString(input: unknown, maxLength: number = 255): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // strip control characters
    .replace(/[<>&"']/g, (char) => {
      switch (char) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&#x27;';
        default: return char;
      }
    })
    .slice(0, maxLength);
}

/**
 * Strict validator and sanitizer for user identifiers:
 * Only allows alphanumeric characters, underscores, and hyphens (e.g. UUIDs or demo slugs).
 * Maximum length: 64 characters.
 */
export function sanitizeUserId(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.slice(0, 64);
}

/**
 * Validates and sanitizes email addresses:
 * Valid format check, lowercase, max 120 characters.
 */
export function sanitizeEmail(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(cleaned) || cleaned.length > 120) {
    return '';
  }
  return cleaned;
}

/**
 * Checks whether an incoming HTTP request origin is strictly same-origin
 * or matches an allowed host, avoiding bypasses like 'host.attacker.com'.
 */
export function isAllowedOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader || !hostHeader) {
    return false;
  }

  try {
    const originUrl = new URL(originHeader);
    const hostName = hostHeader.split(':')[0].toLowerCase();
    const originHost = originUrl.hostname.toLowerCase();

    // Exact hostname match (or localhost in local dev)
    return originHost === hostName || (hostName === 'localhost' && originHost === 'localhost');
  } catch {
    return false;
  }
}
