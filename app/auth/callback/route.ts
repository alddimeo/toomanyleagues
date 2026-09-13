import { authClient } from '@/lib/auth';
import { appUrl } from '@/lib/security';
export async function GET(request:Request) {
  const code = new URL(request.url).searchParams.get('code');
  try {
    if(!code) throw new Error();
    const client = await authClient();
    const {error} = await client.auth.exchangeCodeForSession(code);
    if(error) throw error;
    return Response.redirect(`${appUrl()}/dashboard`);
  } catch { return Response.redirect(`${appUrl()}/login?error=callback`); }
}
