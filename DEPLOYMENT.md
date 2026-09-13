# Deployment

Target: Cloudflare Workers with OpenNext, Supabase Auth/Postgres, Yahoo OAuth, and Browserbase for ESPN connection. A public URL does not enable provider access until the services below are configured. Keep the tester allowlist during the first real-account checks, then remove it when the public beta is ready.

## Account access

MCP is optional. Cloudflare's Wrangler CLI can deploy after `npx wrangler login`. Supabase's SQL editor can run the migration without installing its CLI.

For Codex MCP access, replace `PROJECT_REF` with this app's Supabase project reference:

```powershell
codex mcp add supabase --url "https://mcp.supabase.com/mcp?project_ref=PROJECT_REF"
codex mcp login supabase
codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp
codex mcp login cloudflare
```

Complete the browser authorization with the appropriate account. Reconnect/restart the client if the new tools are not visible. Do not put access tokens in chat or source control.

## Configure the first deployment

1. Run `supabase/migrations/202609130001_dashboard.sql`, then `supabase/tests/access.sql` in the selected project's SQL editor.
2. Choose the final HTTPS deployment URL. For the first preview, use the `toomanyleagues.<your-subdomain>.workers.dev` address shown by Cloudflare. Set `APP_URL` to that exact origin.
3. Add every value from `.env.example` to the Worker's environment using the Cloudflare dashboard. Store the service-role key, encryption key, Browserbase API key, and Yahoo client secret as secrets. Keep the encryption key stable. Set `BETA_ALLOWED_EMAILS` to your login email for an invite-only beta, or leave it empty for authenticated public users.
4. Configure Supabase Site URL and authentication redirects for that origin, following README's authentication setup. Configure Yahoo's exact callback as `https://YOUR_HOST/api/yahoo/callback`. Configure Browserbase credentials for ESPN.
5. Run `npm run build:cloudflare`, then `npm run preview:cloudflare` for a local Workers runtime check. Run `npm run deploy:cloudflare` to publish the built app with authenticated Wrangler.
6. Verify email sign-up/confirmation, sign-in/reset, then connect each provider and compare imported leagues with the source. Test a second account's isolation. The local parser/UI tests do not replace these real-service checks.

When the domain is chosen, attach it as a Workers custom domain and update `APP_URL`, Supabase redirect settings, and Yahoo's callback together. Keep existing mail/DNS records intact.

Sources: [OpenNext setup](https://opennext.js.org/cloudflare/get-started), [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp), [Cloudflare MCP](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), [Codex MCP](https://developers.openai.com/codex/mcp/).
