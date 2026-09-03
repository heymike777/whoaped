CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TYPE chain_id AS ENUM ('solana', 'ethereum', 'base');
CREATE TYPE wallet_status AS ENUM ('syncing', 'active', 'error');
CREATE TYPE activity_kind AS ENUM ('swap', 'buy', 'stake', 'transfer', 'nft', 'unknown');

CREATE TABLE wallets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(40) NOT NULL,
  address varchar(128) NOT NULL,
  chain chain_id NOT NULL,
  status wallet_status NOT NULL DEFAULT 'syncing',
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX wallets_active_address_uq ON wallets(user_id, chain, address) WHERE deleted_at IS NULL;
CREATE INDEX wallets_chain_address_idx ON wallets(chain, address) WHERE deleted_at IS NULL;

CREATE TABLE ingestion_events (
  id uuid PRIMARY KEY,
  provider varchar(32) NOT NULL,
  external_id text NOT NULL,
  slot bigint,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, external_id)
);
CREATE INDEX ingestion_events_received_brin ON ingestion_events USING brin(received_at);

-- Start unpartitioned: Postgres handles the first tens of millions of compact rows well.
-- Move this table to monthly RANGE partitions before the working set exceeds memory;
-- the API already includes occurred_at in every write and read path.
CREATE TABLE transactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  chain chain_id NOT NULL,
  tx_hash text NOT NULL,
  event_index integer NOT NULL DEFAULT 0,
  slot bigint NOT NULL,
  kind activity_kind NOT NULL,
  title varchar(180) NOT NULL,
  detail varchar(240) NOT NULL,
  source varchar(80),
  value_usd numeric(24, 8),
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wallet_id, chain, tx_hash, event_index)
);
CREATE INDEX transactions_user_feed_idx ON transactions(user_id, occurred_at DESC) INCLUDE (wallet_id, kind, title, detail, source, value_usd);
CREATE INDEX transactions_wallet_feed_idx ON transactions(wallet_id, occurred_at DESC);
CREATE INDEX transactions_occurred_brin ON transactions USING brin(occurred_at);
CREATE INDEX transactions_chain_slot_idx ON transactions(chain, slot DESC);

CREATE TABLE pipeline_checkpoints (
  id text PRIMARY KEY,
  last_slot bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform varchar(16) NOT NULL CHECK (platform IN ('ios', 'android')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE INDEX device_tokens_user_idx ON device_tokens(user_id) WHERE disabled_at IS NULL;

CREATE TYPE notification_status AS ENUM ('pending', 'processing', 'sent', 'failed');
CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token_id uuid NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  body varchar(180) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status notification_status NOT NULL DEFAULT 'pending',
  attempts smallint NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_token_id, transaction_id)
);
CREATE INDEX notification_jobs_pending_idx ON notification_jobs(available_at, created_at) WHERE status = 'pending';

-- Run daily once traffic starts. Raw provider payloads are for replay/debugging, not permanent history.
-- DELETE FROM ingestion_events WHERE received_at < now() - interval '7 days';
