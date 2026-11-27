import { timingSafeEqual } from 'crypto';
import { ApiError } from '@/lib/api-helpers';

export function requireWorkerSecret(request: Request) {
  const expected = process.env.WORKER_API_SECRET?.trim();
  if (!expected) {
    throw new ApiError('WORKER_API_SECRET is not configured.', 503);
  }
  const auth = request.headers.get('authorization') ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new ApiError('Unauthorized worker request.', 401);
  }
}
