import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
let replica: MongoMemoryReplSet;
let database: typeof import('../db.js');
let service: typeof import('../services/paybox.js');
let app: typeof import('../app.js')['app'];
const address = 'So11111111111111111111111111111111111111112';
let calls: Array<{ url: string; body: any }>;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv('MONGODB_URI', replica.getUri());
  vi.stubEnv('MONGODB_DATABASE', 'paybox-tests');
  vi.stubEnv('PAYBOX_REDIRECT_URI', 'https://api.example.com/integrations/paybox/callback');
  database = await import('../db.js');
  service = await import('../services/paybox.js');
  app = (await import('../app.js')).app;
}, 120_000);
afterAll(async () => { await database?.closeDatabase(); await replica?.stop(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await (await database.getDatabase()).collection('paybox_imports').deleteMany({});
  await (await database.collections()).users.updateOne({ _id: 'owner' }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = String(init.body);
    calls.push({ url, body: body.startsWith('{') ? JSON.parse(body) : body });
    if (url.endsWith('/oauth/register')) return Response.json({ client_id: 'client' });
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'private-token' });
    const rpc = JSON.parse(body);
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize' ? { protocolVersion: '2025-06-18' } : {
      content: [{ type: 'text', text: JSON.stringify({ credentials: [
        { kind: 'wallet', name: 'My wallet', metadata: { chains: ['solana'], address } },
        { kind: 'wallet', metadata: { chains: ['evm'], address: '0x123' } },
      ], ungranted: [{ kind: 'wallet', metadata: { chains: ['solana'], address: '11111111111111111111111111111111' } }] }) }],
    } }, { headers: { 'mcp-session-id': 'session' } });
  }));
});
describe('Paybox wallet import', () => {
  it('uses single-use PKCE, imports only granted Solana addresses, never persists tokens, isolates owners', async () => {
    const start = await service.createPayboxImport('owner');
    const url = new URL(start.url);
    expect(url.searchParams.get('scope')).toBe('mcp');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(await service.completePayboxImport('wrong', 'code')).toBe(false);
    expect(await service.completePayboxImport(url.searchParams.get('state')!, 'code')).toBe(true);
    expect(await service.getPayboxImport('other', start.id)).toBeNull();
    expect(await service.getPayboxImport('owner', start.id)).toEqual({ status: 'ready', wallets: [{ name: 'My wallet', address }] });
    const record = await (await database.getDatabase()).collection('paybox_imports').findOne({});
    expect(JSON.stringify(record)).not.toContain('private-token');
    expect(record?.verifier).toBeUndefined();
    const count = calls.length;
    expect(await service.completePayboxImport(url.searchParams.get('state')!, 'code')).toBe(false);
    expect(calls).toHaveLength(count);
    expect(calls.filter(call => call.body.method === 'tools/call').map(call => call.body.params.name)).toEqual(['list_credentials']);
    await service.deletePayboxImport('other', start.id);
    expect(await service.getPayboxImport('owner', start.id)).not.toBeNull();
    await service.deletePayboxImport('owner', start.id);
    expect(await service.getPayboxImport('owner', start.id)).toBeNull();
  });
  it('handles denial and expires imports without exchanging a code', async () => {
    const start = await service.createPayboxImport('owner');
    expect(await service.completePayboxImport(new URL(start.url).searchParams.get('state')!)).toBe(false);
    expect((await service.getPayboxImport('owner', start.id))?.status).toBe('error');
    expect(calls.some(call => call.url.endsWith('/oauth/token'))).toBe(false);
    await (await database.getDatabase()).collection('paybox_imports').updateOne({}, { $set: { expiresAt: new Date(0) } });
    expect(await service.getPayboxImport('owner', start.id)).toBeNull();
  });
  it('requires a WhoAped session for import records', async () => {
    expect((await app.request('/v1/integrations/paybox/imports/id')).status).toBe(401);
  });
  it('parses SSE and deduplicates credentials without importing unsupported networks', async () => {
    const result = await service.readMcpResponse(new Response('event: message\r\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\r\n\r\n', { headers: { 'Content-Type': 'text/event-stream' } }), 2);
    expect(result).toEqual({ ok: true });
    const wallet = { kind: 'wallet', metadata: { chains: ['solana:mainnet'], address } };
    expect(service.parsePayboxWallets({ credentials: [wallet, wallet, { ...wallet, kind: 'secret' }] })).toEqual([{ name: 'Paybox wallet', address }]);
  });
});
