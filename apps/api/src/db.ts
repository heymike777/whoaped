import { MongoClient, type Collection, type Db } from 'mongodb';

import type { ChainId, NormalizedActivity } from './chains/types.js';

export type UserDocument = { _id: string; createdAt: Date };
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
export type PipelineCheckpointDocument = { _id: string; lastSlot: number; updatedAt: Date };
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
  _id: string; payload: unknown; status: 'pending' | 'processing' | 'sent' | 'failed';
  availableAt: Date; createdAt: Date; attempts: number;
};
export type TelegramJobDocument = {
  _id: string; chatId: string; walletId: string; txHash: string; slot: number;
  text: string; buttons: Array<Array<{ text: string; url: string }>>;
  status: 'pending' | 'processing' | 'sent' | 'failed'; attempts: number;
  availableAt: Date; createdAt: Date; sentAt?: Date; lastError?: string;
};
export type TelegramChatDocument = { _id: string; createdAt: Date; disabledAt?: Date };

export type Collections = {
  users: Collection<UserDocument>;
  sessions: Collection<SessionDocument>;
  wallets: Collection<WalletDocument>;
  ingestionEvents: Collection<IngestionEventDocument>;
  transactions: Collection<TransactionDocument>;
  tokenMetadata: Collection<TokenMetadataDocument>;
  pipelineCheckpoints: Collection<PipelineCheckpointDocument>;
  deviceTokens: Collection<DeviceTokenDocument>;
  notificationJobs: Collection<NotificationJobDocument>;
  telegramJobs: Collection<TelegramJobDocument>;
  telegramUpdates: Collection<TelegramUpdateDocument>;
  telegramChats: Collection<TelegramChatDocument>;
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
    pipelineCheckpoints: database.collection<PipelineCheckpointDocument>('pipeline_checkpoints'),
    deviceTokens: database.collection<DeviceTokenDocument>('device_tokens'),
    notificationJobs: database.collection<NotificationJobDocument>('notification_jobs'),
    telegramJobs: database.collection<TelegramJobDocument>('telegram_jobs'),
    telegramUpdates: database.collection<TelegramUpdateDocument>('telegram_updates'),
    telegramChats: database.collection<TelegramChatDocument>('telegram_chats'),
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
    db.deviceTokens.createIndex({ token: 1 }, { unique: true }),
    db.deviceTokens.createIndex({ userId: 1, disabledAt: 1 }),
    db.notificationJobs.createIndex(
      { deviceTokenId: 1, transactionId: 1 },
      { unique: true },
    ),
    db.notificationJobs.createIndex({ status: 1, availableAt: 1, createdAt: 1 }),
    db.telegramJobs.createIndex({ walletId: 1, txHash: 1 }, { unique: true }),
    db.telegramJobs.createIndex({ status: 1, availableAt: 1, createdAt: 1 }),
    db.telegramJobs.createIndex({ chatId: 1, createdAt: -1, _id: -1 }),
    db.telegramUpdates.createIndex({ status: 1, availableAt: 1, createdAt: 1 }),
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

export async function closeDatabase() {
  await client?.close();
  client = undefined;
  databasePromise = undefined;
}
