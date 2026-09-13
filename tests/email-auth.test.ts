import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PASSWORD_MAX_LENGTH,
  parseEmailRequest,
  performEmailAuth,
  type EmailAuthClient,
} from '../lib/email-auth';

function client(overrides: Partial<EmailAuthClient['auth']> = {}) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, value: unknown) => {
    (calls[name] ||= []).push(value);
  };
  const auth: EmailAuthClient['auth'] = {
    signInWithPassword: async (input) => {
      record('signInWithPassword', input);
      return { data: {}, error: null };
    },
    signUp: async (input) => {
      record('signUp', input);
      return { data: {}, error: null };
    },
    resetPasswordForEmail: async (email, options) => {
      record('resetPasswordForEmail', { email, options });
      return { data: {}, error: null };
    },
    getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    updateUser: async (input) => {
      record('updateUser', input);
      return { data: {}, error: null };
    },
    ...overrides,
  };
  return { client: { auth } as EmailAuthClient, calls };
}

test('email request validation normalizes addresses and protects password bounds', () => {
  assert.deepEqual(parseEmailRequest({ action: 'signin', email: ' User@Example.COM ', password: 'x' }), {
    action: 'signin',
    email: 'user@example.com',
    password: 'x',
  });
  assert.throws(
    () => parseEmailRequest({ action: 'signup', email: 'user@example.com', password: 'short' }),
    /at least 8/,
  );
  assert.throws(
    () => parseEmailRequest({ action: 'signin', email: 'user@example.com', password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }),
    /128 characters or fewer/,
  );
  assert.throws(() => parseEmailRequest({ action: 'forgot', email: 'not-an-email' }), /valid email/);
  assert.throws(() => parseEmailRequest({ action: 'unknown', email: 'user@example.com' }), /valid email action/);
});

test('sign in sends normalized credentials and hides provider errors', async () => {
  const { client: authClient, calls } = client({
    signInWithPassword: async (input) => {
      calls.signInWithPassword = [input];
      return { data: null, error: new Error('provider details must stay private') };
    },
  });
  const request = parseEmailRequest({ action: 'signin', email: 'USER@example.com', password: 'x' });
  await assert.rejects(
    () => performEmailAuth(authClient, request, 'https://app.example'),
    (error: unknown) => error instanceof Error && error.message === 'Incorrect email or password.' && (error as { status?: number }).status === 401,
  );
  assert.deepEqual(calls.signInWithPassword, [{ email: 'user@example.com', password: 'x' }]);
});

test('signup and forgot actions use the fixed confirmation endpoint and stay enumeration-safe', async () => {
  const signup = client();
  signup.client.auth.signUp = async (input) => {
    (signup.calls.signUp ||= []).push(input);
    return { data: null, error: new Error('email already exists') };
  };
  const signupResult = await performEmailAuth(
    signup.client,
    parseEmailRequest({ action: 'signup', email: 'user@example.com', password: 'long-enough' }),
    'https://app.example',
  );
  assert.match(signupResult.message, /check your inbox/);
  assert.deepEqual(signup.calls.signUp, [{
    email: 'user@example.com',
    password: 'long-enough',
    options: { emailRedirectTo: 'https://app.example/auth/confirm?type=email' },
  }]);

  const forgot = client();
  forgot.client.auth.resetPasswordForEmail = async (email, options) => {
    (forgot.calls.resetPasswordForEmail ||= []).push({ email, options });
    return { data: null, error: new Error('provider details') };
  };
  const forgotResult = await performEmailAuth(
    forgot.client,
    parseEmailRequest({ action: 'forgot', email: 'USER@example.com' }),
    'https://app.example',
  );
  assert.match(forgotResult.message, /If an account exists/);
  assert.deepEqual(forgot.calls.resetPasswordForEmail, [{
    email: 'user@example.com',
    options: { redirectTo: 'https://app.example/auth/confirm?type=recovery' },
  }]);
});

test('provider throttling is reported as a temporary service failure', async () => {
  const { client: authClient } = client({
    resetPasswordForEmail: async () => ({ data: null, error: { status: 429, message: 'slow down' } }),
  });
  await assert.rejects(
    () => performEmailAuth(authClient, parseEmailRequest({ action: 'forgot', email: 'user@example.com' }), 'https://app.example'),
    (error: unknown) => error instanceof Error && error.message === 'Authentication is temporarily unavailable. Please try again.' && (error as { status?: number }).status === 503,
  );
});

test('password update requires the authenticated recovery session', async () => {
  const unauthenticated = client({ getUser: async () => ({ data: { user: null }, error: null }) });
  await assert.rejects(
    () => performEmailAuth(unauthenticated.client, parseEmailRequest({ action: 'update-password', password: 'long-enough' }), 'https://app.example'),
    (error: unknown) => error instanceof Error && error.message === 'Your reset link is invalid or has expired.' && (error as { status?: number }).status === 401,
  );

  const authenticated = client();
  const result = await performEmailAuth(
    authenticated.client,
    parseEmailRequest({ action: 'update-password', password: 'long-enough' }),
    'https://app.example',
  );
  assert.equal(result.redirect, '/dashboard');
  assert.deepEqual(authenticated.calls.updateUser, [{ password: 'long-enough' }]);
});
