CREATE TABLE IF NOT EXISTS users (
  cpf_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  cpf_masked TEXT NOT NULL,
  name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cloud_revision INTEGER NOT NULL DEFAULT 0,
  state_iv TEXT NOT NULL,
  state_cipher TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_id_index ON users (id);

CREATE TABLE IF NOT EXISTS auth_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
