import type { ChangeStream, ChangeStreamInsertDocument } from 'mongodb';

import { authenticateSessionToken } from './auth.js';
import { collections, type TransactionDocument } from './db.js';
import { canonicalAccountId } from './services/accounts.js';
import { activityView } from './services/activity-view.js';

type RealtimeClient = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type ClientState = { userId: string; client: RealtimeClient };

const HEARTBEAT_MS = 25_000;

export class ActivityRealtimeHub {
  private clients = new Set<ClientState>();
  private changeStream?: ChangeStream<TransactionDocument>;
  private heartbeat?: NodeJS.Timeout;
  private watching?: Promise<void>;
  private stopped = false;

  async authenticateAndSubscribe(client: RealtimeClient, token: string) {
    const session = await authenticateSessionToken(token);
    if (!session) {
      client.close(4001, 'Authentication failed');
      return false;
    }

    this.clients.add({ userId: session.userId, client });
    client.send(JSON.stringify({ type: 'ready' }));
    this.ensureHeartbeat();
    this.ensureWatching();
    return true;
  }

  unsubscribe(client: RealtimeClient) {
    for (const state of this.clients) {
      if (state.client === client) this.clients.delete(state);
    }
    if (!this.clients.size && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  async stop() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    await this.changeStream?.close();
    this.changeStream = undefined;
    for (const { client } of this.clients) client.close(1001, 'Server stopping');
    this.clients.clear();
  }

  private ensureHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const payload = JSON.stringify({ type: 'ping', timestamp: Date.now() });
      for (const state of this.clients) {
        try {
          state.client.send(payload);
        } catch {
          this.clients.delete(state);
        }
      }
    }, HEARTBEAT_MS);
  }

  private ensureWatching() {
    if (this.watching || this.stopped) return;
    this.watching = this.watch().finally(() => {
      this.watching = undefined;
      if (!this.stopped && this.clients.size) {
        setTimeout(() => this.ensureWatching(), 1_000);
      }
    });
  }

  private async watch() {
    try {
      const db = await collections();
      this.changeStream = db.transactions.watch(
        [{ $match: { operationType: 'insert' } }],
        { fullDocument: 'updateLookup' },
      );
      const syncPayload = JSON.stringify({ type: 'sync' });
      for (const { client } of this.clients) client.send(syncPayload);
      for await (const change of this.changeStream) {
        if (this.stopped) return;
        if (change.operationType !== 'insert') continue;
        await this.broadcast(change as ChangeStreamInsertDocument<TransactionDocument>);
      }
    } catch (error) {
      if (!this.stopped) console.error('Activity realtime stream failed', error);
    } finally {
      this.changeStream = undefined;
    }
  }

  private async broadcast(change: ChangeStreamInsertDocument<TransactionDocument>) {
    const transaction = change.fullDocument;
    const db = await collections();
    // Existing sockets follow the same account alias as HTTP sessions after a link.
    for (const state of this.clients) state.userId = await canonicalAccountId(state.userId, db);
    const recipients = [...this.clients].filter((state) => state.userId === transaction.userId);
    if (!recipients.length) return;
    const wallet = await db.wallets.findOne({ _id: transaction.walletId });
    const payload = JSON.stringify({ type: 'activity', data: activityView(transaction, wallet ?? undefined) });
    for (const state of recipients) {
      try {
        state.client.send(payload);
      } catch {
        this.clients.delete(state);
      }
    }
  }
}

export const activityRealtimeHub = new ActivityRealtimeHub();
