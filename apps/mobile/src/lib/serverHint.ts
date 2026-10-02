/**
 * What to tell the user when the server can't be reached. The phone usually *is* online — the
 * common causes are the laptop server not running (development) or phone and laptop on
 * different networks — so say that instead of "your phone is offline".
 */
import { env } from '@/config/env';

export function serverUnreachable(): { title: string; message: string } {
  const where = env.apiUrl ?? 'the Xeno server';
  return __DEV__
    ? {
        title: 'Can’t reach the Xeno server',
        message: `The app couldn’t reach ${where}. On your laptop, make sure "npm run dev" is running, and that your phone and laptop are on the same WiFi.`,
      }
    : {
        title: 'Can’t reach the Xeno server',
        message: 'Check that your phone has internet (WiFi or mobile data) and try again.',
      };
}
