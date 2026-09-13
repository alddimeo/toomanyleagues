'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type ApiResponse = { error?: string; message?: string };

async function readResponse(response: Response): Promise<ApiResponse> {
  try {
    return (await response.json()) as ApiResponse;
  } catch {
    return {};
  }
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/auth/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update-password', password }),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setError(result.error || 'Unable to update your password.');
        return;
      }
      router.replace('/dashboard');
    } catch {
      setError('Unable to reach the sign-in service. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field">
        <span>New password</span>
        <span className="auth-password-field">
          <input
            id="reset-password"
            className="auth-input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <button
            type="button"
            className="auth-password-toggle"
            aria-controls="reset-password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </span>
      </label>
      <label className="auth-field">
        <span>Confirm new password</span>
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
      {error ? <p className="auth-error auth-form-message" role="alert">{error}</p> : null}
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
