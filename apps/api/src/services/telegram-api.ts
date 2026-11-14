export class TelegramError extends Error {
  constructor(public code: number, public retryAfter = 0, public messageNotModified = false) { super(`Telegram API error ${code}`); }
}
export async function telegramCall<T = unknown>(method: string, payload: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  // Do not log fetch errors: their URL can contain the bot token.
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new TelegramError(503); }
  let result: { ok?: boolean; result: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
  try { result = await response.json() as typeof result; } catch { throw new TelegramError(502); }
  if (!response.ok || !result.ok) {
    const code = result.error_code ?? response.status;
    const messageNotModified = method === 'editMessageText' && code === 400 &&
      (result.description?.startsWith('Bad Request: message is not modified') ?? false);
    throw new TelegramError(code, result.parameters?.retry_after, messageNotModified);
  }
  return result.result;
}
