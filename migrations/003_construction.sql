CREATE TABLE IF NOT EXISTS structures(
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id),
  owner_id text NOT NULL REFERENCES accounts(id),
  title text NOT NULL,
  x double precision NOT NULL CHECK(x BETWEEN 0.1 AND 0.9),
  y double precision NOT NULL CHECK(y BETWEEN 0.55 AND 0.9),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(blocks)='array' AND jsonb_array_length(blocks)<=64),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE INDEX IF NOT EXISTS structures_room_lease ON structures(channel_id,expires_at);
CREATE TABLE IF NOT EXISTS construction_receipts(
  account_id text NOT NULL REFERENCES accounts(id),
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,request_id)
);
