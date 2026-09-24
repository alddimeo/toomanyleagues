# Too Many Leagues

Private, read-only fantasy football prototype: Next.js/TypeScript, Supabase authentication and Postgres, and a Chrome connector for ESPN and Yahoo. Email/password, Google, and Apple sign-in identify the dashboard user; ESPN and Yahoo connections authorize fantasy data separately. See [DEPLOYMENT.md](DEPLOYMENT.md) for Cloudflare Workers setup and account access.

## Run locally

1. Install Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in your service credentials. Generate a 32-byte base64 credential encryption key using the command in that file. Keep this key stable across deploys; losing it requires reconnecting providers.
3. Create a Supabase project and run the SQL files in `supabase/migrations/` in order. The data table and lock function are backend-only; even authenticated clients have no direct access. The server always scopes queries to the verified user ID.
4. Configure Google and Apple providers in Supabase Auth. Register the Supabase callback URL shown in its provider settings with Google/Apple. Set Supabase Site URL to `APP_URL` and allow `${APP_URL}/auth/callback`. Apple web OAuth needs an Apple Developer account and renewal of its client secret at least every six months. Use the email actually returned by Apple (possibly a private relay address) in the beta allowlist.
5. For an invite-only beta, set `BETA_ALLOWED_EMAILS` to exact tester email addresses. Leave it empty when authenticated users should be able to use the public site; league data remains private to each account.
6. Install the connector in Chrome for this developer preview: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this repository's `extension` folder. Reload the app page after installation. The extension must be published to the Chrome Web Store before a normal one-click install is available.
7. Run `npm run dev`, visit `http://localhost:3000`, and sign in. Click Connect ESPN or Yahoo. If needed, sign in on the provider tab that opens and return to the dashboard; connection continues automatically. The connector reads only the selected provider's session cookies and sends them to the authenticated app API, which encrypts them for read requests. Manual Yahoo keys have the form `461.l.12345` (game key changes by season).

Without credentials, the homepage and login screen render; actual login/import requires configured services. No production services, provider accounts, or domain are provisioned by this repository.

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

`npm test`, `npm run typecheck`, and `npm run build` check parsers, the connector bridge, security helpers, and compilation. With the dev server running, `npm run test:ui` uses installed Chrome for a headless UI smoke check and saves screenshots to `test-results/`. Set `BROWSER_EXECUTABLE` for another Chromium binary and `SMOKE_URL` for another local port. UI fixtures are mocked and clearly confined to the test. These tests do not prove provider freshness or continued availability of Yahoo's website read endpoint. Run `supabase/tests/access.sql` against the configured database to verify its access grants.

For an invited tester, connect each provider in Chrome, import private leagues, restart the app, and refresh again. Check scores and player stat values against each provider. Test cancelled login, MFA, expired cookies, and disconnect. Disconnect removes imported snapshots and retained credentials. Test a second user cannot access the first user's state. Direct Supabase table requests as `anon` and `authenticated` must be rejected.

During an actual game, enable live mode and compare timestamped score changes with ESPN/Yahoo. Record source-observed change time, dashboard-observed change time, provider HTTP latency/status, and request counts, **never credentials, live URLs, or response bodies containing secrets**. Report median/p95/max observed lag and failures separately. The four-second target is an experiment, not a five-second freshness guarantee. Refresh cycles are serialized; leagues within a cycle fetch concurrently. Upstream response time adds delay. Rate limits cause backoff, other refresh errors pause live mode, errors retain old snapshots, and hidden tabs do not poll. The prototype limits imports to ten leagues per account.

## Costs and public launch

For 10, 100, and 1,000 active users, calculate game-day request rate as `active_users * leagues_per_user * measured_requests_per_league / measured_refresh_seconds`. Measure connection success, request duration, and bandwidth before choosing production hosting. The target overall beta budget is $50-100/month; it is not a measured estimate yet.

Before public launch, publish and review the Chrome extension, resolve ESPN/Disney permission for automated access, obtain Yahoo approval and move Yahoo to its documented OAuth API, measure the five-second requirement during games, and configure production monitoring, backups, retention, account deletion, privacy/terms, and spend limits. Yahoo's website read endpoint is undocumented and may change without notice. The current release is a private feasibility prototype.

Sources: [Yahoo API](https://sports.yahoo.com/developer/docs/), [Supabase social login](https://supabase.com/docs/guides/auth/social-login), [Chrome extension cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies), [Disney terms](https://disneytermsofuse.com/english/).
