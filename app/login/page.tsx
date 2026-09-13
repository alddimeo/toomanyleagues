import Link from "next/link";
import { EmailAuthForm } from "@/components/EmailAuthForm";
import { Wordmark } from "@/components/Wordmark";

type LoginPageProps = { searchParams: Promise<{ error?: string | string[] }> };

function messageForError(value: string | string[] | undefined) {
  const error = Array.isArray(value) ? value[0] : value;
  if (!error) return null;
  if (error === "cancelled" || error === "canceled") return "Sign in was canceled. You can try again whenever you’re ready.";
  if (error === "configuration") return "Sign in is not configured for this prototype yet.";
  if (error === "provider_error" || error === "oauth_error" || error === "auth_error") return "The provider could not complete sign in. Please try again.";
  if (error === "confirmation") return "That confirmation link is invalid or has expired. Request a new one and try again.";
  return "We couldn’t complete sign in. Please try again.";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMessage = messageForError(params.error);

  return (
    <main className="auth-shell">
      <div className="auth-topbar page-width"><Link href="/" className="brand-link"><Wordmark /></Link><Link href="/" className="back-link">← Back home</Link></div>
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card-mark" aria-hidden="true">✦</div>
        <p className="eyebrow">Your leagues, in one place</p>
        <h1 id="login-title">Welcome back.</h1>
        <p className="auth-lede">Sign in to open your private dashboard and connect the leagues you want to see.</p>
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
        <EmailAuthForm />
        <div className="auth-rule"><span>OR CONTINUE WITH</span></div>
        <div className="auth-actions">
          <a className="provider-button provider-google" href="/auth/login?provider=google"><span className="provider-logo google-logo" aria-hidden="true">G</span><span>Continue with Google</span><span aria-hidden="true">↗</span></a>
          <a className="provider-button provider-apple" href="/auth/login?provider=apple"><span className="provider-logo apple-logo" aria-hidden="true">A</span><span>Continue with Apple</span><span aria-hidden="true">↗</span></a>
        </div>
        <p className="auth-footnote">Use your email and password, or let your provider handle sign-in. Too Many Leagues does not store provider passwords.</p>
      </section>
      <p className="auth-bottom-note">Need a place to start? <Link href="/">See how it works</Link></p>
    </main>
  );
}
