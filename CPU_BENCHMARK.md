# Cloudflare CPU comparison, September 24, 2026

Baseline source was committed as `8421f3e` before this work. Production stayed on Worker version `2f0b5303-8f39-4e77-82d6-33b0f5dfcf86`; all benchmark versions were uploaded but not deployed.

## Measured workload

One connected account has one ESPN league and two Yahoo leagues. Its saved snapshots contain 196 ESPN player appearances and 324 Yahoo appearances. The Yahoo appearances represent 188 distinct players. A signed, temporary benchmark route ran on unpublished versions of the same OpenNext Worker. Each version read the same Supabase row and returned the same dashboard-shaped JSON response.

| Path | Cloudflare version | Successful samples | Mean CPU per invocation | Median CPU per invocation |
| --- | --- | ---: | ---: | ---: |
| Current: refresh three leagues | `6d4352c9-27e3-4a5c-8218-573b27fdb388` | 8 | 335 ms | 335 ms |
| Shared: fetch distinct provider players, fetch scoring settings, calculate points, assemble response | `dcba6044-bcec-4aa6-bdb5-64060c3b3014` | 8 | 294 ms | 258 ms |
| Serve: read and serialize saved dashboard | `d1a33b42-f1c4-4c7e-961e-90690e6d2e91` | 8 | 139 ms | 149 ms |

CPU values come from Cloudflare's `workersInvocationsAdaptive.sum.cpuTimeUs` for each version, not local elapsed time. All 24 isolated samples returned HTTP 200. The current path used a fresh in-memory Yahoo projection timestamp to represent a steady-state refresh, since the read-only benchmark does not persist refreshed timestamps.

The per-invocation CPU samples, in milliseconds, were:

| Path | Eight samples |
| --- | --- |
| Current | 636, 332, 361, 338, 332, 159, 156, 365 |
| Shared | 255, 234, 261, 380, 79, 242, 447, 456 |
| Serve | 148, 150, 154, 13, 318, 295, 19, 17 |

They were collected between 21:42 and 21:46 UTC. The spread is large, so the means are workload observations, not stable service-level estimates.

## CPU per minute at the requested cadence

Using sample means for the single observed account:

- Current 30-second refresh: `2 × 335 ms = 670 ms CPU/minute`.
- Proposed 20-second shared collection plus 20-second account reads: `3 × 294 + 3 × 139 = 1,299 ms CPU/minute`.
- Difference: **629 ms more CPU/minute, or 94% higher**, in this one-account benchmark.

If `N` similar accounts use exactly the same player pool, the measured components give `670N` ms/minute now and `882 + 417N` ms/minute for the proposal. The model crosses over at about four active accounts. At 100 identical accounts it projects roughly 67 versus 43 CPU seconds/minute, a 36% reduction. That scaling is a calculation from the measured components, not a 100-account load test.

## What remains unmeasured

This is a **whole benchmark-invocation CPU measure, not a full deployed-strategy measure**. The shared pool has not been persisted or scheduled, and the read path does not join and score from a stored pool. The benchmark uses signed test authentication instead of Supabase user authentication and omits database writes. The shared collection currently fetches scoring settings on every run, even though the proposed design would cache them. It also assembles a dashboard response, which a dedicated collector would not do. Those omissions and extra work point in opposite directions; the measured difference is not a production savings claim.

The Yahoo batches returned all 188 requested players; the shared stat parser found data for all 324 Yahoo roster appearances. ESPN's player endpoint responded, including for an out-of-roster player, but the current week's weekly actual stat entry was absent before the next game. A historical week returned actual stats. Calculated score parity during live play and special scoring rules is still unverified. The observed one-account result should not be generalized to a live multi-account workload.

For context, production Cloudflare analytics reported 152.2 CPU seconds across 2,583 invocations in the 24 hours ending September 24, 2026 21:18 UTC. That total includes all routes and errors, so it cannot be used as a refresh-only baseline.

[Cloudflare CPU metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) · [GraphQL Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)
