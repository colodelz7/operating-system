-- ============================================================
--  Colodel :: Sistema de Tarefas  ::  MIGRACAO v0.3 (PostgreSQL)
-- ============================================================
--  Aplique num banco JA EXISTENTE (nao destrutivo, idempotente):
--
--    psql "$DATABASE_URL" -f db/migracao_v0_3.sql
--
--  O que faz:
--   1. Cria a tabela de visibilidade de colunas por usuario (Criativo).
--   2. Cria a tabela de historico (a versao anterior nao a tinha no
--      Postgres, o que quebrava as acoes de tarefa em producao).
--   3. Adiciona setor_id/prioridade em notificacoes (escopo do sino).
--   4. Adiciona andamento_inicio e contadores de retrabalho em tarefas
--      (cronometro, retrabalho % e arquivamento no Postgres).
--
--  Instalacoes NOVAS ja vem com tudo pelo db/schema.sql — nao precisam
--  desta migracao.
-- ------------------------------------------------------------

BEGIN;

-- 1) visibilidade de colunas por usuario -----------------------------
CREATE TABLE IF NOT EXISTS usuario_colunas (
  usuario_id INT NOT NULL REFERENCES usuarios(id)       ON DELETE CASCADE,
  coluna_id  INT NOT NULL REFERENCES colunas_status(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, coluna_id)
);

-- 2) historico -------------------------------------------------------
CREATE TABLE IF NOT EXISTS historico (
  id           SERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL,
  tarefa_id    INT,
  titulo       TEXT DEFAULT '',
  setor_id     INT,
  usuario_id   INT,
  usuario_nome TEXT DEFAULT '',
  detalhe      TEXT DEFAULT '',
  cliente_id   INT,
  cliente_nome TEXT DEFAULT '',
  responsaveis JSONB DEFAULT '[]',
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_historico_setor ON historico(setor_id);

-- 3) escopo das notificacoes -----------------------------------------
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS setor_id   INT REFERENCES setores(id) ON DELETE SET NULL;
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS prioridade TEXT;
CREATE INDEX IF NOT EXISTS idx_notif_setor ON notificacoes(setor_id);

-- 4) cronometro e retrabalho em tarefas ------------------------------
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS andamento_inicio  TIMESTAMPTZ;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS retrabalho_design INT NOT NULL DEFAULT 0;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS retrabalho_edicao INT NOT NULL DEFAULT 0;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS retrabalho_pdf    INT NOT NULL DEFAULT 0;

COMMIT;