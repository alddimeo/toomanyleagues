import { requireUser } from '@/lib/auth';
import { espnAccess } from '@/lib/dashboard';
import { espnTeamLogoId, fetchEspnTeamLogo } from '@/lib/espn';
import { failure } from '@/lib/http';
import { AppError } from '@/lib/security';
import { readState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!UUID.test(id)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

    const state = await readState(user.id);
    const savedId = (state.leagues || [])
      .filter(league => league.provider === 'espn')
      .flatMap(league => league.teams)
      .map(team => espnTeamLogoId(team.logo))
      .find(logoId => logoId?.toLowerCase() === id.toLowerCase());
    if (!savedId || !state.connections?.espn) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const image = await fetchEspnTeamLogo(espnAccess(user.id, state), savedId);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'Cache-Control': 'private, max-age=300',
        'Content-Type': image.contentType,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return failure(error instanceof Error && !(error instanceof AppError)
      ? new AppError('ESPN team logo is unavailable right now.', 502)
      : error);
  }
}
