import { authClient } from '@/lib/auth';
import { appUrl } from '@/lib/security';
export async function GET(request:Request) {
  const provider = new URL(request.url).searchParams.get('provider');
  if(provider !== 'google' && provider !== 'apple') return Response.redirect(`${appUrl()}/login?error=provider`);
  try {
    const client = await authClient();
    const {data,error} = await client.auth.signInWithOAuth({provider,options:{redirectTo:`${appUrl()}/auth/callback`}});
    if(error || !data.url) throw error;
    return Response.redirect(data.url);
  } catch { return Response.redirect(`${appUrl()}/login?error=configuration`); }
}
