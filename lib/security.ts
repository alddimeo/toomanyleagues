import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export class AppError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) { super(message); }
}
export function appUrl() {
  const value = process.env.APP_URL || 'http://localhost:3000';
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid APP_URL');
  return url.origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== appUrl()) throw new AppError('Request origin rejected.', 403);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const reader=request.body?.getReader();
  if(!reader) throw new AppError('Invalid request body.');
  const chunks:Uint8Array[]=[];
  let size=0;
  while(true) {
    const {done,value}=await reader.read();
    if(done) break;
    size+=value.byteLength;
    if(size>4096) { await reader.cancel(); throw new AppError('Request too large.',413); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { const parsed = JSON.parse(raw); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; }
  catch { throw new AppError('Invalid request body.'); }
}
function key() {
  const bytes = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || '', 'base64');
  if (bytes.length !== 32) throw new AppError('Credential encryption is not configured.', 503);
  return bytes;
}
export function seal(value: unknown, owner: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function unseal<T>(value: string, owner: string): T {
  const packed = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')) as T;
}
export function sameSecret(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyOAuthState(received:string,browserNonce:string,pending?:{nonce:string;expiresAt:string}) {
  if(!pending || !Number.isFinite(Date.parse(pending.expiresAt)) || Date.parse(pending.expiresAt)<Date.now() || !received || !sameSecret(received,pending.nonce) || !sameSecret(received,browserNonce)) {
    throw new AppError('Yahoo authorization expired. Connect again.',403);
  }
}
export function provider(value: unknown): 'espn' | 'yahoo' {
  if (value !== 'espn' && value !== 'yahoo') throw new AppError('Choose ESPN or Yahoo.');
  return value;
}
export function leagueInput(value: Record<string, unknown>) {
  const selected = provider(value.provider);
  const id = String(value.leagueId || '');
  const year = Number(value.season);
  if (!(selected === 'espn' ? /^\d{1,12}$/ : /^(?:nfl|\d{1,4})\.l\.\d{1,12}$/).test(id)) throw new AppError('Enter a valid league ID.');
  if (!Number.isInteger(year) || year < 2018 || year > new Date().getFullYear() + 1) throw new AppError('Enter a valid season.');
  return { provider: selected, id, season: year };
}
