'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'signin' | 'signup' | 'forgot';

type ApiResponse = { error?: string; message?: string; redirect?: string };

async function readResponse(response: Response): Promise<ApiResponse> {
  try {
    return (await response.json()) as ApiResponse;
  } catch {
    return {};
  }
}

export function EmailAuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function chooseMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
    setPassword('');
    setConfirmation('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (mode === 'signup' && password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/auth/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          email,
          ...(mode === 'forgot' ? {} : { password }),
        }),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setError(result.error || 'Unable to complete that request right now.');
        return;
      }
      if (mode === 'signin') {
        router.replace('/dashboard');
        return;
      }
      setMessage(result.message || 'Check your inbox for the next step.');
      setPassword('');
      setConfirmation('');
    } catch {
      setError('Unable to reach the sign-in service. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  return (
    <div className="auth-form-area">
      <div className="auth-mode-tabs" role="tablist" aria-label="Email account action">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`auth-mode-tab${mode === 'signin' ? ' active' : ''}`}
          onClick={() => chooseMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`auth-mode-tab${mode === 'signup' ? ' active' : ''}`}
          onClick={() => chooseMode('signup')}
        >
          Create account
        </button>
      </div>

      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>Email address</span>
          <input
            className="auth-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={320}
            required
          />
        </label>

        {!isForgot ? (
          <label className="auth-field">
            <span>Password</span>
            <span className="auth-password-field">
              <input
                id="email-password"
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                minLength={isSignup ? 8 : undefined}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                aria-controls="email-password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>
        ) : null}

        {isSignup ? (
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
            />
          </label>
        ) : null}

        {error ? <p className="auth-error auth-form-message" role="alert">{error}</p> : null}
        {message ? <p className="auth-success auth-form-message" role="status">{message}</p> : null}

        <button className="button button-primary auth-submit" type="submit" disabled={busy}>
          {busy ? 'Working…' : isForgot ? 'Email reset link' : isSignup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {mode === 'signin' ? (
        <button type="button" className="text-button auth-forgot" onClick={() => chooseMode('forgot')}>
          Forgot password?
        </button>
      ) : isForgot ? (
        <button type="button" className="text-button auth-forgot" onClick={() => chooseMode('signin')}>
          Back to sign in
        </button>
      ) : null}
    </div>
  );
}
