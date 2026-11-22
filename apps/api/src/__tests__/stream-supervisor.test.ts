import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ plan: vi.fn(), resume: vi.fn(), backfill: vi.fn(), ingest: vi.fn(), checkpoint: vi.fn(), save: vi.fn(), bulkSave: vi.fn() }));
vi.mock('../db.js', () => ({ collections: async () => ({ pipelineCheckpoints: { findOne: mocks.checkpoint, updateOne: mocks.save, bulkWrite: mocks.bulkSave } }) }));
vi.mock('../services/rate-limits.js', () => ({ eligibleSubscriptionPlan: mocks.plan, resumeAccountsAtSlot: mocks.resume }));
vi.mock('../services/parsed-events.js', () => ({ backfillParsedEvents: mocks.backfill }));
vi.mock('../services/parsed-transactions.js', () => ({ ingestParsedTransaction: mocks.ingest }));
vi.mock('../services/push.js', () => ({ drainNotificationJobs: vi.fn() }));
vi.mock('../services/telegram.js', () => ({ drainTelegramJobs: vi.fn() }));
vi.mock('../services/usdc-payments.js', () => ({ drainUsdcPayments: vi.fn() }));
vi.mock('../services/telegram-ga4.js', () => ({ drainTelegramGa4Events: vi.fn() }));
import { drainNotificationJobs } from '../services/push.js';
import { drainTelegramJobs } from '../services/telegram.js';
import { ParsedStreamSupervisor, addressCheckpointId, backfillTrackedAddresses } from '../services/stream-supervisor.js';
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: any[] = [];
  closed = false;
  handlers = new Map<string, Function[]>();
  constructor(public url: string) { Socket.instances.push(this); }
  addEventListener(name: string, handler: Function) { this.handlers.set(name, [...this.handlers.get(name) ?? [], handler]); }
  emit(name: string, event: unknown = {}) { for (const handler of this.handlers.get(name) ?? []) handler(event); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 3; this.emit('close', { code: 1000 }); }
}
let supervisor: ParsedStreamSupervisor;
const plan = (addresses: string[], resuming: string[] = []) => ({ addresses, resuming, fingerprint: JSON.stringify([addresses, resuming]) });
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const tx = (signature: string, slot = 101) => ({ data: JSON.stringify({ method: 'parsedTransactionNotification', params: { result: { context: { slot }, value: { transaction: { signature, slot, accountKeys: ['A'], blockTime: Date.now() / 1000 } } } } }) });
function answerPing(socket: Socket, result: number) {
  const ping = socket.sent.findLast(message => message.method === 'ping');
  socket.emit('message', { data: JSON.stringify({ id: ping.id, result }) });
}
function acknowledge(socket: Socket, slot: number) {
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ id: 1, result: 999 }) });
  socket.emit('message', { data: JSON.stringify({ id: 100000, result: slot }) });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); Socket.instances = [];
  vi.stubEnv('HELIUS_API_KEY', 'test-key'); vi.stubGlobal('WebSocket', Socket);
  mocks.plan.mockResolvedValue(plan(['A', 'B'])); mocks.checkpoint.mockResolvedValue(null);
  mocks.backfill.mockResolvedValue({ pages: 0, processed: 0 }); mocks.resume.mockResolvedValue(undefined);
  supervisor = new ParsedStreamSupervisor();
});
afterEach(() => { supervisor.stop(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('live and recovery isolation', () => {
  it('processes live frames during a blocked backfill without advancing past the gap', async () => {
    mocks.plan.mockResolvedValue(plan(['A']));
    mocks.checkpoint.mockResolvedValue({ lastSlot: 100 });
    let complete!: () => void;
    mocks.backfill.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    await supervisor.start();
    const socket = Socket.instances[0];
    acknowledge(socket, 200);
    await flush();
    expect(mocks.backfill).toHaveBeenCalledWith('A', 100, 200, 20, expect.anything());
    const receivedAt = Date.now();
    socket.emit('message', tx('newer', 220));
    vi.setSystemTime(receivedAt + 1_250);
    answerPing(socket, 230);
    await flush();
    expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ signature: 'newer' }), expect.objectContaining({
      streamTiming: { streamReceivedAt: receivedAt, streamProcessingStartedAt: receivedAt + 1_250 },
    }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.bulkSave).not.toHaveBeenCalled();
    complete();
    await flush();
    expect(mocks.save.mock.calls.map(([, update]) => update.$max.lastSlot)).toEqual([200]);
    await vi.advanceTimersByTimeAsync(540_000);
    answerPing(socket, 300);
    await flush();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.bulkSave).toHaveBeenCalledWith([{
      updateOne: { filter: { _id: addressCheckpointId('A') }, update: { $max: { lastSlot: 300 }, $set: { updatedAt: expect.any(Date) } }, upsert: true },
    }], { ordered: false });
  });

  it('retries failed backfill on the same healthy socket from the durable checkpoint', async () => {
    mocks.plan.mockResolvedValue(plan(['A']));
    mocks.checkpoint.mockResolvedValue({ lastSlot: 100 });
    mocks.backfill.mockRejectedValueOnce(new Error('history temporarily unavailable'));
    await supervisor.start();
    const socket = Socket.instances[0];
    acknowledge(socket, 200);
    await flush();
    socket.emit('message', tx('still-live', 220));
    await flush();
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
    expect(socket.closed).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill).toHaveBeenLastCalledWith('A', 100, 200, 20, expect.anything());
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('cancels in-flight history when the socket closes without saving its checkpoint', async () => {
    mocks.plan.mockResolvedValue(plan(['A']));
    mocks.checkpoint.mockResolvedValue({ lastSlot: 100 });
    let signal: AbortSignal | undefined;
    mocks.backfill.mockImplementationOnce(async (_address, _from, _to, _limit, options) => {
      signal = options.signal;
      await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
    });
    await supervisor.start();
    const socket = Socket.instances[0];
    acknowledge(socket, 200);
    await flush();
    expect(signal?.aborted).toBe(false);
    socket.close();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
describe('upstream quota enforcement', () => {
  it('keeps draining mobile pushes while a portfolio Telegram command is slow', async () => {
    vi.mocked(drainTelegramJobs).mockReturnValue(new Promise(() => {}));
    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(drainTelegramJobs).toHaveBeenCalledTimes(1);
    expect(drainNotificationJobs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(drainTelegramJobs).toHaveBeenCalledTimes(1);
    expect(drainNotificationJobs).toHaveBeenCalledTimes(2);
  });
  it('physically removes paused addresses from Helius subscriptions', async () => {
    await supervisor.start(); Socket.instances[0].emit('open');
    expect(Socket.instances[0].sent[0].params[0].accounts.include).toEqual(['A', 'B']);
    mocks.plan.mockResolvedValue(plan(['B'])); await supervisor.refreshSubscriptions();
    expect(Socket.instances[0].closed).toBe(true);
    Socket.instances[1].emit('open');
    expect(Socket.instances[1].sent[0].params[0].accounts.include).toEqual(['B']);
  });
  it('refreshes immediately after cooldown and discards queued frames from closed sockets', async () => {
    await supervisor.start(); const socket = Socket.instances[0];
    mocks.ingest.mockImplementationOnce(async (_tx, options) => { mocks.plan.mockResolvedValue(plan([])); await options.onCooldown(); });
    socket.emit('message', tx('first')); socket.emit('message', tx('already-queued'));
    await flush();
    expect(mocks.ingest).toHaveBeenCalledTimes(1); expect(socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Socket.instances).toHaveLength(1);
  });
  it('uses a fresh provider ping to initialize resumption before backfill', async () => {
    mocks.plan.mockResolvedValue(plan(['A'], ['user']));
    await supervisor.start(); const socket = Socket.instances[0]; socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ id: 1, result: 999 }) });
    socket.emit('message', { data: JSON.stringify({ id: 100000, result: 500 }) });
    await flush();
    expect(mocks.resume).toHaveBeenCalledWith(['A'], 500);
    expect(mocks.save).toHaveBeenCalledWith({ _id: addressCheckpointId('A') }, expect.objectContaining({ $max: { lastSlot: 500 } }), { upsert: true });
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
  it('keeps checkpoints attached to addresses when connection groups change', async () => {
    mocks.checkpoint.mockImplementation(async ({ _id }) => ({ lastSlot: _id.endsWith(':A') ? 10 : 20 }));
    await backfillTrackedAddresses(['B', 'A'], 100);
    expect(mocks.backfill).toHaveBeenCalledWith('A', 10, 100, 20, expect.anything());
    expect(mocks.backfill).toHaveBeenCalledWith('B', 20, 100, 20, expect.anything());
  });
  it('never advances a checkpoint when generation changes during history recovery', async () => {
    let current = true;
    mocks.checkpoint.mockResolvedValue({ lastSlot: 10 });
    mocks.backfill.mockImplementation(async () => { current = false; return { pages: 1, processed: 0 }; });
    await backfillTrackedAddresses(['A'], 100, undefined, () => current);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not start paid history work for stale generations', async () => {
    await backfillTrackedAddresses(['A'], 100, undefined, () => false);
    expect(mocks.backfill).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
});
