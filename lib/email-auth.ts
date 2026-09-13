import { AppError } from './security';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const EMAIL_MAX_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailAction = 'signin' | 'signup' | 'forgot' | 'update-password';

export type EmailRequest =
  | { action: 'signin'; email: string; password: string }
  | { action: 'signup'; email: string; password: string }
  | { action: 'forgot'; email: string }
  | { action: 'update-password'; password: string };

export type EmailAuthResult = {
  message: string;
  redirect?: '/dashboard';
};

type AuthResult = { data?: unknown; error?: unknown | null };

/** The small part of the Supabase auth client used by the email flow. */
export type EmailAuthClient = {
  auth: {
    signInWithPassword(input: { email: string; password: string }): Promise<AuthResult>;
    signUp(input: {
      email: string;
      password: string;
      options?: { emailRedirectTo?: string };
    }): Promise<AuthResult>;
    resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<AuthResult>;
    getUser(): Promise<{ data?: { user?: unknown | null }; error?: unknown | null }>;
    updateUser(input: { password: string }): Promise<AuthResult>;
  };
};

const SIGNUP_MESSAGE = 'If the address is eligible, check your inbox to finish signing up.';
const FORGOT_MESSAGE = 'If an account exists for that address, check your inbox for a reset link.';

function invalidEmail(): never {
  throw new AppError('Enter a valid email address.');
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') return invalidEmail();
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return invalidEmail();
  }
  return email;
}

export function validatePassword(value: unknown, enforceMinimum: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > PASSWORD_MAX_LENGTH) {
    throw new AppError(
      enforceMinimum
        ? `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`
        : `Enter a password of ${PASSWORD_MAX_LENGTH} characters or fewer.`,
    );
  }
  if (enforceMinimum && value.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  return value;
}

export function parseEmailRequest(input: Record<string, unknown>): EmailRequest {
  const action = input.action;
  switch (action) {
    case 'signin':
      return {
        action,
        email: normalizeEmail(input.email),
        password: validatePassword(input.password, false),
      };
    case 'signup':
      return {
        action,
        email: normalizeEmail(input.email),
        password: validatePassword(input.password, true),
      };
    case 'forgot':
      return { action, email: normalizeEmail(input.email) };
    case 'update-password':
      return { action, password: validatePassword(input.password, true) };
    default:
      throw new AppError('Choose a valid email action.');
  }
}

function failed(message: string, status: number): never {
  throw new AppError(message, status);
}

function isTemporaryProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = Number((error as { status?: unknown }).status);
  return status === 408 || status === 429 || status >= 500;
}

function temporaryFailure(): never {
  throw new AppError('Authentication is temporarily unavailable. Please try again.', 503);
}

/**
 * Runs a validated email action. The client is injected so validation and
 * provider error handling can be tested without contacting Supabase.
 */
export async function performEmailAuth(
  client: EmailAuthClient,
  input: EmailRequest,
  appOrigin: string,
): Promise<EmailAuthResult> {
  const confirmUrl = `${appOrigin}/auth/confirm`;
  const signupConfirmUrl = `${confirmUrl}?type=email`;
  const recoveryConfirmUrl = `${confirmUrl}?type=recovery`;

  if (input.action === 'signin') {
    try {
      const { error } = await client.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (isTemporaryProviderFailure(error)) temporaryFailure();
      if (error) failed('Incorrect email or password.', 401);
    } catch (error) {
      if (error instanceof AppError) throw error;
      temporaryFailure();
    }
    return { message: 'Signed in.', redirect: '/dashboard' };
  }

  if (input.action === 'signup') {
    try {
      const { error } = await client.auth.signUp({
        email: input.email,
        password: input.password,
        options: { emailRedirectTo: signupConfirmUrl },
      });
      if (isTemporaryProviderFailure(error)) temporaryFailure();
    } catch (error) {
      if (error instanceof AppError) throw error;
      temporaryFailure();
    }
    return { message: SIGNUP_MESSAGE };
  }

  if (input.action === 'forgot') {
    try {
      const { error } = await client.auth.resetPasswordForEmail(input.email, { redirectTo: recoveryConfirmUrl });
      if (isTemporaryProviderFailure(error)) temporaryFailure();
    } catch (error) {
      if (error instanceof AppError) throw error;
      temporaryFailure();
    }
    return { message: FORGOT_MESSAGE };
  }

  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) failed('Your reset link is invalid or has expired.', 401);
  } catch (error) {
    if (error instanceof AppError) throw error;
    failed('Your reset link is invalid or has expired.', 401);
  }

  try {
    const { error } = await client.auth.updateUser({ password: input.password });
    if (error) failed('We could not update your password. Request a new reset link.', 400);
  } catch (error) {
    if (error instanceof AppError) throw error;
    failed('We could not update your password. Request a new reset link.', 400);
  }
  return { message: 'Password updated.', redirect: '/dashboard' };
}
