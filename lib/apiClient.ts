import { rawVectorToArray, RawVector, FeatureDelta } from '@/app/demo/biometrics';

export function getDemoUserId(): string {
  if (typeof window === 'undefined') return 'demo-offline';
  try {
    let id = localStorage.getItem('finomaly_demo_uid') || sessionStorage.getItem('finomaly_demo_uid');
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'demo-' + Math.random().toString(36).substring(2, 11);
    }
    localStorage.setItem('finomaly_demo_uid', id);
    sessionStorage.setItem('finomaly_demo_uid', id);
    return id;
  } catch {
    return 'demo-session';
  }
}

/**
 * Sends a single enrollment vector to POST /api/enroll.
 * Automatically times out after 3000ms.
 */
export async function enrollSessionApi(
  vector: RawVector,
  userId = getDemoUserId()
): Promise<{ success: boolean; sessionsCount?: number; enrolled?: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('/api/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finomaly-client': 'web',
      },
      body: JSON.stringify({
        userId,
        vector: rawVectorToArray(vector),
        consent: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return { success: true, sessionsCount: data.sessionsCount, enrolled: data.enrolled };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * Sends live vector to POST /api/verify.
 * Automatically times out after 3000ms and falls back silently.
 */
export async function verifySessionApi(
  vector: RawVector,
  flags?: { pasteDetected?: boolean; botSuspected?: boolean },
  userId = getDemoUserId(),
  clientBaseline?: RawVector[]
): Promise<{
  success: boolean;
  score?: number;
  band?: string;
  featureDeltas?: FeatureDelta[];
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finomaly-client': 'web',
      },
      body: JSON.stringify({
        userId,
        vector: rawVectorToArray(vector),
        flags,
        clientBaseline,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        score: data.score,
        band: data.band,
        featureDeltas: data.featureDeltas,
      };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}
