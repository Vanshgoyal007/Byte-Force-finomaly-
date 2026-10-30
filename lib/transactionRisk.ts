export const DEFAULT_RISK_POLICY = {
  minimumBaselineSamples: 3,
  minimumObservedKeys: 20,
  matchSimilarity: 0.85,
  anomalySimilarity: 0.65,
  highValueAmount: 1000,
} as const;

export type ObservationLabel = 'genuine' | 'suspicious' | 'insufficient' | 'unlabeled';
export type RiskAction = 'allow' | 'step-up' | 'hold' | 'insufficient-evidence';
export type FallbackAction = 'allow' | 'step-up';

export interface TransactionAssessmentInput {
  similarity: number | null;
  baselineSamples: number;
  observedKeys: number;
  amount: number;
  newBeneficiary: boolean;
  stepUpVerified?: boolean;
  contextualBaselineUsed?: boolean;
  profileReliable?: boolean;
  featureDeviations?: Array<{
    feature: string;
    observed: number;
    expectedMedian: number;
    expectedVariability: number;
    normalizedDeviation: number;
  }>;
}

export interface AssessedFeatureDeviation {
  feature: string;
  observed: number;
  expectedMedian: number;
  expectedVariability: number;
  normalizedDeviation: number;
}

export interface TransactionAssessment {
  action: RiskAction;
  fallback?: FallbackAction;
  riskScore: number | null;
  reasons: string[];
  evidenceReliable: boolean;
  featureDeviations?: AssessedFeatureDeviation[];
  contextualBaselineUsed?: boolean;
}

export interface LabeledObservation {
  label: ObservationLabel;
  similarity: number | null;
}

export interface ConfusionMetrics {
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  excluded: number;
  precision: number;
  recall: number;
  f1: number;
  specificity: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
}

export function assessTransaction(
  input: TransactionAssessmentInput,
  policy = DEFAULT_RISK_POLICY,
): TransactionAssessment {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Transaction amount must be a positive finite number.');
  }
  if (!Number.isInteger(input.baselineSamples) || input.baselineSamples < 0) {
    throw new Error('Baseline sample count must be a non-negative integer.');
  }
  if (!Number.isInteger(input.observedKeys) || input.observedKeys < 0) {
    throw new Error('Observed key count must be a non-negative integer.');
  }
  if (input.similarity !== null && (!Number.isFinite(input.similarity) || input.similarity < 0 || input.similarity > 1)) {
    throw new Error('Similarity must be null or a number between 0 and 1.');
  }
  if (policy.minimumBaselineSamples < 1 || policy.minimumObservedKeys < 1 ||
      policy.matchSimilarity <= policy.anomalySimilarity ||
      policy.anomalySimilarity < 0 || policy.matchSimilarity > 1 ||
      policy.highValueAmount <= 0) {
    throw new Error('Risk policy thresholds are invalid.');
  }

  const highContext = input.amount >= policy.highValueAmount || input.newBeneficiary;
  const reasons: string[] = [];
  if (input.amount >= policy.highValueAmount) reasons.push('High-value transaction under the configured demo threshold.');
  if (input.newBeneficiary) reasons.push('Transfer is to a newly entered beneficiary.');

  const evidenceReliable =
    input.baselineSamples >= policy.minimumBaselineSamples &&
    input.observedKeys >= policy.minimumObservedKeys &&
    input.similarity !== null &&
    input.profileReliable !== false;

  if (input.stepUpVerified) {
    if (!evidenceReliable) reasons.push('Behavioral evidence remains insufficient; the simulated verification is the fallback.');
    reasons.push('The simulated additional verification was completed.');
    return {
      action: 'allow',
      riskScore: input.similarity === null ? null : Math.round((1 - input.similarity) * 100),
      reasons,
      evidenceReliable,
    };
  }

  if (!evidenceReliable) {
    reasons.push('Behavioral evidence is insufficient for a reliable comparison.');
    if (input.profileReliable === false) {
      reasons.push('The personalized profile is still maturing; this is insufficient evidence, not an impostor finding.');
    }
    const fallback: FallbackAction = highContext ? 'step-up' : 'allow';
    reasons.push(
      fallback === 'allow'
        ? 'Configured fallback allows this routine simulation without a behavioral match.'
        : 'Configured fallback requires additional verification for this transaction context.',
    );
    return {
      action: 'insufficient-evidence',
      fallback,
      riskScore: null,
      reasons,
      evidenceReliable: false,
    };
  }

  const similarity = input.similarity as number;
  const riskScore = Math.round((1 - similarity) * 100);
  if (input.contextualBaselineUsed) {
    reasons.push('Comparison used a sufficiently sampled behavioral profile for this coarse device context.');
  }
  const featureDeviations = (input.featureDeviations ?? [])
    .filter((deviation) => Number.isFinite(deviation.normalizedDeviation) && deviation.normalizedDeviation >= 1)
    .sort((a, b) => b.normalizedDeviation - a.normalizedDeviation)
    .slice(0, 3);
  for (const deviation of featureDeviations) {
    reasons.push(
      `${deviation.feature} was ${deviation.normalizedDeviation.toFixed(1)} expected variability units from its profile median.`,
    );
  }
  if (similarity < policy.anomalySimilarity) {
    reasons.push('Typing similarity is below the configured anomaly threshold.');
  } else if (similarity < policy.matchSimilarity) {
    reasons.push('Typing similarity is below the configured routine-match threshold.');
  } else {
    reasons.push('Typing similarity is within the configured routine-match range.');
  }

  if (highContext && similarity < policy.anomalySimilarity) {
    reasons.push('High transaction context combined with a low similarity requires a review hold.');
    return {
      action: 'hold',
      riskScore,
      reasons,
      evidenceReliable: true,
      featureDeviations,
      contextualBaselineUsed: input.contextualBaselineUsed,
    };
  }
  if (highContext || similarity < policy.matchSimilarity) {
    reasons.push('The configured policy requires simulated additional verification before completion.');
    return {
      action: 'step-up',
      riskScore,
      reasons,
      evidenceReliable: true,
      featureDeviations,
      contextualBaselineUsed: input.contextualBaselineUsed,
    };
  }

  return {
    action: 'allow',
    riskScore,
    reasons,
    evidenceReliable: true,
    featureDeviations,
    contextualBaselineUsed: input.contextualBaselineUsed,
  };
}

export function canCompleteTransaction(assessment: TransactionAssessment): boolean {
  return assessment.action === 'allow' ||
    (assessment.action === 'insufficient-evidence' && assessment.fallback === 'allow');
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateConfusionMetrics(
  observations: LabeledObservation[],
  suspiciousThreshold: number,
): ConfusionMetrics {
  if (!Number.isFinite(suspiciousThreshold) || suspiciousThreshold < 0 || suspiciousThreshold > 1) {
    throw new Error('Suspicious threshold must be between 0 and 1.');
  }

  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let excluded = 0;

  for (const observation of observations) {
    if (
      observation.label === 'insufficient' ||
      observation.label === 'unlabeled' ||
      observation.similarity === null ||
      !Number.isFinite(observation.similarity) ||
      observation.similarity < 0 ||
      observation.similarity > 1
    ) {
      excluded += 1;
      continue;
    }

    const predictedSuspicious = observation.similarity < suspiciousThreshold;
    if (observation.label === 'suspicious' && predictedSuspicious) truePositive += 1;
    else if (observation.label === 'suspicious') falseNegative += 1;
    else if (predictedSuspicious) falsePositive += 1;
    else trueNegative += 1;
  }

  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const specificity = ratio(trueNegative, trueNegative + falsePositive);

  return {
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    excluded,
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    specificity,
    falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
    falseNegativeRate: ratio(falseNegative, falseNegative + truePositive),
  };
}

export function completeTransaction(assessment: TransactionAssessment): TransactionAssessment {
  if (!canCompleteTransaction(assessment)) {
    throw new Error('Transaction cannot be completed until its required verification is satisfied.');
  }
  return assessment;
}
