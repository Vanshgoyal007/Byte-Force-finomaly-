# Finomaly — Behavioral Biometrics Research Prototype

Finomaly is an auxiliary verification research prototype exploring typing rhythm as one uncertain signal during a simulated banking session. It does not establish identity or demonstrate real-world fraud-detection performance.

---

## The Problem: The Identity Gap in Authentication

Traditional security relies heavily on static credentials (passwords, PINs) and 2FA (SMS OTPs, authenticator apps). 

In mule account fraud and credential takeover schemes:
* Fraudsters routinely possess correct passwords and valid OTPs (purchased or coerced).
* Traditional authentication passes the imposter because credentials check out at login.

**Finomaly evaluates a complementary signal:** *How does a current typing sample compare with a saved baseline?* A deviation is a clue for a demonstration policy, not proof of account takeover.

---

## Key Features

* **5D Telemetry Vector Extraction**:
  Measures five distinct motor habits:
  1. *Average Keystroke Hold Time* (Dwell Time in ms)
  2. *Average Flight Time* (Gap between keypresses in ms)
  3. *Typing Speed* (Words Per Minute / WPM)
  4. *Hold Time Variance* (Consistency of key holds)
  5. *Flight Time Variance* (Rhythm consistency)

* **3-Session Baseline Enrollment**:
  Captures three observations to construct an experimental baseline centroid; this does not establish identity.

* **Hybrid Similarity Engine (`biometrics.ts`)**:
  Combines **Weighted Cosine Similarity** with a **Euclidean Distance Penalty**. A similarity score describes only closeness to the prototype baseline, not the probability that a user is legitimate.

* **Zero-Telemetry & Copy-Paste Interceptor**:
  Flags synthetic key injection, zero-variance robotic typing, and clipboard paste actions.

* **Privacy by Design**:
  The typing lab evaluates numeric timing features, not typed content. The new banking demo requires explicit timing consent and does not persist text, passwords, or raw key sequences.

---

## Architecture

```text
[ Supabase Auth email link ] ──(secure session cookie)──> [ Next.js middleware + API routes ]
                                                                     │
[ Browser numeric timing sample ] ──────────────────────────────────┤
                                                                     ▼
                                                      [ private server-side Supabase client ]
                                                                     │
                                       authenticated user scope + transaction-state checks
                                                                     ▼
                                                     [ RLS-protected Supabase tables ]
```

* The browser sends numeric features only; text and raw key sequences are not sent or stored.
* The server derives the account ID from a verified Supabase Auth session. It does not trust a client-supplied user ID.
* The service-role key is used only on the server. New tables have RLS enabled and no direct browser policies.
* State-changing API calls enforce same-origin checks, per-process rate limits, validation, and conditional state transitions.
* Verification requests do not automatically update the trusted baseline.

---

## Tech Stack

* **Frontend & Framework**: Next.js 14 (App Router), React 18, TypeScript 5, Framer Motion
* **Styling**: Tailored dark fintech aesthetic with locally bundled Manrope typography
* **Backend & Database**: Next.js Route Handlers and Supabase Postgres/Auth
* **Security Guardrails**: Cookie-backed Auth, server-derived user IDs, same-origin checks, RLS-denied direct data access, server-only service role, input validation, and rate limits

---

## Project Structure

```text
finomaly/
├── app/
│   ├── api/
│   │   ├── enroll/route.ts          # POST /api/enroll (Centroid 3-session profile)
│   │   ├── verify/route.ts          # Authenticated verification/audit endpoint
│   │   ├── banking/
│   │   │   ├── profile/route.ts     # Authenticated numeric profile operations
│   │   │   └── transactions/route.ts # Server-side risk decisions and state transitions
│   │   └── audit/route.ts           # Current-account verification records only
│   ├── audit/
│   │   └── page.tsx                 # SOC operations audit log table
│   ├── challenge/
│   │   └── page.tsx                 # Two-person imposter challenge
│   ├── banking/
│   │   └── page.tsx                 # Authenticated transaction-risk simulation and evaluation
│   ├── demo/
│   │   ├── page.tsx                 # Full-page 3-step verification demo
│   │   └── biometrics.ts            # Similarity engine & vector extraction
│   ├── globals.css                  # Design system tokens and styling
│   ├── dusk.css                     # Dark fintech theme rules
│   └── page.tsx                     # Landing page with interactive scroll experience
├── components/
│   ├── ScrollExperience.tsx         # Scroll-driven introduction
│   ├── TypingPlayground.tsx         # Live desk typing surface & rhythm strip
│   ├── FlatRadarChart.tsx           # Flat 5D radar chart comparison
│   ├── Navigation.tsx               # Header navigation
│   └── Footer.tsx                   # Footer layout
├── lib/
│   ├── transactionRisk.ts            # Testable policy and confusion-matrix calculations
│   ├── apiClient.ts                 # Resilient API client with fallback
│   ├── apiSecurity.ts               # Rate limiting & key validation
│   ├── supabase.ts                  # Server-only service-role client
│   ├── supabaseBrowser.ts           # Public-key Auth client
│   └── bankingAuth.ts               # Server-side Supabase session verification
├── middleware.ts                    # Refreshes cookie-backed Supabase sessions
└── supabase/
    └── schema.sql                   # Profiles, audit, and banking demo schema
```

---

## Optional backend environment variables

The informational pages and synthetic metrics work without credentials. Banking sign-in, storage, and server-side decisions require a Supabase project. Copy `.env.example` to `.env.local` and set:

For local development or deployment, set the following environment variables:

```env
# Use the Project URL shown in Supabase. The public URL/key are used for browser Auth,
# not privileged database writes.
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"

# Same Project URL and the server-only Secret key (sb_secret_...).
# If your dashboard only shows legacy keys, use service_role instead.
# Never use NEXT_PUBLIC_ for this privileged key.
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-secret-or-legacy-service-role-key"

# API Security (server-side only)
API_KEY="generate-a-strong-random-api-key-here"
ADMIN_API_KEY="generate-a-strong-random-admin-key-here"
```

Never paste the Secret/service_role key into chat, commit it, or put it in `NEXT_PUBLIC_*`. The anon/publishable key is intended for browser Auth; the SQL migration denies direct access to banking tables. `API_KEY` and `ADMIN_API_KEY` are separate optional app keys, not Supabase keys, and are not needed for the banking demo.

Run `supabase/schema.sql` in the Supabase SQL Editor. In Supabase Auth settings, enable email sign-in and configure the local/deployed `/banking` URL as an allowed redirect. After setting environment variables, restart Next.js.

---

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/charvi52/finomaly-new.git
   cd finomaly-new
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run local development**:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Simulated banking workflow

Open [http://localhost:3000/banking](http://localhost:3000/banking), sign in by emailed link, and evaluate a transaction. The workflow supports routine, high-value, new-beneficiary, insufficient-evidence, synthetic low-similarity, step-up, hold, and cancel outcomes. High-risk transactions require a fresh email reauthentication code before the server will authorize completion. The server verifies the reauthentication time and conditionally updates transaction state.

Supabase's built-in email sender is limited to 2 emails per project per hour and may only deliver to project team members. If the quota is reached, wait for the quota window to reset or configure a real SMTP provider under Supabase Authentication → SMTP Settings. Enabling the SMTP toggle without complete provider credentials and a valid sender address does not remove this limit. Do not retry repeatedly while rate-limited.

To try a live behavioral comparison, complete three observations in the typing lab at `/demo`, then return to `/banking` and explicitly consent to sync derived numeric features to your authenticated account. The profile keeps robust per-feature distributions, recent state, coarse pointer/touch context, signal coverage, maturity, and a bounded integrity history. Each transaction's timing collection is separately opt-in and limited to the designated sample box; cursor positions are sampled and reduced in memory to aggregates. Typed text, key identities, and raw cursor trajectories are not persisted. A separate opt-in allows learning from a transaction only when server-side risk and context checks accept it; suspicious, synthetic, incomplete, step-up, and high-context sessions are not learned. Profile changes are clipped per feature and large multi-feature deviations are quarantined. The profile uses at most the latest 100 derived observations and 50 update-history entries; deleting the account profile removes its stored profile and history.

The typing lab stores numeric session vectors and derived feature summaries in browser `localStorage` until the user resets or clears that browser data. This is browser-local storage, not encrypted credential storage; do not use it for sensitive text. The page also includes clearly labeled synthetic scenarios and confusion metrics. “Suspicious” is the positive class; insufficient and unlabeled examples are excluded. Synthetic fixture results are not customer data or evidence of real-world accuracy.

Banking profiles, transaction state, and audit events are stored in Supabase. Users cannot select another account ID; the server gets it from the verified Auth session and scopes database operations to it. Do not migrate live/customer data into this prototype. It is not connected to a bank, payment network, or real money transfer.

After updating an existing project to adaptive profiles, rerun `supabase/schema.sql` in the Supabase SQL Editor to expand the banking profile session-count constraint. The script is designed to be re-runnable and does not delete profile or transaction data.

## Risk policy and tests

The transaction policy is implemented in `lib/transactionRisk.ts`; profile statistics and adaptive safeguards are in `lib/behavioralProfile.ts`. It keeps behavioral similarity separate from transaction context: similarity is in `[0, 1]`, while the displayed behavioral risk score is `round((1 - similarity) × 100)` and is **not a probability**. Profile maturity requires multiple sessions and stable feature summaries; confidence percentages are not inferred. Defaults require three baseline observations and 20 current timed key events; the match threshold is `0.85`, anomaly threshold `0.65`, and high-value threshold `$1,000`. Insufficient evidence falls back to allowing a routine transaction with an explicit unassessed label, or step-up for high-context transactions. These are configurable prototype defaults, not validated thresholds. Mouse/interaction signals are opportunistic and may be absent, especially for profiles initially created from legacy typing-lab summaries.

The email reauthentication is a demonstration step-up, not a financial-grade second factor. A browser-generated timing vector is client-originated and can be manipulated by a determined user; it is not cryptographic proof of a typist. Rate limits use process memory and are not distributed. Government acceptance, certification, or compliance is not implied; real use needs an independent threat model, security/privacy review, managed rate limiting, operational monitoring, retention policy, and relevant regulatory assessment.

Run the deterministic policy and metrics tests with Node.js 22.6 or newer:

```bash
npm test
```

---

## Team

* **Charvi Naresh**
* **Vasu Sharma**

---

## Disclaimer

*Finomaly is an interactive research prototype developed for hackathon and experimental demonstration purposes. Similarity scores are not probabilities, synthetic metrics do not establish real-world performance, and simulated transaction controls do not freeze or transfer real funds. This implementation is not certified or approved by any government authority.*
