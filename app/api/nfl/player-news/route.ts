import { requireUser } from '@/lib/auth';
import { failure, json } from '@/lib/http';
import { fetchNflPlayerNews } from '@/lib/nfl-news';
import { AppError } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser();
    const player = new URL(request.url).searchParams.get('player')?.trim() || '';
    if (!player || player.length > 80 || /[\u0000-\u001f\u007f]/.test(player)) throw new AppError('Choose a valid player.');
    return json({ news: await fetchNflPlayerNews(player) });
  } catch (error) {
    return failure(error instanceof Error && !(error instanceof AppError) ? new AppError(error.message, 502) : error);
  }
}
