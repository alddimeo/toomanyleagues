import { authClient } from '@/lib/auth';
import { appUrl, checkOrigin } from '@/lib/security';
import { failure } from '@/lib/http';
export async function POST(request:Request) {
  try { checkOrigin(request); const client=await authClient(); await client.auth.signOut(); return Response.redirect(`${appUrl()}/`,303); }
  catch(error) { return failure(error); }
}
