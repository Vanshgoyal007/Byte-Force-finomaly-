import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase';
import {
  checkRateLimit,
  validateApiAuth,
  validateAdminAuth,
  getCorsHeaders,
  handleCorsPreflight,
} from '@/lib/apiSecurity';
import { sanitizeUserId } from '@/lib/security';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req);
}

export async function GET(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);

  // 1. Rate limiting per IP
  const rateLimit = checkRateLimit(req, { routeKey: 'audit', maxRequests: 40 });
  const baseHeaders = {
    ...corsHeaders,
    'X-RateLimit-Limit': '40',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(rateLimit.resetAt),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again in 1 minute.' },
      { status: 429, headers: baseHeaders }
    );
  }

  // 2. Base API authorization check
  const authCheck = validateApiAuth(req);
  if (!authCheck.valid) {
    return NextResponse.json(
      { error: authCheck.error || 'Unauthorized' },
      { status: 401, headers: baseHeaders }
    );
  }

  // 3. Query parameter validation
  const { searchParams } = new URL(req.url);
  const rawUserId = searchParams.get('userId');
  const isGlobalQuery = !rawUserId || rawUserId.trim() === 'all' || rawUserId.trim() === '*';
  const cleanUserId = sanitizeUserId(rawUserId || '');

  // 4. Supabase DB query
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Database service not configured' },
      { status: 503, headers: baseHeaders }
    );
  }

  try {
    let query = supabase
      .from('audit_logs')
      .select('id, user_id, score, band, features, flags, created_at')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!isGlobalQuery && cleanUserId) {
      query = query.eq('user_id', cleanUserId);
    }

    const { data: logs, error } = await query;

    if (error) {
      // Do not expose raw database error details to client in production
      return NextResponse.json(
        { error: 'Failed to retrieve audit records' },
        { status: 500, headers: baseHeaders }
      );
    }

    return NextResponse.json(
      { logs: logs || [] },
      { status: 200, headers: baseHeaders }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error retrieving audit records' },
      { status: 500, headers: baseHeaders }
    );
  }
}
