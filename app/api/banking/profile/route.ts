import { NextRequest } from 'next/server';
import {
  bankingJson,
  bankingRateLimit,
  getBankingAuthContext,
  missingBankingConfiguration,
  rejectCrossOriginMutation,
} from '@/lib/bankingAuth';
import { isValidRawVector, RawVector } from '@/app/demo/biometrics';
import {
  BehaviorObservation,
  initializeBehavioralProfile,
  observationFromRawVector,
  profileFromStoredValue,
  serializeBehavioralProfile,
  validateBehaviorObservation,
} from '@/lib/behavioralProfile';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (missingBankingConfiguration()) {
    return bankingJson(null, { error: 'Supabase Auth and server database environment are not configured.' }, 503);
  }
  const context = await getBankingAuthContext(request);
  if (!context) return bankingJson(null, { error: 'Sign in is required.' }, 401);

  const { data, error } = await context.databaseClient
    .from('banking_profiles')
    .select('baseline, sessions_count, consent_at, updated_at')
    .eq('user_id', context.user.id)
    .maybeSingle();

  if (error) return bankingJson(context, { error: 'Could not load the saved profile.' }, 500);
  return bankingJson(context, {
    enrolled: Boolean(data && data.sessions_count >= 3),
    sessionsCount: data?.sessions_count ?? 0,
    consentAt: data?.consent_at ?? null,
    updatedAt: data?.updated_at ?? null,
    profile: data ? profileFromStoredValue(data.baseline) : null,
  });
}

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const rateLimitError = bankingRateLimit(request, 'banking-profile-write', 5);
  if (rateLimitError) return rateLimitError;
  if (missingBankingConfiguration()) {
    return bankingJson(null, { error: 'Supabase Auth and server database environment are not configured.' }, 503);
  }
  const context = await getBankingAuthContext(request);
  if (!context) return bankingJson(null, { error: 'Sign in is required.' }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return bankingJson(context, { error: 'Request must contain valid JSON.' }, 400);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return bankingJson(context, { error: 'Request body must be an object.' }, 400);
  }
  const body = parsedBody as { sessions?: unknown; observations?: unknown; consent?: unknown };
  const validObservations = Array.isArray(body.observations) &&
    body.observations.length === 3 &&
    body.observations.every((observation) =>
      validateBehaviorObservation(observation) &&
      observation.observedKeys >= 20 &&
      typeof observation.features.avgHoldTime === 'number' &&
      typeof observation.features.avgFlightTime === 'number' &&
      typeof observation.features.wpm === 'number',
    );
  const validLegacySessions = Array.isArray(body.sessions) &&
    body.sessions.length === 3 && body.sessions.every(isValidRawVector);
  if (body.consent !== true || (!validObservations && !validLegacySessions)) {
    return bankingJson(context, {
      error: 'Explicit consent and exactly three valid numeric baseline observations are required.',
    }, 400);
  }

  const observations: BehaviorObservation[] = validObservations
    ? body.observations as BehaviorObservation[]
    : (body.sessions as RawVector[]).map((vector) => observationFromRawVector(vector));
  const profile = initializeBehavioralProfile(observations);
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await context.databaseClient
    .from('banking_profiles')
    .select('user_id')
    .eq('user_id', context.user.id)
    .maybeSingle();
  if (lookupError) return bankingJson(context, { error: 'Could not check the saved profile.' }, 500);
  if (existing) {
    return bankingJson(context, {
      error: 'A baseline is already saved. Delete it explicitly before enrolling a replacement.',
    }, 409);
  }

  const { error } = await context.databaseClient.from('banking_profiles').insert({
    user_id: context.user.id,
    baseline: serializeBehavioralProfile(profile),
    sessions_count: profile.acceptedSessions,
    profile_revision: profile.revision,
    consent_at: now,
    created_at: now,
    updated_at: now,
  });
  if (error) return bankingJson(context, { error: 'Could not save the baseline.' }, 500);
  return bankingJson(context, { enrolled: true, sessionsCount: profile.acceptedSessions, profile }, 201);
}

export async function DELETE(request: NextRequest) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const rateLimitError = bankingRateLimit(request, 'banking-profile-write', 5);
  if (rateLimitError) return rateLimitError;
  if (missingBankingConfiguration()) {
    return bankingJson(null, { error: 'Supabase Auth and server database environment are not configured.' }, 503);
  }
  const context = await getBankingAuthContext(request);
  if (!context) return bankingJson(null, { error: 'Sign in is required.' }, 401);

  const { error } = await context.databaseClient
    .from('banking_profiles')
    .delete()
    .eq('user_id', context.user.id);
  if (error) return bankingJson(context, { error: 'Could not delete the saved profile.' }, 500);
  return bankingJson(context, { deleted: true });
}
