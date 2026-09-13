import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell">
      <div className="auth-topbar page-width">
        <Link href="/" className="brand-link"><Wordmark /></Link>
        <Link href="/login" className="back-link">← Back to sign in</Link>
      </div>
      <section className="auth-card" aria-labelledby="reset-title">
        <div className="auth-card-mark" aria-hidden="true">✦</div>
        <p className="eyebrow">Account recovery</p>
        <h1 id="reset-title">Choose a new password.</h1>
        <p className="auth-lede">Set a fresh password for your Too Many Leagues account.</p>
        <ResetPasswordForm />
      </section>
      <p className="auth-bottom-note">Need a different account? <Link href="/login">Return to sign in</Link></p>
    </main>
  );
}
