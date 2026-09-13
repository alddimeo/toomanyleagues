import { authClient } from '@/lib/auth';
import {
  parseEmailRequest,
  performEmailAuth,
} from '@/lib/email-auth';
import { json } from '@/lib/http';
import { AppError, appUrl, body, checkOrigin } from '@/lib/security';

function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: 'Unable to complete that request right now.' }, 503);
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = parseEmailRequest(await body(request));
    const client = await authClient();
    const result = await performEmailAuth(client, input, appUrl());
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
