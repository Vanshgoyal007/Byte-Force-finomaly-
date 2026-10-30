import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase';
import {
  checkRateLimit,
  validateApiAuth,
  getCorsHeaders,
  handleCorsPreflight,
} from '@/lib/apiSecurity';
import { sanitizeUserId } from '@/lib/security';
import {
  validateNumericVector,
  arrayToRawVector,
  averageRawVectors,
  RawVector,
} from '@/app/demo/biometrics';

export const runtime = 'nodejs';

interface EnrollRequestBody {
  userId: string;
  vector: [number, number, number, number, number];
  consent: boolean;
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req);
}

export async function POST(req: NextRequest) {
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

  const { userId, vector, consent } = body;
  const cleanUserId = sanitizeUserId(userId);

  if (!cleanUserId) {
    return NextResponse.json(
      { error: 'userId must be a non-empty alphanumeric string (max 64 characters)' },
      { status: 400, headers: baseHeaders }
    );
  }

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
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Database service not configured' },
      { status: 503, headers: baseHeaders }
    );
  }

  try {
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', cleanUserId)
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
        user_id: cleanUserId,
        baseline: baselinePayload,
        sessions_count: 1,
        consent: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        return NextResponse.json(
          { error: 'Failed to record initial baseline session' },
          { status: 500, headers: baseHeaders }
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

      // Keep up to 10 historical sessions to prevent unbounded DB growth
      const updatedSessions: RawVector[] = [...priorSessions, newSessionRaw].slice(-10);
      const updatedCentroid = averageRawVectors(updatedSessions);
      sessionsCount = updatedSessions.length;
      enrolled = sessionsCount >= 3;

      const { error: updateError } = await supabase
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
        .eq('user_id', cleanUserId);

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to update baseline session in database' },
          { status: 500, headers: baseHeaders }
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
