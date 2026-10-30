import { NextRequest } from 'next/server';
import {
  bankingJson,
  bankingRateLimit,
  getBankingAuthContext,
  missingBankingConfiguration,
  rejectCrossOriginMutation,
} from '@/lib/bankingAuth';
import {
  arrayToRawVector,
  averageRawVectors,
  hybridSimilarity,
  isValidRawVector,
  normaliseVector,
  RawVector,
  validateNumericVector,
} from '@/app/demo/biometrics';
import {
  adaptBehavioralProfile,
  BehaviorObservation,
  compareBehavior,
  observationFromRawVector,
  profileFromStoredValue,
  recordQuarantinedObservation,
  serializeBehavioralProfile,
  validateBehaviorObservation,
} from '@/lib/behavioralProfile';
import {
  assessTransaction,
  canCompleteTransaction,
  DEFAULT_RISK_POLICY,
  TransactionAssessment,
} from '@/lib/transactionRisk';

export const runtime = 'nodejs';

const SYNTHETIC_LOW_SIMILARITY = 0.4;

interface TransactionRow {
  id: string;
  amount: number;
  new_beneficiary: boolean;
  status: 'held' | 'awaiting-verification' | 'allowed' | 'completed' | 'cancelled';
  assessment: TransactionAssessment;
  synthetic_observation: boolean;
  verified_at: string | null;
  created_at: string;
}

function toClientTransaction(row: TransactionRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    newBeneficiary: row.new_beneficiary,
    status: row.status,
    assessment: row.assessment,
    syntheticObservation: row.synthetic_observation,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

async function writeAuditEvent(
  context: NonNullable<Awaited<ReturnType<typeof getBankingAuthContext>>>,
  transactionId: string,
  eventType: string,
  details: Record<string, unknown> = {},
) {
  return context.databaseClient.from('banking_audit_events').insert({
    user_id: context.user.id,
    transaction_id: transactionId,
    event_type: eventType,
    details,
  });
}

export async function GET(request: NextRequest) {
  if (missingBankingConfiguration()) {
    return bankingJson(null, { error: 'Supabase Auth and server database environment are not configured.' }, 503);
  }
  const context = await getBankingAuthContext(request);
  if (!context) return bankingJson(null, { error: 'Sign in is required.' }, 401);

  const { data, error } = await context.databaseClient
    .from('banking_transactions')
    .select('id, amount, new_beneficiary, status, assessment, synthetic_observation, verified_at, created_at')
    .eq('user_id', context.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return bankingJson(context, { error: 'Could not load transaction history.' }, 500);
  const { data: events, error: eventsError } = await context.databaseClient
    .from('banking_audit_events')
    .select('id, transaction_id, event_type, details, created_at')
    .eq('user_id', context.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (eventsError) return bankingJson(context, { error: 'Could not load transaction audit events.' }, 500);
  return bankingJson(context, {
    transactions: (data ?? []).map((row) => toClientTransaction(row as TransactionRow)),
    events: events ?? [],
  });
}

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const rateLimitError = bankingRateLimit(request, 'banking-transaction-create', 15);
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
  const body = parsedBody as {
    amount?: unknown;
    newBeneficiary?: unknown;
    vector?: unknown;
    observedKeys?: unknown;
    syntheticObservation?: unknown;
    behaviorObservation?: unknown;
    allowProfileLearning?: unknown;
  };

  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
      amount > 8240 || Math.round(amount * 100) !== amount * 100) {
    return bankingJson(context, { error: 'Amount must be greater than $0 and at most $8,240.' }, 400);
  }
  if (typeof body.newBeneficiary !== 'boolean' || typeof body.syntheticObservation !== 'boolean') {
    return bankingJson(context, { error: 'Transaction context fields are invalid.' }, 400);
  }

  const { data: completedRows, error: balanceError } = await context.databaseClient
    .from('banking_transactions')
    .select('amount')
    .eq('user_id', context.user.id)
    .eq('status', 'completed');
  if (balanceError) return bankingJson(context, { error: 'Could not validate the simulated balance.' }, 500);
  const completedTotal = (completedRows ?? []).reduce((total, row) => total + Number(row.amount), 0);
  if (amount > Math.max(0, 8240 - completedTotal)) {
    return bankingJson(context, { error: 'Amount exceeds the remaining simulated balance.' }, 400);
  }

  const { data: profile, error: profileError } = await context.databaseClient
    .from('banking_profiles')
    .select('baseline, sessions_count')
    .eq('user_id', context.user.id)
    .maybeSingle();
  if (profileError) return bankingJson(context, { error: 'Could not load the enrolled baseline.' }, 500);

  const behavioralProfile = profile ? profileFromStoredValue(profile.baseline) : null;
  const legacySessions = Array.isArray(profile?.baseline?.sessions)
    ? profile.baseline.sessions.filter(isValidRawVector) as RawVector[]
    : [];
  const baselineSamples = Math.min(
    behavioralProfile?.acceptedSessions ?? legacySessions.length,
    Number(profile?.sessions_count) || 0,
  );
  let observedKeys = 0;
  let similarity: number | null = null;
  let profileComparison: ReturnType<typeof compareBehavior> | null = null;
  let syntheticObservation = body.syntheticObservation;
  let behaviorObservation: BehaviorObservation | null = null;

  if (syntheticObservation) {
    observedKeys = DEFAULT_RISK_POLICY.minimumObservedKeys;
    similarity = SYNTHETIC_LOW_SIMILARITY;
  } else {
    if (!Number.isInteger(body.observedKeys) || (body.observedKeys as number) < 0 ||
        (body.observedKeys as number) > 10000) {
      return bankingJson(context, { error: 'Observed key count is invalid.' }, 400);
    }
    observedKeys = body.observedKeys as number;
    if (body.behaviorObservation !== undefined) {
      if (!validateBehaviorObservation(body.behaviorObservation)) {
        return bankingJson(context, { error: 'The derived behavioral observation is invalid.' }, 400);
      }
      behaviorObservation = body.behaviorObservation;
      if (behaviorObservation.observedKeys !== observedKeys) {
        return bankingJson(context, { error: 'Observed key count does not match the derived observation.' }, 400);
      }
    }
    if (body.vector !== undefined) {
      const validated = validateNumericVector(body.vector);
      if (!validated.valid || !validated.vector) {
        return bankingJson(context, { error: 'The numeric timing observation is invalid.' }, 400);
      }
      const live = arrayToRawVector(validated.vector);
      if (!behaviorObservation) behaviorObservation = observationFromRawVector(live);
      else {
        const pairedFeatures: Array<[keyof RawVector, number | undefined]> = [
          ['avgHoldTime', behaviorObservation.features.avgHoldTime],
          ['avgFlightTime', behaviorObservation.features.avgFlightTime],
          ['wpm', behaviorObservation.features.wpm],
          ['holdTimeVariance', behaviorObservation.features.holdTimeVariance],
          ['flightTimeVariance', behaviorObservation.features.flightTimeVariance],
        ];
        if (pairedFeatures.some(([feature, observed]) =>
          typeof observed !== 'number' ||
          Math.abs(observed - live[feature]) > Math.max(0.01, Math.abs(live[feature]) * 0.01)
        )) {
          return bankingJson(context, { error: 'Derived feature summaries do not match the submitted numeric timing vector.' }, 400);
        }
      }
      if (behavioralProfile && observedKeys >= DEFAULT_RISK_POLICY.minimumObservedKeys) {
        profileComparison = compareBehavior(behavioralProfile, behaviorObservation);
        similarity = profileComparison.similarity;
      } else if (legacySessions.length >= DEFAULT_RISK_POLICY.minimumBaselineSamples &&
          observedKeys >= DEFAULT_RISK_POLICY.minimumObservedKeys) {
        const baseline = averageRawVectors(legacySessions);
        similarity = hybridSimilarity(normaliseVector(baseline), normaliseVector(live));
      }
    }
  }

  const assessment = assessTransaction({
    similarity,
    baselineSamples,
    observedKeys,
    amount,
    newBeneficiary: body.newBeneficiary,
    featureDeviations: profileComparison?.deviations,
    contextualBaselineUsed: profileComparison?.contextualBaselineUsed,
    profileReliable: behavioralProfile?.reliability === 'usable',
  });
  const status =
    assessment.action === 'hold'
      ? 'held'
      : assessment.action === 'step-up' ||
          (assessment.action === 'insufficient-evidence' && assessment.fallback === 'step-up')
        ? 'awaiting-verification'
        : 'allowed';

  const { data: inserted, error } = await context.databaseClient
    .from('banking_transactions')
    .insert({
      user_id: context.user.id,
      amount,
      new_beneficiary: body.newBeneficiary,
      status,
      assessment,
      synthetic_observation: syntheticObservation,
    })
    .select('id, amount, new_beneficiary, status, assessment, synthetic_observation, verified_at, created_at')
    .single();
  if (error || !inserted) return bankingJson(context, { error: 'Could not create the simulated transaction.' }, 500);

  const eventResult = await writeAuditEvent(context, inserted.id, 'evaluated', {
    action: assessment.action,
    evidenceReliable: assessment.evidenceReliable,
    syntheticObservation,
  });
  if (eventResult.error) {
    await context.databaseClient
      .from('banking_transactions')
      .delete()
      .eq('id', inserted.id)
      .eq('user_id', context.user.id);
    return bankingJson(context, { error: 'Could not write the transaction audit event.' }, 500);
  }

  let profileLearning: string | null = null;
  if (body.allowProfileLearning === true && behaviorObservation && behavioralProfile && profile) {
    const eligible =
      !syntheticObservation &&
      (assessment.action === 'allow' ||
        (assessment.action === 'insufficient-evidence' && assessment.fallback === 'allow')) &&
      similarity !== null &&
      similarity >= DEFAULT_RISK_POLICY.matchSimilarity &&
      !body.newBeneficiary &&
      amount < DEFAULT_RISK_POLICY.highValueAmount;
    const result = eligible
      ? adaptBehavioralProfile(behavioralProfile, behaviorObservation)
      : {
          profile: recordQuarantinedObservation(
            behavioralProfile,
            'Observation was not eligible for learning because of transaction context or risk assessment.',
          ),
          accepted: false,
          reason: 'Observation quarantined by transaction risk and context safeguards.',
        };
    const { data: savedProfile, error: saveProfileError } = await context.databaseClient
      .from('banking_profiles')
      .update({
        baseline: serializeBehavioralProfile(result.profile),
        sessions_count: result.profile.acceptedSessions,
        profile_revision: result.profile.revision,
        updated_at: result.profile.updatedAt,
      })
      .eq('user_id', context.user.id)
      .eq('profile_revision', behavioralProfile.revision)
      .select('user_id')
      .maybeSingle();
    if (saveProfileError) {
      profileLearning = 'Transaction was recorded, but profile history could not be updated. Refresh before continuing.';
    } else if (!savedProfile) {
      profileLearning = 'Transaction was recorded, but the profile changed concurrently. Refresh the profile before further learning.';
    } else {
      profileLearning = result.reason;
    }
  }

  return bankingJson(context, {
    transaction: toClientTransaction(inserted as TransactionRow),
    profileLearning,
  }, 201);
}

export async function PATCH(request: NextRequest) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const rateLimitError = bankingRateLimit(request, 'banking-transaction-state', 30);
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
  const body = parsedBody as { id?: unknown; action?: unknown };
  if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) ||
      !['authorize', 'complete', 'cancel'].includes(String(body.action))) {
    return bankingJson(context, { error: 'Transaction action or identifier is invalid.' }, 400);
  }

  const { data: transaction, error: lookupError } = await context.databaseClient
    .from('banking_transactions')
    .select('id, amount, new_beneficiary, status, assessment, synthetic_observation, verified_at, created_at')
    .eq('id', body.id)
    .eq('user_id', context.user.id)
    .maybeSingle();
  if (lookupError) return bankingJson(context, { error: 'Could not load the transaction.' }, 500);
  if (!transaction) return bankingJson(context, { error: 'Transaction was not found.' }, 404);

  let nextStatus: string;
  let verifiedAt: string | null = transaction.verified_at;
  let eventType: string;
  if (body.action === 'authorize') {
    if (!['held', 'awaiting-verification'].includes(transaction.status)) {
      return bankingJson(context, { error: 'This transaction does not require step-up authorization.' }, 409);
    }
    const createdAt = new Date(transaction.created_at).getTime() / 1000;
    if (!context.recentAuthTime || context.recentAuthTime <= createdAt ||
        context.recentAuthTime > Date.now() / 1000 + 30 ||
        Date.now() / 1000 - context.recentAuthTime > 5 * 60) {
      return bankingJson(context, {
        error: 'A new email reauthentication is required before this high-risk transaction can proceed.',
      }, 403);
    }
    nextStatus = 'allowed';
    verifiedAt = new Date().toISOString();
    eventType = 'step_up_verified';
  } else if (body.action === 'complete') {
    if (transaction.status !== 'allowed' || !canCompleteTransaction(transaction.assessment as TransactionAssessment)) {
      return bankingJson(context, { error: 'Transaction is not in an allowed state.' }, 409);
    }
    const needsStepUp = ['hold', 'step-up'].includes(transaction.assessment.action) ||
      (transaction.assessment.action === 'insufficient-evidence' &&
       transaction.assessment.fallback === 'step-up');
    if (needsStepUp && !transaction.verified_at) {
      return bankingJson(context, { error: 'Step-up authorization must be completed first.' }, 403);
    }
    nextStatus = 'completed';
    eventType = 'completed';
  } else {
    if (transaction.status === 'completed' || transaction.status === 'cancelled') {
      return bankingJson(context, { error: 'A finalized transaction cannot be cancelled.' }, 409);
    }
    nextStatus = 'cancelled';
    eventType = 'cancelled';
  }

  const stateChangedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await context.databaseClient
    .from('banking_transactions')
    .update({ status: nextStatus, verified_at: verifiedAt, updated_at: stateChangedAt })
    .eq('id', transaction.id)
    .eq('user_id', context.user.id)
    .eq('status', transaction.status)
    .select('id, amount, new_beneficiary, status, assessment, synthetic_observation, verified_at, created_at')
    .maybeSingle();
  if (updateError) return bankingJson(context, { error: 'Could not update the transaction state.' }, 500);
  if (!updated) return bankingJson(context, { error: 'Transaction state changed; refresh and try again.' }, 409);

  const auditResult = await writeAuditEvent(context, transaction.id, eventType, {
    from: transaction.status,
    to: nextStatus,
  });
  if (auditResult.error) {
    const { data: rollback } = await context.databaseClient
      .from('banking_transactions')
      .update({
        status: transaction.status,
        verified_at: transaction.verified_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id)
      .eq('user_id', context.user.id)
      .eq('status', nextStatus)
      .eq('updated_at', stateChangedAt)
      .select('id')
      .maybeSingle();
    return bankingJson(context, {
      error: rollback
        ? 'Audit event could not be recorded; transaction state was restored. Refresh and retry.'
        : 'Audit event could not be recorded and the transaction changed concurrently. Refresh the server history before acting.',
    }, 500);
  }

  return bankingJson(context, { transaction: toClientTransaction(updated as TransactionRow) });
}
