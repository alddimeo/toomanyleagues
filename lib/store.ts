import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { AppError } from './security';
import type { LeagueSnapshot, Provider } from './types';

export type State = {
  connections?: Partial<Record<Provider,{secret:string;status:string}>>;
  leagues?: LeagueSnapshot[];
  browser?: {secret:string;expiresAt:string};
  yahooState?: {nonce:string;expiresAt:string};
  nextRefreshAt?: number;
  nextDiscoveryAt?: number;
  espnDiscovery?: {leagues:{id:string;name:string;season:number}[];expiresAt:string};
};
function db() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AppError('Database is not configured yet.',503);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function readState(owner:string):Promise<State> {
  const {data,error} = await db().from('dashboard_state').select('data').eq('user_id',owner).maybeSingle();
  if(error) throw new AppError('Could not load dashboard data.',503);
  return data?.data || {};
}
export async function withState<T>(owner:string,work:(state:State)=>Promise<T>):Promise<T> {
  const client = db(), lease = randomUUID();
  const inserted = await client.from('dashboard_state').upsert({user_id:owner},{onConflict:'user_id',ignoreDuplicates:true});
  if(inserted.error) throw new AppError('Could not initialize dashboard data.',503);
  const {data,error} = await client.rpc('lock_dashboard',{owner_id:owner,lease_id:lease});
  if(error) throw new AppError('Database is unavailable.',503);
  if(!data?.length) throw new AppError('Another request is running. Try again shortly.',429,5);
  const state:State = data[0].data || {};
  let result:T | undefined, failure:unknown;
  try { result = await work(state); } catch(e) { failure=e; }
  // Persist rotated tokens and throttle deadlines even when upstream requests fail.
  const saved = await client.from('dashboard_state').update({data:state,lease_id:null,lease_until:null}).eq('user_id',owner).eq('lease_id',lease).select('user_id');
  if(saved.error || !saved.data?.length) throw new AppError('Could not save dashboard data. Reconnect if needed.',503);
  if(failure) throw failure;
  return result as T;
}
