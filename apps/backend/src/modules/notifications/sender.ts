/** Push transport. `ExpoPushSender` talks to Expo's push service; tests use a fake. */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'high';
  sound?: 'default' | null;
  channelId?: string;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** true when the token is dead and should be removed (app uninstalled, etc.). */
  unregistered: boolean;
  error?: string;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export const isExpoPushToken = (t: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t);

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export class ExpoPushSender implements PushSender {
  constructor(
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await this.fetchImpl(EXPO_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(chunk),
        });
        const json = (await res.json()) as { data?: ExpoTicket[] };
        chunk.forEach((m, j) => {
          const ticket = json.data?.[j];
          results.push({
            token: m.to,
            ok: ticket?.status === 'ok',
            unregistered: ticket?.details?.error === 'DeviceNotRegistered',
            error: ticket?.status === 'error' ? ticket.message : res.ok ? undefined : `HTTP ${res.status}`,
          });
        });
      } catch (err) {
        chunk.forEach((m) =>
          results.push({ token: m.to, ok: false, unregistered: false, error: String(err) }),
        );
      }
    }
    return results;
  }
}

export class NoopPushSender implements PushSender {
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    return messages.map((m) => ({ token: m.to, ok: true, unregistered: false }));
  }
}
