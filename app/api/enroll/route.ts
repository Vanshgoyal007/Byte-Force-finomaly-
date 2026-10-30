import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  validateApiAuth,
  getCorsHeaders,
  handleCorsPreflight,
} from '@/lib/apiSecurity';
import {
  bankingJson,
  getBankingAuthContext,
  missingBankingConfiguration,
  rejectCrossOriginMutation,
} from '@/lib/bankingAuth';
import {
  validateNumericVector,
  arrayToRawVector,
  averageRawVectors,
  RawVector,
} from '@/app/demo/biometrics';

export const runtime = 'nodejs';

interface EnrollRequestBody {
  vector: [number, number, number, number, number];
  consent: boolean;
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req);
}

export async function POST(req: NextRequest) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const corsHeaders = getCorsHeaders(req);

  // 1. Rate limiting per IP (strict limit for enrollment)
  const rateLimit = checkRateLimit(req, { routeKey: 'enroll', maxRequests: 20 });
  const baseHeaders = {
    ...corsHeaders,
    'X-RateLimit-Limit': '20',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(rateLimit.resetAt),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again in 1 minute.' },
      { status: 429, headers: baseHeaders }
    );
  }

  // 2. API Authorization check
  const authCheck = validateApiAuth(req);
  if (!authCheck.valid) {
    return NextResponse.json(
      { error: authCheck.error || 'Unauthorized' },
      { status: 401, headers: baseHeaders }
    );
  }

  if (missingBankingConfiguration()) {
    return NextResponse.json(
      { error: 'Supabase Auth and server database environment are not configured.' },
      { status: 503, headers: baseHeaders }
    );
  }
  const context = await getBankingAuthContext(req);
  if (!context) {
    return NextResponse.json(
      { error: 'Sign in is required to save a server-side baseline.' },
      { status: 401, headers: baseHeaders }
    );
  }

  // 3. Body parsing & validation
  let body: EnrollRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body' },
      { status: 400, headers: baseHeaders }
    );
  }

  const { vector, consent } = body;

  if (consent !== true) {
    return NextResponse.json(
      { error: 'Consent is required (consent must be true) to enroll a behavioral profile' },
      { status: 400, headers: baseHeaders }
    );
  }

  const vectorValidation = validateNumericVector(vector);
  if (!vectorValidation.valid || !vectorValidation.vector) {
    return NextResponse.json(
      { error: vectorValidation.error || 'Invalid 5D vector' },
      { status: 400, headers: baseHeaders }
    );
  }

  // Convert array to RawVector object
  const newSessionRaw: RawVector = arrayToRawVector(vectorValidation.vector);

  // 4. Supabase DB interaction
  const supabase = context.databaseClient;

  try {
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', context.user.id)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: 'Database query error during enrollment check' },
        { status: 500, headers: baseHeaders }
      );
    }

    let sessionsCount = 1;
    let enrolled = false;

    if (!existingProfile) {
      // First enrollment session
      const baselinePayload = {
        sessions: [newSessionRaw],
        centroid: newSessionRaw,
      };

      const { error: insertError } = await supabase.from('profiles').insert({
        user_id: context.user.id,
        baseline: baselinePayload,
        sessions_count: 1,
        consent: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        return NextResponse.json(
          { error: 'A baseline was concurrently created; refresh and try again.' },
          { status: 409, headers: baseHeaders }
        );
      }

      sessionsCount = 1;
      enrolled = false;
    } else {
      // Profile exists: append session and recompute centroid
      const existingBaseline = existingProfile.baseline;
      const priorSessions: RawVector[] = Array.isArray(existingBaseline?.sessions)
        ? existingBaseline.sessions
        : [existingBaseline?.centroid || existingBaseline];

      if (Number(existingProfile.sessions_count) >= 3 || priorSessions.length >= 3) {
        return NextResponse.json(
          { error: 'Baseline already has three observations. Delete and explicitly re-enroll to replace it.' },
          { status: 409, headers: baseHeaders }
        );
      }

      const updatedSessions: RawVector[] = [...priorSessions, newSessionRaw];
      const updatedCentroid = averageRawVectors(updatedSessions);
      sessionsCount = updatedSessions.length;
      enrolled = sessionsCount >= 3;

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          baseline: {
            sessions: updatedSessions,
            centroid: updatedCentroid,
          },
          sessions_count: sessionsCount,
          consent: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', context.user.id)
        .eq('sessions_count', existingProfile.sessions_count)
        .select('user_id')
        .maybeSingle();

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to update baseline session in database' },
          { status: 500, headers: baseHeaders }
        );
      }
      if (!updatedProfile) {
        return NextResponse.json(
          { error: 'Baseline state changed; refresh and try again.' },
          { status: 409, headers: baseHeaders }
        );
      }
    }

    return NextResponse.json(
      {
        sessionsCount,
        enrolled,
      },
      { status: 200, headers: baseHeaders }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error processing enrollment' },
      { status: 500, headers: baseHeaders }
    );
  }
}
