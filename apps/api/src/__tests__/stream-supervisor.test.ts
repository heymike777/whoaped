import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ plan: vi.fn(), resume: vi.fn(), backfill: vi.fn(), ingest: vi.fn(), checkpoint: vi.fn(), save: vi.fn() }));
vi.mock('../db.js', () => ({ collections: async () => ({ pipelineCheckpoints: { findOne: mocks.checkpoint, updateOne: mocks.save } }) }));
vi.mock('../services/rate-limits.js', () => ({ eligibleSubscriptionPlan: mocks.plan, resumeAccountsAtSlot: mocks.resume }));
vi.mock('../services/parsed-events.js', () => ({ backfillParsedEvents: mocks.backfill }));
vi.mock('../services/parsed-transactions.js', () => ({ ingestParsedTransaction: mocks.ingest }));
vi.mock('../services/push.js', () => ({ drainNotificationJobs: vi.fn() }));
vi.mock('../services/telegram.js', () => ({ drainTelegramJobs: vi.fn() }));
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
const tx = (signature: string) => ({ data: JSON.stringify({ method: 'parsedTransactionNotification', params: { result: { context: { slot: 101 }, value: { transaction: { signature, slot: 101, accountKeys: ['A'] } } } } }) });
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); Socket.instances = [];
  vi.stubEnv('HELIUS_API_KEY', 'test-key'); vi.stubGlobal('WebSocket', Socket);
  mocks.plan.mockResolvedValue(plan(['A', 'B'])); mocks.checkpoint.mockResolvedValue(null);
  mocks.backfill.mockResolvedValue({ pages: 0, processed: 0 }); mocks.resume.mockResolvedValue(undefined);
  supervisor = new ParsedStreamSupervisor();
});
afterEach(() => { supervisor.stop(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('upstream quota enforcement', () => {
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
