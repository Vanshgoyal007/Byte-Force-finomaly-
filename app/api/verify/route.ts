import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  validateApiAuth,
  getCorsHeaders,
  handleCorsPreflight,
} from '@/lib/apiSecurity';
import {
  getBankingAuthContext,
  missingBankingConfiguration,
} from '@/lib/bankingAuth';
import {
  validateNumericVector,
  arrayToRawVector,
  isValidRawVector,
  normaliseVector,
  hybridSimilarity,
  scoreToBand,
  computeFeatureDeltas,
  RawVector,
  averageRawVectors,
} from '@/app/demo/biometrics';

export const runtime = 'nodejs';

interface VerifyRequestBody {
  vector: [number, number, number, number, number];
  flags?: {
    pasteDetected?: boolean;
    botSuspected?: boolean;
  };
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

  if (missingBankingConfiguration()) {
    return NextResponse.json(
      { error: 'Supabase Auth and server database environment are not configured.' },
      { status: 503, headers: baseHeaders }
    );
  }
  const context = await getBankingAuthContext(req);
  if (!context) {
    return NextResponse.json(
      { error: 'Sign in is required to verify a server-side baseline.' },
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

  const { vector, flags } = body;

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
  const supabase = context.databaseClient;

  try {
    const { data: profile, error: profileError } = await supabase
      .from('banking_profiles')
      .select('baseline, sessions_count')
      .eq('user_id', context.user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { error: 'Database error fetching user baseline' },
        { status: 500, headers: baseHeaders }
      );
    }

    const storedSessions = Array.isArray(profile?.baseline?.sessions)
      ? profile.baseline.sessions.filter(isValidRawVector) as RawVector[]
      : [];
    if (!profile?.baseline || Number(profile.sessions_count) < 3 || storedSessions.length < 3) {
      return NextResponse.json(
        { error: 'A complete server-enrolled baseline is required before verification.' },
        { status: profile ? 409 : 404, headers: baseHeaders }
      );
    }

    const baselineRaw = averageRawVectors(storedSessions);

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

    // Verification observes the stored baseline but never updates it automatically.
    // Explicit enrollment is the only supported baseline write path.
    // NEVER store typed text, passwords, or raw keys: only numeric metrics, band, and flags
    await supabase.from('audit_logs').insert({
      user_id: context.user.id,
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
