'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  extractRawVector,
  IGNORED_KEYS,
  RawVector,
} from '../demo/biometrics';
import {
  BehavioralProfile,
  BehaviorObservation,
  CursorSample,
  deriveBehaviorObservation,
  observationFromRawVector,
  profileFromStoredValue,
  validateBehaviorObservation,
} from '../../lib/behavioralProfile';
import {
  calculateConfusionMetrics,
  DEFAULT_RISK_POLICY,
  LabeledObservation,
  TransactionAssessment,
} from '../../lib/transactionRisk';
import styles from './banking.module.css';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

const PROFILE_KEY = 'finomaly_baseline_v4';
const DEMO_OBSERVATIONS: LabeledObservation[] = [
  { label: 'genuine', similarity: 0.94 },
  { label: 'genuine', similarity: 0.88 },
  { label: 'genuine', similarity: 0.91 },
  { label: 'genuine', similarity: 0.78 },
  { label: 'genuine', similarity: 0.72 },
  { label: 'suspicious', similarity: 0.42 },
  { label: 'suspicious', similarity: 0.57 },
  { label: 'suspicious', similarity: 0.63 },
  { label: 'suspicious', similarity: 0.74 },
  { label: 'insufficient', similarity: null },
  { label: 'unlabeled', similarity: null },
];
type TransactionStatus =
  | 'held'
  | 'awaiting-verification'
  | 'allowed'
  | 'completed'
  | 'cancelled';

interface DemoTransaction {
  id: string;
  amount: number;
  newBeneficiary: boolean;
  status: TransactionStatus;
  assessment: TransactionAssessment;
  createdAt: string;
  syntheticObservation: boolean;
  verifiedAt: string | null;
}

interface BankingAuditEvent {
  id: string;
  transaction_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

function statusLabel(status: TransactionStatus): string {
  return {
    held: 'Held for review',
    'awaiting-verification': 'Awaiting verification',
    allowed: 'Allowed in simulation',
    completed: 'Completed in simulation',
    cancelled: 'Cancelled',
  }[status];
}

function auditEventDescription(event: BankingAuditEvent): string {
  const action = typeof event.details.action === 'string' ? event.details.action : null;
  const from = typeof event.details.from === 'string' ? event.details.from : null;
  const to = typeof event.details.to === 'string' ? event.details.to : null;
  if (event.event_type === 'evaluated' && action) return `Risk assessment recorded: ${action}.`;
  if (from && to) return `Transaction state changed from ${from} to ${to}.`;
  return 'Transaction security event recorded.';
}

function isEmailRateLimitError(message: string, status?: number): boolean {
  return status === 429 || /email rate|rate limit|too many requests|over_email_send_rate_limit/i.test(message);
}

export default function BankingDemoPage() {
  const [baseline, setBaseline] = useState<RawVector[]>([]);
  const [baselineObservations, setBaselineObservations] = useState<BehaviorObservation[]>([]);
  const [serverBaselineCount, setServerBaselineCount] = useState(0);
  const [behaviorProfile, setBehaviorProfile] = useState<BehavioralProfile | null>(null);
  const [transactions, setTransactions] = useState<DemoTransaction[]>([]);
  const [auditEvents, setAuditEvents] = useState<BankingAuditEvent[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [emailRateLimited, setEmailRateLimited] = useState(false);
  const [profileConsent, setProfileConsent] = useState(false);
  const [pendingStepUp, setPendingStepUp] = useState<Record<string, boolean>>({});
  const [stepUpCodes, setStepUpCodes] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('75');
  const [newBeneficiary, setNewBeneficiary] = useState(false);
  const [typedSample, setTypedSample] = useState('');
  const [consentToTiming, setConsentToTiming] = useState(false);
  const [consentToProfileLearning, setConsentToProfileLearning] = useState(false);
  const [syntheticObservation, setSyntheticObservation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [evaluationThreshold, setEvaluationThreshold] = useState('0.65');
  const [notice, setNotice] = useState('');
  const submissionInProgress = useRef(false);
  const downTimes = useRef(new Map<string, number>());
  const holdTimes = useRef<number[]>([]);
  const flightTimes = useRef<number[]>([]);
  const cursorSamples = useRef<CursorSample[]>([]);
  const clickTimes = useRef<number[]>([]);
  const interactionTimes = useRef<number[]>([]);
  const idleMs = useRef(0);
  const focusTransitions = useRef(0);
  const lastInteractionAt = useRef<number | null>(null);
  const lastPointerSampleAt = useRef<number | null>(null);
  const lastKeyUp = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);

  const loadAccountData = async () => {
    const profileResponse = await fetch('/api/banking/profile', { cache: 'no-store' });
    const profileData = await profileResponse.json();
    if (!profileResponse.ok) throw new Error(profileData.error || 'Could not load your profile.');
    const transactionResponse = await fetch('/api/banking/transactions', { cache: 'no-store' });
    const transactionData = await transactionResponse.json();
    if (!transactionResponse.ok) throw new Error(transactionData.error || 'Could not load transaction history.');
    setServerBaselineCount(Number(profileData.sessionsCount) || 0);
    setBehaviorProfile(profileFromStoredValue(profileData.profile));
    setTransactions(Array.isArray(transactionData.transactions) ? transactionData.transactions : []);
    setAuditEvents(Array.isArray(transactionData.events) ? transactionData.events : []);
    setStorageError(null);
  };

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStorageError('Supabase is not configured. Set the public Auth URL/key and private server URL/service-role key in .env.local, then restart.');
      setAuthReady(true);
      return;
    }

    try {
      const saved = localStorage.getItem(PROFILE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && 'sessions' in parsed) {
          const sessions = (parsed as { sessions?: unknown }).sessions;
          if (Array.isArray(sessions)) {
            setBaseline(sessions as RawVector[]);
            const savedObservations = 'observations' in parsed
              ? (parsed as { observations?: unknown }).observations
              : null;
            if (Array.isArray(savedObservations) && savedObservations.every(validateBehaviorObservation)) {
              setBaselineObservations(savedObservations);
            } else {
              setBaselineObservations(sessions.map((vector) => observationFromRawVector(vector as RawVector)));
            }
          }
        }
      }
    } catch {
      setStorageError('A saved browser baseline could not be read. You can still sign in and enroll again.');
    }

    let active = true;
    const loadInitialUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error) setAuthMessage(error.message);
      setSignedInEmail(user?.email ?? null);
      setAuthReady(true);
      if (user) {
        try {
          await loadAccountData();
        } catch (loadError) {
          if (active) setStorageError(loadError instanceof Error ? loadError.message : 'Could not load account data.');
        }
      }
    };
    void loadInitialUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedInEmail(session?.user.email ?? null);
      if (!session) {
        setTransactions([]);
        setAuditEvents([]);
        setServerBaselineCount(0);
        setBehaviorProfile(null);
        return;
      }
      window.setTimeout(() => {
        void loadAccountData().catch((loadError: unknown) => {
          setStorageError(loadError instanceof Error ? loadError.message : 'Could not load account data.');
        });
      }, 0);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const metrics = useMemo(
    () => calculateConfusionMetrics(DEMO_OBSERVATIONS, Number(evaluationThreshold)),
    [evaluationThreshold],
  );
  const completedTotal = transactions
    .filter((transaction) => transaction.status === 'completed')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const displayedBalance = Math.max(0, 8240 - completedTotal);

  const resetObservation = () => {
    setTypedSample('');
    downTimes.current.clear();
    holdTimes.current = [];
    flightTimes.current = [];
    cursorSamples.current = [];
    clickTimes.current = [];
    interactionTimes.current = [];
    idleMs.current = 0;
    focusTransitions.current = 0;
    lastInteractionAt.current = null;
    lastPointerSampleAt.current = null;
    lastKeyUp.current = null;
    startedAt.current = null;
  };

  const recordInteraction = (at: number) => {
    if (lastInteractionAt.current !== null && at - lastInteractionAt.current >= 2000) {
      idleMs.current += at - lastInteractionAt.current;
    }
    lastInteractionAt.current = at;
    if (interactionTimes.current.length < 500) interactionTimes.current.push(at);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.repeat || IGNORED_KEYS.has(event.key)) return;
    const now = performance.now();
    recordInteraction(now);
    if (startedAt.current === null) startedAt.current = now;
    downTimes.current.set(event.key, now);
    if (lastKeyUp.current !== null) flightTimes.current.push(Math.max(0, now - lastKeyUp.current));
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (IGNORED_KEYS.has(event.key)) return;
    const now = performance.now();
    recordInteraction(now);
    const downAt = downTimes.current.get(event.key);
    if (downAt !== undefined) {
      holdTimes.current.push(now - downAt);
      downTimes.current.delete(event.key);
    }
    lastKeyUp.current = now;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLTextAreaElement>) => {
    if (!consentToTiming) return;
    const now = performance.now();
    if (lastPointerSampleAt.current !== null && now - lastPointerSampleAt.current < 50) return;
    if (cursorSamples.current.length < 250) {
      cursorSamples.current.push({ at: now, x: event.clientX, y: event.clientY });
    }
    lastPointerSampleAt.current = now;
  };

  const onSampleClick = () => {
    if (!consentToTiming) return;
    const now = performance.now();
    recordInteraction(now);
    if (clickTimes.current.length < 100) clickTimes.current.push(now);
  };

  const sendSignInLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setStorageError('Supabase Auth is not configured.');
    setAuthBusy(true);
    setAuthMessage('');
    setEmailRateLimited(false);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/banking` },
    });
    setAuthBusy(false);
    if (error) {
      const rateLimited = isEmailRateLimitError(error.message, error.status);
      setEmailRateLimited(rateLimited);
      setAuthMessage(rateLimited
        ? 'Supabase is temporarily refusing sign-in emails because the project email quota was reached.'
        : error.message);
    } else setAuthMessage('Sign-in link sent. Open it from this device to continue.');
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) setStorageError(error.message);
  };

  const syncProfile = async () => {
    if (!profileConsent || baseline.length < DEFAULT_RISK_POLICY.minimumBaselineSamples) {
      setStorageError('Consent and three saved browser baseline observations are required before syncing.');
      return;
    }
    const observations = baselineObservations.slice(0, 3);
    const hasEligibleFeatureObservations = observations.length === 3 &&
      observations.every((observation) =>
        observation.observedKeys >= 20 &&
        typeof observation.features.avgHoldTime === 'number' &&
        typeof observation.features.avgFlightTime === 'number' &&
        typeof observation.features.wpm === 'number',
      );
    const payload = hasEligibleFeatureObservations
      ? { observations, consent: profileConsent }
      : { sessions: baseline.slice(0, 3), consent: profileConsent };
    const response = await fetch('/api/banking/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setStorageError(data.error || 'Could not save your profile.');
      return;
    }
    setProfileConsent(false);
    setStorageError(null);
    await loadAccountData();
    setNotice('Three numeric baseline observations were saved to your authenticated Supabase account.');
  };

  const deleteServerProfile = async () => {
    if (!window.confirm('Delete the numeric baseline associated with this signed-in account? This cannot be undone.')) return;
    const response = await fetch('/api/banking/profile', { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setStorageError(data.error || 'Could not delete the profile.');
      return;
    }
    setServerBaselineCount(0);
    setBehaviorProfile(null);
    setNotice('The account baseline was deleted. Browser-local typing-lab data remains until you reset it there.');
  };

  const submitTransaction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    if (submissionInProgress.current) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > displayedBalance) {
      setNotice(`Enter an amount greater than $0 and no more than the simulated balance of $${displayedBalance.toFixed(2)}.`);
      return;
    }
    if (!syntheticObservation && consentToTiming && typedSample.trim().length < 25) {
      setNotice('Type at least 25 characters for a live timing observation, or turn off collection to use the insufficient-evidence fallback.');
      return;
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    let observedKeys = 0;
    let vector: RawVector | undefined;
    let behaviorObservation: BehaviorObservation | undefined;
    if (!syntheticObservation && consentToTiming) {
      observedKeys = holdTimes.current.length;
      if (observedKeys >= DEFAULT_RISK_POLICY.minimumObservedKeys) {
        const duration = startedAt.current === null ? 0 : performance.now() - startedAt.current;
        vector = extractRawVector({
          keystrokes: holdTimes.current.map((holdTime) => ({ key: '', downTime: 0, upTime: holdTime, holdTime })),
          flights: flightTimes.current.map((flightTime) => ({ fromKey: '', toKey: '', flightTime })),
          totalDurationMs: duration,
          charCount: typedSample.length,
        });
        behaviorObservation = deriveBehaviorObservation({
          holdTimes: holdTimes.current,
          flightTimes: flightTimes.current,
          elapsedMs: duration,
          characterCount: typedSample.length,
          cursorSamples: cursorSamples.current,
          clickTimes: clickTimes.current,
          interactionTimes: interactionTimes.current,
          idleMs: idleMs.current,
          focusTransitions: focusTransitions.current,
          deviceContext: window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer',
        });
      }
    }

    try {
      const response = await fetch('/api/banking/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parsedAmount,
          newBeneficiary,
          observedKeys,
          syntheticObservation,
          allowProfileLearning: consentToProfileLearning,
          ...(vector ? { vector } : {}),
          ...(behaviorObservation ? { behaviorObservation } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not evaluate this transaction.');
      setTransactions((current) => [data.transaction as DemoTransaction, ...current]);
      setStorageError(null);
      await loadAccountData();
      const baseNotice =
        data.transaction.status === 'held'
          ? 'This simulated transaction is held; the server will not complete it without fresh email reauthentication.'
          : data.transaction.status === 'awaiting-verification'
            ? 'Fresh email reauthentication is required before this transaction can proceed.'
            : data.transaction.assessment.action === 'insufficient-evidence'
              ? 'Routine fallback applied; behavioral identity was not assessed.'
              : 'Server risk policy allows this simulated transaction to proceed.';
      setNotice(data.profileLearning ? `${baseNotice} ${data.profileLearning}` : baseNotice);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not evaluate this transaction.');
    }
    resetObservation();
    setConsentToTiming(false);
    setConsentToProfileLearning(false);
    setSubmitting(false);
    submissionInProgress.current = false;
  };

  const requestStepUp = async (transaction: DemoTransaction) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setStorageError('Supabase Auth is not configured.');
    const { error } = await supabase.auth.reauthenticate();
    if (error) {
      setStorageError(error.message);
      return;
    }
    setPendingStepUp((current) => ({ ...current, [transaction.id]: true }));
    setNotice(`A verification code was sent to ${signedInEmail}. Enter it below to authorize ${transaction.id}.`);
  };

  const authorizeTransaction = async (transaction: DemoTransaction) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !signedInEmail) return setStorageError('Sign in is required for verification.');
    const code = stepUpCodes[transaction.id]?.trim();
    if (!code) return setStorageError('Enter the email verification code.');
    const { error: otpError } = await supabase.auth.verifyOtp({
      email: signedInEmail,
      token: code,
      type: 'reauthentication',
    });
    if (otpError) return setStorageError(otpError.message);
    const updated = await updateTransaction(transaction, 'authorize');
    if (!updated) return;
    setPendingStepUp((current) => ({ ...current, [transaction.id]: false }));
    setStepUpCodes((current) => ({ ...current, [transaction.id]: '' }));
    setNotice(`${transaction.id} passed fresh email reauthentication. You can now complete the simulation.`);
  };

  const updateTransaction = async (transaction: DemoTransaction, action: 'authorize' | 'complete' | 'cancel'): Promise<boolean> => {
    const response = await fetch('/api/banking/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: transaction.id, action }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStorageError(data.error || 'Transaction state update failed.');
      return false;
    }
    setTransactions((current) => current.map((item) => item.id === transaction.id ? data.transaction : item));
    setStorageError(null);
    try {
      await loadAccountData();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Transaction was updated, but history could not be refreshed.');
    }
    if (action === 'complete') setNotice(`${transaction.id} completed in the simulation. No money was transferred.`);
    if (action === 'cancel') setNotice(`${transaction.id} cancelled.`);
    return true;
  };

  return (
    <main id="main-content" className={`container ${styles.main}`}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">Workspace / simulated banking</span>
          <h1>Risk-aware transfers.<br /><span className="serif-word">Before they proceed.</span></h1>
          <p className="text-muted">
            An authenticated prototype that evaluates an optional typing sample and transaction context.
            It does not connect to a bank or move money.
          </p>
        </div>
        <div className={styles.account}>
          <span className="small text-muted">DEMO ACCOUNT BALANCE</span>
          <strong>${displayedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          <span className="micro text-muted">Starting balance: $8,240.00 · fictional</span>
        </div>
      </header>

      {storageError && <p className={styles.error} role="alert">{storageError}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {!authReady ? (
        <p className={styles.disclosure} role="status">Checking Supabase sign-in…</p>
      ) : !signedInEmail ? (
        <section className={`panel ${styles.authPanel}`}>
          <span className="eyebrow">Supabase Auth / private demo data</span>
          <h2>Sign in to your demo account</h2>
          <p className="small text-muted">
            Transaction state and numeric baselines are stored under your authenticated Supabase user.
            This demo uses an emailed sign-in link; no passwords are entered here.
          </p>
          <form onSubmit={sendSignInLink} className={styles.form}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={authBusy || !email.trim()}>
              {authBusy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
          {authMessage && <p className="small" role="status">{authMessage}</p>}
          {emailRateLimited && (
            <div className={styles.error} role="alert">
              <strong>How to restore email sign-in</strong>
              <span>
                Supabase&apos;s built-in mailer is limited to 2 emails per project per hour. Wait for its quota window
                to reset and avoid repeated requests. For ongoing use, set up a transactional email provider such as
                Resend, then enter its SMTP host, port, username, password, and a sender address on your verified domain.
                Enabling the SMTP switch without all provider details will not increase the quota.
              </span>
              <span>
                <a href="https://supabase.com/dashboard/project/lyzgwfjmskuwkcvqgzdd/auth/smtp" target="_blank" rel="noreferrer">
                  Open this project&apos;s SMTP settings
                </a>
                {' · '}
                <a href="https://supabase.com/docs/guides/auth/auth-smtp" target="_blank" rel="noreferrer">
                  SMTP setup guide
                </a>
              </span>
            </div>
          )}
          <p className="micro text-muted">Supabase Auth must be configured by the project owner. No API secret should be entered in this page.</p>
        </section>
      ) : (
        <>
          <div className={styles.accountBar}>
            <span>Signed in as <strong>{signedInEmail}</strong></span>
            <button type="button" className="btn btn-secondary" onClick={signOut}>Sign out</button>
          </div>
          <section className={styles.disclosure} aria-label="Behavioral measurement privacy">
            <strong>Typing measurement is opt-in for this transaction.</strong>
            <span>
              Only after you opt in and type in the sample box, this page measures key hold and inter-key timing.
              It does not save the text or key sequence. Do not type a password, PIN, or OTP.
              Numeric baselines and transaction state are stored in the signed-in Supabase account.
            </span>
          </section>

      <div className={styles.grid}>
        <section className={`panel ${styles.panel}`}>
          <div className="section-topline">
            <div><span className="eyebrow">01 / Review signals</span><h2>Session & profile</h2></div>
            <span className={`chip ${serverBaselineCount >= DEFAULT_RISK_POLICY.minimumBaselineSamples ? 'chip-success' : 'chip-warning'}`}>
              {serverBaselineCount >= DEFAULT_RISK_POLICY.minimumBaselineSamples ? 'Baseline ready' : 'Not enrolled'}
            </span>
          </div>
          {serverBaselineCount >= DEFAULT_RISK_POLICY.minimumBaselineSamples ? (
            <p className="small text-muted">
              {serverBaselineCount} numeric observations saved to this account. A reliable assessment still needs at least
              {` ${DEFAULT_RISK_POLICY.minimumObservedKeys} `}timed key events in the current sample.
            </p>
          ) : (
            <div>
              <p className="small text-muted">
                Supabase has {serverBaselineCount} of {DEFAULT_RISK_POLICY.minimumBaselineSamples} required observations.
                {` `}The typing lab has {baseline.length} browser-local observations. You must consent before sending
                three numeric, character-free feature summaries to your authenticated account.
              </p>
              {baseline.length >= DEFAULT_RISK_POLICY.minimumBaselineSamples ? (
                <div className={styles.syncBox}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={profileConsent} onChange={(event) => setProfileConsent(event.target.checked)} />
                    <span>I consent to save three derived numeric timing summaries in this Supabase account. Typed text and key identities are not included.</span>
                  </label>
                  <button type="button" className="btn btn-primary" disabled={!profileConsent} onClick={() => void syncProfile()}>
                    Save initial profile to account
                  </button>
                </div>
              ) : (
                <Link className="btn btn-secondary" href="/demo">Build a profile in the typing lab ↗</Link>
              )}
              {serverBaselineCount > 0 && (
                <button type="button" className="btn btn-text" onClick={() => void deleteServerProfile()}>
                  Delete saved account baseline
                </button>
              )}
            </div>
          )}
        </section>

        <section className={`panel ${styles.panel}`}>
          <div className="section-topline">
            <div><span className="eyebrow">02 / Simulate transfer</span><h2>Review before proceeding</h2></div>
            <span className="chip chip-neutral">Simulated; no real dispatch</span>
          </div>
          <form onSubmit={submitTransaction} className={styles.form}>
            <label>
              Amount (USD)
              <input
                type="number"
                min="0.01"
                max={displayedBalance}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={newBeneficiary}
                onChange={(event) => setNewBeneficiary(event.target.checked)}
              />
              <span>Transfer to a new beneficiary (simulated context)</span>
            </label>

            <label>
              Typing sample {consentToTiming ? '' : '(optional)'}
              <textarea
                rows={3}
                value={typedSample}
                onChange={(event) => setTypedSample(event.target.value)}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                onPointerMove={onPointerMove}
                onClick={onSampleClick}
                onFocus={() => {
                  focusTransitions.current += 1;
                  recordInteraction(performance.now());
                }}
                onBlur={() => {
                  focusTransitions.current += 1;
                  recordInteraction(performance.now());
                }}
                disabled={!consentToTiming || syntheticObservation}
                onPaste={(event) => {
                  event.preventDefault();
                  setNotice('Pasting is disabled because it does not produce a valid timing observation.');
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder={consentToTiming ? 'Type a non-sensitive sentence.' : 'Timing collection is off until you opt in.'}
                aria-describedby="sample-help"
              />
              <span id="sample-help" className="micro text-muted">
                {consentToTiming ? `${holdTimes.current.length} timed key events · at least 20 for assessment. ` : 'No timing is collected without consent. '}
                Typed content is held in page memory only and cleared after submission. Cursor data is sampled in this field and reduced to aggregate features in memory.
              </span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={consentToTiming}
                onChange={(event) => {
                  setConsentToTiming(event.target.checked);
                  if (!event.target.checked) {
                    resetObservation();
                    setConsentToProfileLearning(false);
                  }
                }}
              />
              <span>I consent to timing measurements in this sample for this transaction only. The text itself is not saved or sent.</span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={consentToProfileLearning}
                disabled={!consentToTiming}
                onChange={(event) => setConsentToProfileLearning(event.target.checked)}
              />
              <span>
                Separately allow this session&apos;s derived features to update my long-term profile only if server-side checks accept it.
                Suspicious, synthetic, incomplete, or high-context sessions will not be learned.
              </span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={syntheticObservation}
                onChange={(event) => setSyntheticObservation(event.target.checked)}
              />
              <span>Synthetic low-similarity observation (deterministic demo scenario; not measured from typing)</span>
            </label>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Evaluating…' : 'Evaluate before transfer'}
            </button>
          </form>
        </section>
      </div>

      {behaviorProfile && (
        <section className={`panel ${styles.profilePanel}`}>
          <div className="section-topline">
            <div><span className="eyebrow">03 / Behavioral identity profile</span><h2>Profile quality and evolution</h2></div>
            <span className={`chip ${
              behaviorProfile.reliability === 'usable' ? 'chip-success'
                : behaviorProfile.reliability === 'unreliable' ? 'chip-warning' : 'chip-neutral'
            }`}>
              {behaviorProfile.maturity} · {behaviorProfile.reliability} evidence
            </span>
          </div>
          <p className="small text-muted">
            {behaviorProfile.acceptedSessions} eligible sessions · revision {behaviorProfile.revision} · last updated {new Date(behaviorProfile.updatedAt).toLocaleString()}.
            {` `}{behaviorProfile.sessionDiversity.distinctDeviceContexts} coarse device contexts represented.
            These labels describe available evidence, not identity probabilities.
          </p>
          {behaviorProfile.reliability === 'unreliable' && (
            <p className={styles.profileWarning} role="status">
              Profile integrity warning: quarantined update attempts currently outnumber accepted observations. Do not rely on this profile until it is reviewed or reset.
            </p>
          )}
          <div className={styles.coverageGrid}>
            {Object.entries(behaviorProfile.signalCoverage).map(([signal, coverage]) => (
              <div key={signal}>
                <span>{signal}</span>
                <strong>{Math.round(coverage * 100)}% feature coverage</strong>
                <div className={styles.coverageTrack} aria-label={`${signal} feature coverage`}>
                  <span style={{ width: `${Math.round(coverage * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <h3 className={styles.profileSubheading}>Stable traits across eligible sessions</h3>
          {Object.keys(behaviorProfile.stableTraits).length ? (
            <div className={styles.traitGrid}>
              {Object.entries(behaviorProfile.stableTraits).map(([feature, distribution]) => distribution && (
                <div key={feature}>
                  <strong>{feature.replaceAll(/([A-Z])/g, ' $1')}</strong>
                  <span>Median {distribution.median.toFixed(1)} · MAD {distribution.medianAbsoluteDeviation.toFixed(1)}</span>
                  <small>{distribution.count} observations · {distribution.reliability}</small>
                </div>
              ))}
            </div>
          ) : <p className="small text-muted">No valid feature distributions are stored.</p>}
          <h3 className={styles.profileSubheading}>Most recent observed state</h3>
          <div className={styles.traitGrid}>
            {(['medianHoldTime', 'medianFlightTime', 'wpm'] as const).map((feature) => {
              const value = behaviorProfile.recentState[feature];
              return (
                <div key={feature}>
                  <strong>{feature.replaceAll(/([A-Z])/g, ' $1')}</strong>
                  <span>{typeof value === 'number' ? value.toFixed(1) : 'Not observed'}</span>
                  <small>Current recent state; stable distribution is shown separately above.</small>
                </div>
              );
            })}
          </div>
          <p className="micro text-muted">
            Recent session state is held separately from stable summaries. Contextual comparisons are used only after at least three observations exist in that coarse device category. Mouse and interaction signals remain missing until observed with opt-in.
            Distribution summaries use a bounded history of up to 100 feature-only session observations.
          </p>
          {behaviorProfile.missingModalities.length > 0 && (
            <ul className={styles.missingSignals}>
              {behaviorProfile.missingModalities.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}
          <h3 className={styles.profileSubheading}>Profile integrity history</h3>
          <ol className={styles.updateHistory}>
            {[...behaviorProfile.updateHistory].reverse().slice(0, 8).map((update) => (
              <li key={update.revision}>
                <strong>Revision {update.revision}: {update.outcome}</strong>
                <span>{update.reason}</span>
                <time dateTime={update.at}>{new Date(update.at).toLocaleString()}</time>
                {update.clippedFeatures.length > 0 && (
                  <small>Bounded updates: {update.clippedFeatures.join(', ')}</small>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-text" onClick={() => void deleteServerProfile()}>
            Delete profile and its history
          </button>
        </section>
      )}

      <section className={`panel ${styles.history}`}>
        <div className="section-topline">
          <div><span className="eyebrow">04 / Transaction state</span><h2>Simulation history</h2></div>
          <span className="micro text-muted">Account history is stored server-side</span>
        </div>
        {transactions.length === 0 ? (
          <p className="small text-muted">No simulated transfers yet. Evaluate a transfer to see its decision, reasons, and permitted next action.</p>
        ) : (
          <div className={styles.transactionList}>
            {transactions.map((transaction) => (
              <article className={styles.transaction} key={transaction.id}>
                <div className={styles.transactionTitle}>
                  <div>
                    <strong>{transaction.id}</strong>
                    <span className="small text-muted">{new Date(transaction.createdAt).toLocaleString()}</span>
                  </div>
                  <span className={`chip ${
                    transaction.status === 'completed' || transaction.status === 'allowed'
                      ? 'chip-success'
                      : transaction.status === 'held' || transaction.status === 'awaiting-verification'
                        ? 'chip-warning'
                        : 'chip-neutral'
                  }`}>{statusLabel(transaction.status)}</span>
                </div>
                <div className={styles.transactionSummary}>
                  <strong>${transaction.amount.toFixed(2)}</strong>
                  <span>{transaction.newBeneficiary ? 'New beneficiary' : 'Existing beneficiary context'}</span>
                  <span>{transaction.syntheticObservation ? 'Synthetic observation' : 'Live typing observation'}</span>
                  <span>
                    {transaction.assessment.riskScore === null
                      ? 'Behavioral risk: not assessed'
                      : `Behavioral risk score: ${transaction.assessment.riskScore}/100`}
                  </span>
                </div>
                <ul className={styles.reasons}>
                  {transaction.assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                {transaction.status === 'held' && (
                  <p className={styles.error}>Held before simulated completion. Fresh email reauthentication is required; no dispatch has occurred.</p>
                )}
                <div className={styles.actions}>
                  {(transaction.status === 'held' || transaction.status === 'awaiting-verification') && (
                    pendingStepUp[transaction.id] ? (
                      <div className={styles.stepUpForm}>
                        <label>
                          Email verification code
                          <input
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={stepUpCodes[transaction.id] ?? ''}
                            onChange={(event) => setStepUpCodes((current) => ({ ...current, [transaction.id]: event.target.value }))}
                          />
                        </label>
                        <button className="btn btn-primary" onClick={() => void authorizeTransaction(transaction)}>
                          Verify code and authorize
                        </button>
                      </div>
                    ) : (
                      <button className="btn btn-primary" onClick={() => void requestStepUp(transaction)}>
                        Send step-up code to email
                      </button>
                    )
                  )}
                  {transaction.status === 'allowed' && (
                    <button className="btn btn-primary" onClick={() => void updateTransaction(transaction, 'complete')}>
                      Complete in simulation
                    </button>
                  )}
                  {!['completed', 'cancelled'].includes(transaction.status) && (
                    <button className="btn btn-secondary" onClick={() => void updateTransaction(transaction, 'cancel')}>Cancel</button>
                  )}
                </div>
                {transaction.syntheticObservation && (
                  <p className="micro text-muted">Synthetic scenario only; this score is not a measurement of a person.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={`panel ${styles.history}`}>
        <div className="section-topline">
          <div><span className="eyebrow">05 / Security record</span><h2>Transaction audit events</h2></div>
          <span className="micro text-muted">Account-scoped, server-stored events</span>
        </div>
        {auditEvents.length === 0 ? (
          <p className="small text-muted">No transaction security events recorded yet.</p>
        ) : (
          <ol className={styles.auditList}>
            {auditEvents.map((event) => (
              <li key={event.id}>
                <span>{auditEventDescription(event)}</span>
                <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`panel ${styles.evaluation}`} id="evaluation">
        <div className="section-topline">
          <div><span className="eyebrow">06 / Repeatable evaluation</span><h2>Confusion matrix</h2></div>
          <label className={styles.threshold}>
            Suspicious if similarity is below
            <select value={evaluationThreshold} onChange={(event) => setEvaluationThreshold(event.target.value)}>
              <option value="0.55">55%</option>
              <option value="0.65">65%</option>
              <option value="0.75">75%</option>
              <option value="0.85">85%</option>
            </select>
          </label>
        </div>
        <p className="small text-muted">
          Synthetic fixture only, generated from fixed labeled scenarios for repeatability. “Suspicious” is the
          positive class. Insufficient and unlabeled examples are excluded. This is not real-user performance data.
        </p>
        <div className={styles.metricsGrid}>
          {[
            ['True positive', metrics.truePositive],
            ['True negative', metrics.trueNegative],
            ['False positive', metrics.falsePositive],
            ['False negative', metrics.falseNegative],
            ['Excluded', metrics.excluded],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className={styles.metricsGrid}>
          {[
            ['Precision', metrics.precision],
            ['Recall', metrics.recall],
            ['F1', metrics.f1],
            ['Specificity', metrics.specificity],
            ['False-positive rate', metrics.falsePositiveRate],
            ['False-negative rate', metrics.falseNegativeRate],
          ].map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{(Number(value) * 100).toFixed(1)}%</strong></div>
          ))}
        </div>
        <p className="micro text-muted">
          Policy thresholds are demonstration settings, not scientifically validated. Detection latency is not
          measured by this local synthetic fixture. Similarity and risk scores are not probabilities of identity.
        </p>
      </section>

      <footer className={styles.policyNote}>
        <strong>Demo policy</strong>
        <span>
          Baseline ≥ {DEFAULT_RISK_POLICY.minimumBaselineSamples} sessions; current sample ≥ {DEFAULT_RISK_POLICY.minimumObservedKeys} key events;
          match ≥ {DEFAULT_RISK_POLICY.matchSimilarity}; anomaly below {DEFAULT_RISK_POLICY.anomalySimilarity};
          high-value threshold ${DEFAULT_RISK_POLICY.highValueAmount}. These are configurable code defaults, not validated thresholds.
        </span>
      </footer>
        </>
      )}
    </main>
  );
}
