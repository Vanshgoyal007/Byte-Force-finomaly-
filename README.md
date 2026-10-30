# Finomaly — Behavioral Biometrics & Mule Account Detection Layer

Finomaly is an auxiliary verification prototype engineered to detect **mule accounts, account takeovers, and unauthorized operators** through continuous behavioral biometrics.

---

## The Problem: The Identity Gap in Authentication

Traditional security relies heavily on static credentials (passwords, PINs) and 2FA (SMS OTPs, authenticator apps). 

In mule account fraud and credential takeover schemes:
* Fraudsters routinely possess correct passwords and valid OTPs (purchased or coerced).
* Traditional authentication passes the imposter because credentials check out at login.

**Finomaly evaluates a complementary signal:** *Does the person behind the keyboard type and navigate like the legitimate account owner?*

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
  Captures a multi-session baseline profile (`S1`, `S2`, `S3`) to construct an accurate behavioral centroid.

* **Hybrid Similarity Engine (`biometrics.ts`)**:
  Combines **Weighted Cosine Similarity** with a **Euclidean Distance Penalty**. Notable behavioral gaps (such as WPM differences or hold time anomalies) proportionally adjust the similarity score.

* **Zero-Telemetry & Copy-Paste Interceptor**:
  Flags synthetic key injection, zero-variance robotic typing, and clipboard paste actions.

* **Privacy by Design**:
  Only numeric timing vectors are evaluated, never what you type. No plaintext keystroke content, passwords, or financial data are stored.

---

## Architecture

```text
[ Browser captures timing ] ──(POST /api/verify)──> [ Next.js API Handler ] ──> [ Supabase Postgres ]
                                                              │                          │
                                                     (Hybrid Score & EMA)          (Audit Logs)
                                                              │                          │
                                                              ▼                          ▼
                                                     [ Return Score & Band ] ──> [ Bank Risk Engine ]
```

* **Privacy Isolation**: The browser only emits 5 anonymized timing metrics (Hold Time, Flight Time, WPM, Hold Variance, Flight Variance). Raw keystrokes and sensitive text are never transferred or stored.
* **Resilient Dual-Mode Verification**: Requests feature a 3-second timeout. If the database or network drops, the client transparently falls back to local mathematical verification, ensuring continuous uptime.

---

## Tech Stack

* **Frontend & Framework**: Next.js 14 (App Router), React 18, TypeScript 5, Framer Motion
* **Styling**: Tailored dark fintech aesthetic with locally bundled Manrope typography
* **Backend & Database**: Next.js Route Handlers (`/api/enroll`, `/api/verify`, `/api/audit`), Supabase Postgres
* **Security Guardrails**: Rate limiting per IP, API key validation, input bounds sanitization, ephemeral client session tracking

---

## Project Structure

```text
finomaly/
├── app/
│   ├── api/
│   │   ├── enroll/route.ts          # POST /api/enroll (Centroid 3-session profile)
│   │   ├── verify/route.ts          # POST /api/verify (Hybrid score, EMA baseline update, audit logging)
│   │   └── audit/route.ts           # GET /api/audit (Recent verification records)
│   ├── audit/
│   │   └── page.tsx                 # SOC operations audit log table
│   ├── challenge/
│   │   └── page.tsx                 # Two-person imposter challenge
│   ├── demo/
│   │   ├── page.tsx                 # Full-page 3-step verification demo
│   │   └── biometrics.ts            # Hybrid similarity engine & vector extraction
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
│   ├── apiClient.ts                 # Resilient API client with fallback
│   ├── apiSecurity.ts               # Rate limiting & key validation
│   └── supabase.ts                  # Server-side Supabase client
└── supabase/
    └── schema.sql                   # SQL schema for profiles & audit_logs
```

---

## Environment Variables

For local development or deployment, set the following environment variables:

```env
# Supabase (Server-side only)
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"

# API Security
API_KEY="your-secure-internal-api-key"
NEXT_PUBLIC_DEMO_KEY="your-secure-internal-api-key"
```

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

---

## Team

* **Charvi Naresh**
* **Vasu Sharma**

---

## Disclaimer

*Finomaly is an interactive research prototype developed for hackathon and experimental demonstration purposes. Commercial banking deployment requires secure server-side enrollment, regulatory compliance reviews, anti-spoofing verification, and independent security audits.*
