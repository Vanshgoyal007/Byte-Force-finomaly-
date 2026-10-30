import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from './apiSecurity';
import { getSupabaseServerClient } from './supabase';

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface BankingAuthContext {
  user: User;
  sessionClient: SupabaseClient;
  databaseClient: SupabaseClient;
  writeCookies: (response: NextResponse) => NextResponse;
  recentAuthTime: number | null;
}

export function missingBankingConfiguration(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function readVerifiedAuthTime(accessToken: string): number | null {
  try {
    const payloadPart = accessToken.split('.')[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      auth_time?: unknown;
    };
    return typeof payload.auth_time === 'number' && Number.isFinite(payload.auth_time)
      ? payload.auth_time
      : null;
  } catch {
    return null;
  }
}

export async function getBankingAuthContext(
  request: NextRequest,
): Promise<BankingAuthContext | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const databaseClient = getSupabaseServerClient();
  if (!url || !anonKey || !databaseClient) return null;

  const cookiesToSet: CookieToSet[] = [];
  const sessionClient = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        cookies.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          cookiesToSet.push({ name, value, options });
        });
      },
    },
  });

  const { data: { user }, error } = await sessionClient.auth.getUser();
  if (error || !user) return null;

  const { data: { session } } = await sessionClient.auth.getSession();
  const accessToken = session?.access_token;

  return {
    user,
    sessionClient,
    databaseClient,
    recentAuthTime: accessToken ? readVerifiedAuthTime(accessToken) : null,
    writeCookies(response) {
      cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      return response;
    },
  };
}

export function bankingJson(
  context: BankingAuthContext | null,
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  const response = NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  return context ? context.writeCookies(response) : response;
}

export function rejectCrossOriginMutation(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const expectedProtocol = forwardedProtocol || request.nextUrl.protocol.replace(':', '');
  if (!origin || !host) return bankingJson(null, { error: 'A same-origin request is required.' }, 403);
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host.toLowerCase() !== host.toLowerCase() ||
        parsedOrigin.protocol !== `${expectedProtocol}:`) {
      return bankingJson(null, { error: 'A same-origin request is required.' }, 403);
    }
  } catch {
    return bankingJson(null, { error: 'Request origin is invalid.' }, 403);
  }
  return null;
}

export function bankingRateLimit(
  request: NextRequest,
  routeKey: string,
  maxRequests: number,
): NextResponse | null {
  const result = checkRateLimit(request, { routeKey, maxRequests, windowMs: 60_000 });
  if (result.allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Wait one minute and try again.' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
      },
    },
  );
}
