# Too Many Leagues

Private, read-only fantasy football prototype: Next.js/TypeScript, Supabase authentication and Postgres, Yahoo OAuth, and an interactive Browserbase ESPN login. No browser extension required. Email/password, Google, and Apple sign-in identify the dashboard user; Yahoo and ESPN connections authorize fantasy data separately. See [DEPLOYMENT.md](DEPLOYMENT.md) for Cloudflare Workers setup and account access.

## Run locally

1. Install Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in your service credentials. Generate a 32-byte base64 credential encryption key using the command in that file. Keep this key stable across deploys; losing it requires reconnecting providers.
3. Create a Supabase project and run `supabase/migrations/202609130001_dashboard.sql` in its SQL editor. The data table and lock function are backend-only; even authenticated clients have no direct access. The server always scopes queries to the verified user ID.
4. Configure Google and Apple providers in Supabase Auth. Register the Supabase callback URL shown in its provider settings with Google/Apple. Set Supabase Site URL to `APP_URL` and allow `${APP_URL}/auth/callback`. Apple web OAuth needs an Apple Developer account and renewal of its client secret at least every six months. Use the email actually returned by Apple (possibly a private relay address) in the beta allowlist.
5. For an invite-only beta, set `BETA_ALLOWED_EMAILS` to exact tester email addresses. Leave it empty when authenticated users should be able to use the public site; league data remains private to each account.
6. Create a Browserbase project and set its API key/project ID. Browser sessions have a ten-minute timeout, with recording, session logging, and automatic CAPTCHA solving disabled. Users complete ESPN login themselves in the hosted browser. Our service and Browserbase handle sensitive session state; this is not ESPN OAuth.
7. Apply for Yahoo Fantasy API access for this public multi-user product, requesting read access. Register `${APP_URL}/api/yahoo/callback` as the exact redirect URI. Yahoo may require HTTPS: use an HTTPS development deployment/tunnel and set `APP_URL` consistently. Each user authorizes this one application; users do not register developer apps.
8. Run `npm run dev`, visit `http://localhost:3000`, and sign in. Start ESPN login, finish it, then enter the numeric league ID and season. Yahoo connects through its own consent page and attempts league discovery/import; manual Yahoo keys have the form `461.l.12345` (game key changes by season).

Without credentials, the homepage and login screen render; actual login/import requires configured services. No production services, Yahoo application, accounts, or domain are provisioned by this repository.

### Email authentication

Enable email/password authentication and email confirmation in Supabase Auth. Set the Site URL to `APP_URL` and allow `/auth/confirm` on that origin (including its `type=email` and `type=recovery` query variants). In the **Confirm signup** email template, use this link:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
```

In the **Reset password** template, use:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
```

The server verifies the one-time token and establishes an HTTP-only session before redirecting to the dashboard or password form. Configure production SMTP for public email delivery. If `BETA_ALLOWED_EMAILS` is set, new accounts still need to be on that list before importing leagues.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` check parsers, hosted-browser cleanup, security helpers, and compilation. With the dev server running, `npm run test:ui` uses installed Chrome for a headless UI smoke check and saves screenshots to `test-results/`. Set `BROWSER_EXECUTABLE` for another Chromium binary and `SMOKE_URL` for another local port. UI fixtures are mocked and clearly confined to the test. These tests do not prove ESPN accepts hosted browsers or exported sessions, Yahoo approval, or provider freshness. Run `supabase/tests/access.sql` against the configured database to verify its access grants.

For an invited tester, connect ESPN, close the hosted browser, import two private leagues with different scoring settings, restart the app, and refresh again. Check scores and player stat values against ESPN. Test failed/cancelled login, MFA, ten-minute timeout, expired cookies, and disconnect. Disconnect removes imported snapshots and retained credentials; revoke Yahoo access in Yahoo account settings if desired. Test a second user cannot access the first user's state. Direct Supabase table requests as `anon` and `authenticated` must be rejected.

During an actual game, enable live mode and compare timestamped score changes with ESPN/Yahoo. Record source-observed change time, dashboard-observed change time, provider HTTP latency/status, and request counts, **never credentials, callback URLs, live URLs, or response bodies containing secrets**. Report median/p95/max observed lag and failures separately. The four-second target is an experiment, not a five-second freshness guarantee. Refresh cycles are serialized; leagues within a cycle fetch concurrently, sharing one Yahoo token refresh. Upstream response time adds delay. Rate limits cause backoff, other refresh errors pause live mode, errors retain old snapshots, and hidden tabs do not poll. The prototype limits imports to ten leagues per account; Yahoo auto-imports the first discovered league, with a discovery picker for the rest.

## Costs and public launch

Use Browserbase for initial connection/reconnection only if normal server requests continue to work after the browser closes. If this fails, report the failed feasibility gate rather than keeping browsers alive indefinitely. Measure minutes per successful login, retries/reconnections, requests per refresh, request duration, and bandwidth before choosing production hosting or a background worker.

For 10, 100, and 1,000 active users, calculate browser hours as `users * monthly_connections_per_user * measured_login_minutes / 60`, and game-day request rate as `active_users * leagues_per_user * measured_requests_per_league / measured_refresh_seconds`. Deduplicate future shared-league polling only when access scoping is designed. Browserbase currently advertises $20/month with 100 browser hours, then $0.12/hour; use current pricing before purchasing. This calculation excludes web/database hosting, bandwidth, and any licensing fees. The target overall beta budget is $50–100/month; it is not a measured estimate yet.

Before public launch, resolve ESPN/Disney permission for automated access, obtain Yahoo approval, measure the five-second requirement during games, and configure production monitoring, backups, retention, account deletion, privacy/terms, and spend limits. Configure hosting access-log redaction for OAuth query strings; application code never logs them. The current release is a private feasibility prototype, not a public-launch-ready service.

Sources: [Yahoo API](https://sports.yahoo.com/developer/docs/), [Supabase social login](https://supabase.com/docs/guides/auth/social-login), [Browserbase Live View](https://docs.browserbase.com/platform/browser/observability/session-live-view), [Browserbase pricing](https://www.browserbase.com/pricing), [Disney terms](https://disneytermsofuse.com/english/).
