import { type EmailOtpType } from '@supabase/supabase-js';
import { authClient } from '@/lib/auth';
import { appUrl } from '@/lib/security';

const CONFIRMATION_ERROR = '/login?error=confirmation';

function redirect(origin: string, path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}${path}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function GET(request: Request) {
  const origin = appUrl();
  const params = new URL(request.url).searchParams;
  const tokenHash = params.get('token_hash');
  const requestedType = params.get('type');
  const type: 'email' | 'recovery' | null =
    requestedType === 'email' || requestedType === 'recovery' ? requestedType : null;

  try {
    if (!tokenHash || !type) return redirect(origin, CONFIRMATION_ERROR);

    const client = await authClient();
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) return redirect(origin, CONFIRMATION_ERROR);
    return redirect(origin, type === 'recovery' ? '/auth/reset' : '/dashboard');
  } catch {
    return redirect(origin, CONFIRMATION_ERROR);
  }
}
