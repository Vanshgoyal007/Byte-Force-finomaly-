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
  normaliseVector,
  hybridSimilarity,
  scoreToBand,
  computeFeatureDeltas,
  applyEmaUpdate,
  EMA_ALPHA,
  RawVector,
  averageRawVectors,
} from '@/app/demo/biometrics';

export const runtime = 'nodejs';

interface VerifyRequestBody {
  userId: string;
  vector: [number, number, number, number, number];
  flags?: {
    pasteDetected?: boolean;
    botSuspected?: boolean;
  };
  clientBaseline?: RawVector[];
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req);
}

export async function POST(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);

  // 1. Rate limiting per IP
  const rateLimit = checkRateLimit(req, { routeKey: 'verify', maxRequests: 30 });
  const baseHeaders = {
    ...corsHeaders,
    'X-RateLimit-Limit': '30',
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

  // 3. Request parsing & validation
  let body: VerifyRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body' },
      { status: 400, headers: baseHeaders }
    );
  }

  const { userId, vector, flags } = body;
  const cleanUserId = sanitizeUserId(userId);

  if (!cleanUserId) {
    return NextResponse.json(
      { error: 'userId must be a non-empty alphanumeric string (max 64 characters)' },
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

  const liveRaw: RawVector = arrayToRawVector(vectorValidation.vector);
  const pasteDetected = Boolean(flags?.pasteDetected);
  const botSuspected = Boolean(flags?.botSuspected);

  // 4. Supabase DB interaction
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Database service not configured' },
      { status: 503, headers: baseHeaders }
    );
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', cleanUserId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { error: 'Database error fetching user baseline' },
        { status: 500, headers: baseHeaders }
      );
    }

    let baselineRaw: RawVector;

    if (!profile || !profile.baseline) {
      if (body.clientBaseline && Array.isArray(body.clientBaseline) && body.clientBaseline.length > 0) {
        baselineRaw = averageRawVectors(body.clientBaseline);
        await supabase.from('profiles').upsert({
          user_id: cleanUserId,
          baseline: {
            sessions: body.clientBaseline,
            centroid: baselineRaw,
          },
          sessions_count: body.clientBaseline.length,
          consent: true,
          updated_at: new Date().toISOString(),
        });
      } else {
        return NextResponse.json(
          { error: 'No enrolled baseline found for this user. Please complete baseline enrollment first.' },
          { status: 404, headers: baseHeaders }
        );
      }
    } else {
      baselineRaw =
        profile.baseline.centroid ||
        (Array.isArray(profile.baseline.sessions) && profile.baseline.sessions.length > 0
          ? profile.baseline.sessions[0]
          : profile.baseline);
    }

    const baselineNorm = normaliseVector(baselineRaw);
    const liveNorm = normaliseVector(liveRaw);

    // Compute similarity score using existing biometrics.ts hybrid engine
    let score = hybridSimilarity(baselineNorm, liveNorm);

    // If paste or robotic injection was detected, flag as anomaly
    if (pasteDetected || botSuspected) {
      score = Math.min(score, 0.25);
    }

    const band = scoreToBand(score);
    const featureDeltas = computeFeatureDeltas(baselineRaw, liveRaw);

    // 5. Apply Exponential Moving Average (EMA) baseline update ONLY when band is 'match'
    if (band === 'match') {
      const updatedBaselineRaw = applyEmaUpdate(baselineRaw, liveRaw, EMA_ALPHA);
      const updatedSessions = Array.isArray(profile?.baseline?.sessions)
        ? [...profile.baseline.sessions, liveRaw].slice(-5) // Keep last 5 sessions
        : [updatedBaselineRaw];

      await supabase
        .from('profiles')
        .update({
          baseline: {
            sessions: updatedSessions,
            centroid: updatedBaselineRaw,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', cleanUserId);
    }

    // 6. Write immutable audit log row
    // NEVER store typed text, passwords, or raw keys: only numeric metrics, band, and flags
    await supabase.from('audit_logs').insert({
      user_id: cleanUserId,
      score: Number(score.toFixed(4)),
      band,
      features: {
        liveVector: vectorValidation.vector,
        featureDeltas,
      },
      flags: {
        pasteDetected,
        botSuspected,
      },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        score: Number(score.toFixed(4)),
        band,
        featureDeltas,
      },
      { status: 200, headers: baseHeaders }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error processing verification' },
      { status: 500, headers: baseHeaders }
    );
  }
}
