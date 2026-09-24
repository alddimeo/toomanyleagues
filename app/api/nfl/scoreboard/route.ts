import { requireUser } from '@/lib/auth';
import { fetchNflScoreboard } from '@/lib/nfl';
import { AppError } from '@/lib/security';
import { failure, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser();
    const params = new URL(request.url).searchParams;
    const hasSeason = params.has('season'), hasWeek = params.has('week');
    const season = hasSeason ? Number(params.get('season')) : undefined;
    const week = hasWeek ? Number(params.get('week')) : undefined;
    if (hasSeason !== hasWeek || (hasSeason && (!Number.isInteger(season) || season! < 2018 || season! > new Date().getFullYear() + 1 || !Number.isInteger(week) || week! < 1 || week! > 22))) {
      throw new AppError('Choose a valid season and week.');
    }
    return json({ games: await fetchNflScoreboard(season, week) });
  } catch (error) {
    return failure(error instanceof Error && !(error instanceof AppError) ? new AppError(error.message, 502) : error);
  }
}
