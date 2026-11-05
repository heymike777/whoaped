import { MongoClient, type ClientSession, type Collection, type Db } from 'mongodb';

import type { ChainId, NormalizedActivity } from './chains/types.js';

export type UserDocument = { _id: string; createdAt: Date; mergedInto?: string; mergedAt?: Date; writeVersion?: number; trackFailedTransactions?: boolean };
export type AccountLinkDocument = {
  _id: string; userId: string; code: string; createdAt: Date; expiresAt: Date;
  status: 'pending' | 'confirmed' | 'cancelled'; confirmedChatId?: string; claimedChatId?: string;
};
// Provider event IDs remain unique across account merges; billing can grant entitlements here later.
export type AccountEntitlementDocument = {
  _id: string; userId: string; provider: string; externalId: string;
  feature: string; expiresAt?: Date; revokedAt?: Date; createdAt: Date;
};
export type PaymentOrderDocument = {
  _id: string; userId: string; plan: 'month' | 'year'; provider: 'usdc' | 'stars';
  amount: number; currency: 'USDC' | 'XTR'; status: 'pending' | 'paid' | 'refunded' | 'expired';
  createdAt: Date; expiresAt: Date; paidAt?: Date; paymentId?: string;
  accessStartsAt?: Date; accessEndsAt?: Date; telegramUserId?: string;
  payer?: string; recipient?: string; sourceTokenAccount?: string; destinationTokenAccount?: string;
  reference?: string; memo?: string; signature?: string; requestKey?: string;
  nextCheckAt?: Date; checks?: number; lastError?: string;
};
export type BillingSupportDocument = {
  _id: string; userId: string; message: string; createdAt: Date; status: 'open' | 'closed';
};
export type SessionDocument = {
  _id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date;
};
export type WalletDocument = {
  _id: string;
  userId: string;
  name: string;
  address: string;
  chain: ChainId;
  status: 'syncing' | 'active' | 'error';
  syncError?: string;
  createdAt: Date;
  deletedAt?: Date | null;
  mergedIntoWalletId?: string;
  telegramAlertsFrom?: Date;
};
export type IngestionEventDocument = {
  _id: string; provider: string; externalId: string; slot: number; payload: unknown; receivedAt: Date;
};
export type TransactionDocument = {
  _id: string;
  userId: string;
  walletId: string;
  chain: ChainId;
  txHash: string;
  eventIndex: number;
  slot: number;
  kind: NormalizedActivity['kind'];
  title: string;
  detail: string;
  source?: string;
  valueUsd?: number;
  occurredAt: Date;
  metadata: Record<string, unknown>;
  suppressed?: boolean;
  mergedIntoTransactionId?: string;
  createdAt: Date;
};
export type TokenMetadataDocument = {
  _id: string;
  chain: 'solana';
  symbol?: string;
  name?: string;
  iconUrl?: string;
  decimals?: number;
  isVerified?: boolean;
  source: 'jupiter' | 'onchain' | 'missing';
  refreshAfter: Date;
  updatedAt: Date;
};
export type PortfolioHolding = { mint: string; symbol: string; amount: number; usdValue: number | null };
export type PortfolioWallet = { id: string; name: string; address: string; holdings: PortfolioHolding[]; incomplete?: boolean; error?: boolean };
export type PortfolioSnapshotDocument = {
  _id: string; walletIds: string[]; wallets: PortfolioWallet[];
  createdAt: Date; expiresAt: Date; incomplete: boolean;
};
export type DiscoveryProfileDocument = {
  _id: string;
  chain: 'solana';
  name: string;
  twitter: string | null;
  telegram: string | null;
  source: 'kolscan';
  firstSeenAt: Date;
  lastSeenAt: Date;
};
export type DiscoverySyncDocument = {
  _id: string;
  nextRunAt: Date;
  leaseUntil: Date;
  leaseToken?: string;
  reportChatId?: string;
  lastSuccessAt?: Date;
  lastCount?: number;
  lastError?: string;
  lastReport?: { status: 'ok' | 'error'; parsed: number | null; added: number | null; missing: number | null; finishedAt: Date; error?: string };
};
export type PipelineCheckpointDocument = { _id: string; lastSlot: number; updatedAt: Date };
export type TrackingStateDocument = {
  _id: string; paused?: boolean; cooldownUntil?: Date; cooldownStartedAt?: Date;
  reason?: string; resumePending?: boolean; ignoreThroughSlot?: number; updatedAt: Date;
};
export type RateEventDocument = {
  _id: string; userId: string; chain: 'solana'; txHash: string; slot: number; observedAt: Date;
};
export type DeviceTokenDocument = {
  _id: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android';
  lastSeenAt: Date;
  createdAt: Date;
  disabledAt?: Date;
};
export type NotificationJobDocument = {
  _id: string;
  userId: string;
  deviceTokenId: string;
  transactionId: string;
  dedupeKey?: string;
  failedTransaction?: boolean;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  attempts: number;
  availableAt: Date;
  lastError?: string;
  sentAt?: Date;
  createdAt: Date;
};

export type TelegramUpdateDocument = {
  _id: string; payload: unknown; walletAction?: 'add' | 'remove'; status: 'pending' | 'processing' | 'sent' | 'failed';
  availableAt: Date; createdAt: Date; attempts: number;
};
export type TelegramJobDocument = {
  _id: string; chatId: string; walletId: string; txHash: string; slot: number;
  kind?: 'account' | 'failed' | 'group' | 'discovery'; userId?: string; priority?: number; walletIds?: string[];
  text: string; parseMode?: 'HTML'; buttons: Array<Array<{ text: string; url: string }>>;
  status: 'pending' | 'processing' | 'sent' | 'failed'; attempts: number;
  availableAt: Date; createdAt: Date; sentAt?: Date; lastError?: string;
};
export type TelegramChatDocument = {
  _id: string; createdAt: Date; disabledAt?: Date; pendingAction?: 'add' | 'remove';
  userId?: string; linkedAt?: Date; username?: string; discoveryQuery?: string;
};
export type TelegramAnalyticsEventDocument = {
  _id: string; chatId: string; type: 'interaction' | 'wallet_added' | 'wallet_removed';
  command?: string; surface?: 'command' | 'button' | 'message'; userStatus?: 'new' | 'returning';
  occurredAt: Date; gaStatus?: 'processing' | 'sent' | 'pending' | 'expired';
  gaAvailableAt?: Date; gaAttempts?: number; gaSentAt?: Date;
};

export type Collections = {
  users: Collection<UserDocument>;
  sessions: Collection<SessionDocument>;
  wallets: Collection<WalletDocument>;
  ingestionEvents: Collection<IngestionEventDocument>;
  transactions: Collection<TransactionDocument>;
  tokenMetadata: Collection<TokenMetadataDocument>;
  portfolioSnapshots: Collection<PortfolioSnapshotDocument>;
  discoveryProfiles: Collection<DiscoveryProfileDocument>;
  discoverySync: Collection<DiscoverySyncDocument>;
  pipelineCheckpoints: Collection<PipelineCheckpointDocument>;
  deviceTokens: Collection<DeviceTokenDocument>;
  notificationJobs: Collection<NotificationJobDocument>;
  telegramJobs: Collection<TelegramJobDocument>;
  telegramUpdates: Collection<TelegramUpdateDocument>;
  telegramChats: Collection<TelegramChatDocument>;
  telegramAnalyticsEvents: Collection<TelegramAnalyticsEventDocument>;
  accountLinks: Collection<AccountLinkDocument>;
  accountEntitlements: Collection<AccountEntitlementDocument>;
  trackingStates: Collection<TrackingStateDocument>;
  rateEvents: Collection<RateEventDocument>;
  paymentOrders: Collection<PaymentOrderDocument>;
  billingSupport: Collection<BillingSupportDocument>;
};

const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE ?? 'whoaped';
let client: MongoClient | undefined;
let databasePromise: Promise<Db> | undefined;

export function hasDatabase() {
  return Boolean(mongoUri);
}

function databaseCollections(database: Db): Collections {
  return {
    users: database.collection<UserDocument>('users'),
    sessions: database.collection<SessionDocument>('sessions'),
    wallets: database.collection<WalletDocument>('wallets'),
    ingestionEvents: database.collection<IngestionEventDocument>('ingestion_events'),
    transactions: database.collection<TransactionDocument>('transactions'),
    tokenMetadata: database.collection<TokenMetadataDocument>('token_metadata'),
    portfolioSnapshots: database.collection<PortfolioSnapshotDocument>('portfolio_snapshots'),
    discoveryProfiles: database.collection<DiscoveryProfileDocument>('discovery_profiles'),
    discoverySync: database.collection<DiscoverySyncDocument>('discovery_sync'),
    pipelineCheckpoints: database.collection<PipelineCheckpointDocument>('pipeline_checkpoints'),
    deviceTokens: database.collection<DeviceTokenDocument>('device_tokens'),
    notificationJobs: database.collection<NotificationJobDocument>('notification_jobs'),
    telegramJobs: database.collection<TelegramJobDocument>('telegram_jobs'),
    telegramUpdates: database.collection<TelegramUpdateDocument>('telegram_updates'),
    telegramChats: database.collection<TelegramChatDocument>('telegram_chats'),
    telegramAnalyticsEvents: database.collection<TelegramAnalyticsEventDocument>('telegram_analytics_events'),
    accountLinks: database.collection<AccountLinkDocument>('account_links'),
    accountEntitlements: database.collection<AccountEntitlementDocument>('account_entitlements'),
    trackingStates: database.collection<TrackingStateDocument>('tracking_states'),
    rateEvents: database.collection<RateEventDocument>('rate_events'),
    paymentOrders: database.collection<PaymentOrderDocument>('payment_orders'),
    billingSupport: database.collection<BillingSupportDocument>('billing_support'),
  };
}

async function ensureIndexes(database: Db) {
  const db = databaseCollections(database);
  await Promise.all([
    db.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.wallets.createIndex(
      { userId: 1, chain: 1, address: 1 },
      { unique: true, partialFilterExpression: { deletedAt: null } },
    ),
    db.wallets.createIndex({ chain: 1, address: 1, status: 1 }),
    db.ingestionEvents.createIndex({ provider: 1, externalId: 1 }, { unique: true }),
    db.ingestionEvents.createIndex({ receivedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }),
    db.transactions.createIndex(
      { walletId: 1, chain: 1, txHash: 1, eventIndex: 1 },
      { unique: true },
    ),
    db.transactions.createIndex({ userId: 1, occurredAt: -1, createdAt: -1, _id: -1 }),
    db.transactions.createIndex({ walletId: 1, occurredAt: -1 }),
    db.transactions.createIndex({ chain: 1, slot: -1 }),
    db.portfolioSnapshots.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.discoveryProfiles.createIndex({ source: 1, lastSeenAt: -1 }),
    db.deviceTokens.createIndex({ token: 1 }, { unique: true }),
    db.deviceTokens.createIndex({ userId: 1, disabledAt: 1 }),
    db.notificationJobs.createIndex(
      { deviceTokenId: 1, transactionId: 1 },
      { unique: true },
    ),
    db.notificationJobs.createIndex(
      { deviceTokenId: 1, dedupeKey: 1 },
      { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
    ),
    db.notificationJobs.createIndex({ status: 1, availableAt: 1, createdAt: 1 }),
    db.telegramJobs.createIndex({ walletId: 1, txHash: 1 }, { unique: true }),
    db.telegramJobs.createIndex({ status: 1, availableAt: 1, createdAt: 1 }),
    db.telegramJobs.createIndex({ chatId: 1, createdAt: -1, _id: -1 }),
    db.telegramUpdates.createIndex({ status: 1, availableAt: 1, createdAt: 1 }),
    db.telegramChats.createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'string' } } }),
    db.telegramChats.createIndex({ username: 1 }),
    db.telegramAnalyticsEvents.createIndex({ occurredAt: 1, type: 1 }),
    db.telegramAnalyticsEvents.createIndex({ chatId: 1, occurredAt: 1 }),
    db.telegramAnalyticsEvents.createIndex({ gaStatus: 1, gaAvailableAt: 1, occurredAt: 1 }),
    db.accountLinks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.accountLinks.createIndex({ userId: 1, status: 1 }),
    db.accountEntitlements.createIndex({ provider: 1, externalId: 1 }, { unique: true }),
    db.accountEntitlements.createIndex({ userId: 1 }),
    db.trackingStates.createIndex({ cooldownUntil: 1 }),
    db.rateEvents.createIndex({ userId: 1, chain: 1, txHash: 1 }, { unique: true }),
    db.rateEvents.createIndex({ userId: 1, observedAt: -1 }),
    db.paymentOrders.createIndex({ provider: 1, paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } }),
    db.paymentOrders.createIndex({ userId: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } }),
    db.paymentOrders.createIndex({ userId: 1, createdAt: -1 }),
    db.paymentOrders.createIndex({ provider: 1, status: 1, nextCheckAt: 1 }),
    db.billingSupport.createIndex({ status: 1, createdAt: 1 }),
  ]);
}

export async function getDatabase() {
  if (!mongoUri) throw new Error('MONGODB_URI is not configured');
  if (!databasePromise) {
    client = new MongoClient(mongoUri, { appName: 'whoaped-api' });
    databasePromise = client.connect().then(async (connected) => {
      const database = connected.db(databaseName);
      await ensureIndexes(database);
      return database;
    }).catch((error) => {
      databasePromise = undefined;
      client = undefined;
      throw error;
    });
  }
  return databasePromise;
}

export async function collections() {
  return databaseCollections(await getDatabase());
}

export async function withDatabaseTransaction<T>(work: (db: Collections, session: ClientSession) => Promise<T>) {
  const database = await getDatabase();
  const session = client!.startSession();
  try {
    return await session.withTransaction(() => work(databaseCollections(database), session));
  } finally { await session.endSession(); }
}

export async function closeDatabase() {
  await client?.close();
  client = undefined;
  databasePromise = undefined;
}
