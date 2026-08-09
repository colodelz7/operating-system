-- ============================================================
--  Tabela de sessao para connect-pg-simple (producao/Postgres)
-- ============================================================
--  O backend cria essa tabela automaticamente no boot
--  (createTableIfMissing: true). Este arquivo existe caso voce
--  prefira cria-la manualmente antes de subir a aplicacao:
--
--    psql "$DATABASE_URL" -f db/session.sql
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar      NOT NULL COLLATE "default",
  "sess"   json         NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session"
  DROP CONSTRAINT IF EXISTS "session_pkey";
ALTER TABLE "session"
  ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
