import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { AppError } from './security';

export async function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AppError('Sign-in is not configured yet.', 503);
  const jar = await cookies();
  return createServerClient(url, key, { cookies: {
    getAll: () => jar.getAll(),
    setAll: (values) => { values.forEach(({name,value,options}) => jar.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV === 'production'})); },
  }});
}
export async function requireUser() {
  const auth = await authClient();
  const {data:{user},error} = await auth.auth.getUser();
  if (error || !user) throw new AppError('Please sign in.', 401);
  const allowed = (process.env.BETA_ALLOWED_EMAILS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if (!user.email || !allowed.includes(user.email.toLowerCase())) throw new AppError('This prototype is available to invited testers only.', 403);
  return user;
}
