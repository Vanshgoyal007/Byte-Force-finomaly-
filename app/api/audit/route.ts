import { NextRequest, NextResponse } from 'next/server';
import {
  bankingJson,
  bankingRateLimit,
  getBankingAuthContext,
  missingBankingConfiguration,
} from '@/lib/bankingAuth';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/apiSecurity';

export const runtime = 'nodejs';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const rateLimit = bankingRateLimit(request, 'audit', 40);
  if (rateLimit) return rateLimit;
  if (missingBankingConfiguration()) {
    return NextResponse.json(
      { error: 'Supabase Auth and server database environment are not configured.' },
      { status: 503, headers: corsHeaders },
    );
  }

  const context = await getBankingAuthContext(request);
  if (!context) {
    return NextResponse.json(
      { error: 'Sign in is required to view audit records.' },
      { status: 401, headers: corsHeaders },
    );
  }

  const { data: logs, error } = await context.databaseClient
    .from('audit_logs')
    .select('id, user_id, score, band, features, flags, created_at')
    .eq('user_id', context.user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return bankingJson(context, { error: 'Failed to retrieve audit records.' }, 500);
  const response = bankingJson(context, { logs: logs ?? [] });
  Object.entries(corsHeaders).forEach(([name, value]) => response.headers.set(name, value));
  return response;
}
