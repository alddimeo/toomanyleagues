import { AppError } from './security';

export function json(value:unknown,status=200,extra:Record<string,string>={}) {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra}});
}
export function failure(error:unknown) {
  if(error instanceof AppError) return json({error:error.message},error.status,error.retryAfter ? {'Retry-After':String(error.retryAfter)} : {});
  return json({error:'The provider request failed. Try again or reconnect your account.'},502);
}
