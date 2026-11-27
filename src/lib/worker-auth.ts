import { ApiError } from '@/lib/api-helpers';
import { safeEqual } from '@/lib/security';

export function requireWorkerSecret(request: Request) {
  const expected = process.env.WORKER_API_SECRET?.trim();
  if (!expected) {
    throw new ApiError('WORKER_API_SECRET is not configured.', 503);
  }
  const auth = request.headers.get('authorization') ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!provided || !safeEqual(provided, expected)) {
    throw new ApiError('Unauthorized worker request.', 401);
  }
}
