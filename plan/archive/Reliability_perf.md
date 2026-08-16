# Reliability and Performance Improvement Plan

A React + Express TypeScript health-tracking app with AI-powered food logging (via Gemini vision), biomarker tracking, and real-time sync.

## 🔴 The Core Problems: The Free Tier Death Spiral
1. **Firebase Firestore (The Crash Point):** Hits the 20,000 writes/day free limit *every single day*, causing `[code=resource-exhausted]` errors that completely paralyze the app.
2. **Supabase (The Egress Bleed):** Egress is skyrocketing (~83MB for just 20-30 food logs, averaging almost ~3MB+ per transaction). Payloads are massive because base64 images, huge LLM scratchpads, and debug logs are being saved directly in PostgreSQL and queried all at once without pagination.

---

## 🏗️ The Phased "Forever Free" Roadmap

### Phase 1: Complete Firebase Extrication (Stop the Crashes)
**Goal:** Completely sever the app's reliance on Firestore for data storage to permanently end the 20k write limit crashes.
*   **Action 1:** Remove all dual-write logic in `firestoreUtils.ts` and `SupabaseJobSync.ts`.
*   **Action 2:** Make Supabase the *exclusive* backend database for `jobs`, `food_logs`, and `biomarkers`.
*   **Action 3:** Retain Firebase *only* for Authentication (`@firebase/auth`), which has a separate, generous 50k MAU limit that doesn't consume Firestore database writes.

### Phase 2: Supabase Payload Diet (Stop the Egress Bleed)
**Goal:** Fix the 83MB/day egress issue before Supabase hits its 5GB free tier limit. Industry best practice dictates separating binary/large blob data from relational data.
*   **Action 1: Ban Base64 in DB:** Implement hard server-side validation to strip any `data:image/jpeg;base64` from database writes. Images must *only* live in Cloudflare R2.
*   **Action 2: Externalize Heavy Logs:** The AI `mealBuild` reasoning, `dietitianScratchpad`, and raw text logs can be 50-100KB per job. Ensure these massive JSON blobs are written strictly to R2 text files, and only store the lightweight R2 URL (`logsUrl`) in Supabase.
*   **Action 3: Query Projection (SELECT):** Change `SELECT *` frontend queries to `SELECT id, date, summary, photoUrl`. Never send the massive detailed JSON to the client unless they explicitly click to expand a specific log.
*   **Action 4: Cursor-Based Pagination:** Implement cursor-based pagination (e.g., using `created_at` or `id`) for the history feed so the frontend doesn't download 200+ logs on every refresh. Offset pagination is discouraged for large datasets.

### Phase 3: Monolith Splitting & Code Bloat
**Goal:** Improve maintainability, reduce server memory overhead, and align with Separation of Concerns (SoC) principles.
*   **Action 1:** Break the `server.ts` (784KB) monolith into modular Express routers using the Controller-Service pattern:
    - `routes/food.ts`
    - `routes/jobs.ts`
    - `routes/biomarkers.ts`
*   **Action 2: Controlled Debug Logging:** Replace indiscriminate `console.log` and `logSessionStorage` with a centralized, 3-level structured logger (Debug, Warn, Error).
*   **Action 3: Memoization:** Cache biomarker status calculations (`getBiomarkerStatus`) using React `useMemo` so they don't recalculate on every render cycle (O(N) CPU churn).
*   **Action 4:** Clean up dead code, unused imports, and consolidate redundant type definitions (run `npx knip`).

### Phase 4: AI Inference Resilience & Security
**Goal:** Prevent LLM timeouts from creating orphaned jobs and hanging the UI, and secure the application data.
*   **Action 1: Exponential Backoff & Circuit Breakers:** Implement a standard retry wrapper for all `genAI.generateContent` calls to handle rate limits gracefully.
*   **Action 2: Candidate Capping:** Cap semantic DB matches sent to the LLM to the top 3-5 items to reduce token bloat and processing time.
*   **Action 3: True Async Workers:** Move LLM processing to background workers polling the database, rather than blocking the active HTTP request.
*   **Action 4: Supabase RLS (Row-Level Security):** Enforce data privacy by adding policies ensuring `auth.uid() = user_id` for all `food_logs` and `biomarker_logs` tables.

### Phase 5: Testing, Validation, & CDN
**Goal:** Ensure long-term stability and global performance.
*   **Action 1: Expand Unit Tests:** Focus on `server_food_catalog.ts` (candidate filtering) and biomarker edge cases.
*   **Action 2: E2E Testing:** Implement Playwright or Cypress for critical paths (Upload -> Parse -> Edit -> Save).
*   **Action 3: Use CDN for Static Assets:** Deploy the `dist/` folder to Cloudflare Pages (free CDN) to offload asset serving from Cloud Run and improve global load times by 50-80%.

### Phase 6: [PENDING INVESTIGATION] Database Consolidation
**Goal:** Reach a mathematically un-crashable architecture under free tiers.
*   **Investigation & Execution:** Once Phase 1-5 are stable, investigate migrating the primary relational database from Supabase to **Cloudflare D1**.
*   **Why?** Cloudflare offers zero egress fees and generous free tiers for D1 (SQL) and R2 (Storage). Supabase egress can quickly become a bottleneck if usage spikes.
*   **Final Stack Vision:** Firebase Auth + Cloudflare D1 (Database) + Cloudflare R2 (Storage/Images) + Cloud Run / Pages (Compute).
