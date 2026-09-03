DO $$
BEGIN
  IF to_regclass('public.webhook_events') IS NOT NULL
     AND to_regclass('public.ingestion_events') IS NULL THEN
    ALTER TABLE webhook_events RENAME TO ingestion_events;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.webhook_events_received_brin') IS NOT NULL
     AND to_regclass('public.ingestion_events_received_brin') IS NULL THEN
    ALTER INDEX webhook_events_received_brin RENAME TO ingestion_events_received_brin;
  END IF;
END $$;

ALTER TABLE ingestion_events ADD COLUMN IF NOT EXISTS slot bigint;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS slot bigint;

CREATE INDEX IF NOT EXISTS ingestion_events_received_brin
  ON ingestion_events USING brin(received_at);
CREATE INDEX IF NOT EXISTS transactions_chain_slot_idx
  ON transactions(chain, slot DESC);

CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
  id text PRIMARY KEY,
  last_slot bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN transactions.slot IS
  'Solana slot used for deterministic ordering and Parsed Streams gap recovery; null only for legacy rows.';
