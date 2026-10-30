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
--  Instalacoes NOVAS ja vem com tudo pelo db/schema.sql, nao precisam
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

-- 5) trilha de auditoria: novas colunas do historico -----------------
--    (entidade/entidade_id, IP e navegador; eventos de login/logout)
ALTER TABLE historico ADD COLUMN IF NOT EXISTS entidade    TEXT NOT NULL DEFAULT 'tarefa';
ALTER TABLE historico ADD COLUMN IF NOT EXISTS entidade_id INT;
ALTER TABLE historico ADD COLUMN IF NOT EXISTS ip          TEXT DEFAULT '';
ALTER TABLE historico ADD COLUMN IF NOT EXISTS user_agent  TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_historico_criado   ON historico(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_historico_entidade ON historico(entidade);
CREATE INDEX IF NOT EXISTS idx_historico_usuario  ON historico(usuario_id);

-- 6) usuarios: desativacao e permissao de clientes -------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pode_clientes BOOLEAN NOT NULL DEFAULT false;

-- 7) bloqueio de login persistente ----------------------------------
CREATE TABLE IF NOT EXISTS login_bloqueio (
  chave  TEXT PRIMARY KEY,
  falhas INT NOT NULL DEFAULT 0,
  ate    TIMESTAMPTZ,
  visto  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_bloqueio_visto ON login_bloqueio(visto);

-- 8) tarefas recorrentes + comentarios --------------------------------
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS recorrencia           TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS recorrencia_ate       DATE;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS recorrencia_origem_id INT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS recorrencia_gerou_id  INT;
CREATE INDEX IF NOT EXISTS idx_tarefas_recorrencia ON tarefas(recorrencia) WHERE recorrencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS comentarios (
  id         SERIAL PRIMARY KEY,
  tarefa_id  INT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  texto      TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comentarios_tarefa ON comentarios(tarefa_id);

-- 9) troca de senha derruba as sessoes abertas ------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_versao INT NOT NULL DEFAULT 0;

-- 10) v0.4: calendario interno, chat, prompts, briefing, cofre, push ----
ALTER TABLE usuarios  ADD COLUMN IF NOT EXISTS avatar_path TEXT;
ALTER TABLE historico ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT '';

-- ---------------- CALENDARIO DA EQUIPE (eventos internos) ----------------
-- setor_id NULL = evento da equipe toda; preenchido = so daquele setor.
-- Participantes sempre enxergam o evento, mesmo de outro setor.
CREATE TABLE IF NOT EXISTS eventos (
  id            SERIAL PRIMARY KEY,
  titulo        TEXT NOT NULL,
  descricao     TEXT DEFAULT '',
  data          DATE NOT NULL,
  hora_inicio   TEXT,             -- 'HH:MM' (vazio = dia todo)
  hora_fim      TEXT,
  local         TEXT DEFAULT '',
  setor_id      INT REFERENCES setores(id) ON DELETE SET NULL,
  criado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos(data);

CREATE TABLE IF NOT EXISTS evento_participantes (
  evento_id  INT NOT NULL REFERENCES eventos(id)  ON DELETE CASCADE,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (evento_id, usuario_id)
);

-- ---------------- CHAT INTERNO ----------------
CREATE TABLE IF NOT EXISTS chat_conversas (
  id            SERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('grupo','direta')),
  nome          TEXT DEFAULT '',
  criado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()   -- ultima atividade (ordena a lista)
);

CREATE TABLE IF NOT EXISTS chat_membros (
  conversa_id    INT NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
  usuario_id     INT NOT NULL REFERENCES usuarios(id)       ON DELETE CASCADE,
  ultima_lida_id INT NOT NULL DEFAULT 0,   -- ate qual mensagem a pessoa ja leu
  PRIMARY KEY (conversa_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_membros_usuario ON chat_membros(usuario_id);

CREATE TABLE IF NOT EXISTS chat_mensagens (
  id                  SERIAL PRIMARY KEY,
  conversa_id         INT NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
  usuario_id          INT REFERENCES usuarios(id) ON DELETE SET NULL,
  texto               TEXT NOT NULL DEFAULT '',
  anexo_nome_original TEXT,
  anexo_arquivo       TEXT,
  anexo_mime          TEXT,
  anexo_tamanho       BIGINT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_conversa ON chat_mensagens(conversa_id, id DESC);

-- ---------------- PROMPTS (da equipe) E MENSAGENS SALVAS (pessoais) ----------------
-- tipo 'prompt' = biblioteca compartilhada; 'mensagem' = so o dono ve.
CREATE TABLE IF NOT EXISTS textos_salvos (
  id            SERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('prompt','mensagem')),
  usuario_id    INT REFERENCES usuarios(id) ON DELETE SET NULL,  -- prompt sobrevive ao autor
  titulo        TEXT NOT NULL,
  conteudo      TEXT NOT NULL DEFAULT '',
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_textos_tipo_usuario ON textos_salvos(tipo, usuario_id);

-- ---------------- BRIEFINGS ----------------
-- As perguntas vivem no backend (services/briefing.js); aqui so as respostas.
CREATE TABLE IF NOT EXISTS briefings (
  id             SERIAL PRIMARY KEY,
  cliente_id     INT REFERENCES clientes(id) ON DELETE SET NULL,
  empresa        TEXT NOT NULL,
  respostas      JSONB NOT NULL DEFAULT '{}',
  criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- COFRE DE ACESSOS ----------------
-- A senha fica cifrada (AES-256-GCM) com a chave COFRE_CHAVE, que vive so no
-- .env do servidor. Sem a chave, o banco sozinho nao entrega senha nenhuma.
CREATE TABLE IF NOT EXISTS acessos (
  id            SERIAL PRIMARY KEY,
  cliente_id    INT REFERENCES clientes(id) ON DELETE SET NULL,
  servico       TEXT NOT NULL,
  url           TEXT DEFAULT '',
  login         TEXT DEFAULT '',
  senha_cifrada TEXT,
  observacoes   TEXT DEFAULT '',
  criado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- NOTIFICACOES PUSH (aparelhos inscritos) ----------------
CREATE TABLE IF NOT EXISTS push_inscricoes (
  id         SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint   TEXT UNIQUE NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_usuario ON push_inscricoes(usuario_id);

-- ---------------- SERVICOS E DATAS IMPORTANTES DO CLIENTE ----------------
CREATE TABLE IF NOT EXISTS cliente_servicos (
  id         SERIAL PRIMARY KEY,
  cliente_id INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- o mesmo servico nao entra duas vezes no mesmo cliente (sem diferenciar maiuscula)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_servico ON cliente_servicos(cliente_id, lower(nome));

-- datas que repetem todo ano (aniversario da empresa, do dono, datas do nicho)
CREATE TABLE IF NOT EXISTS cliente_datas (
  id         SERIAL PRIMARY KEY,
  cliente_id INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  mes        INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  dia        INT NOT NULL CHECK (dia BETWEEN 1 AND 31),
  nome       TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cliente_datas_cliente ON cliente_datas(cliente_id);

-- ---------------- ARQUIVOS DO BRIEFING ----------------
CREATE TABLE IF NOT EXISTS briefing_arquivos (
  id            SERIAL PRIMARY KEY,
  briefing_id   INT NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL,
  nome_arquivo  TEXT NOT NULL,
  mime          TEXT,
  tamanho       BIGINT,
  enviado_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_briefing_arquivos ON briefing_arquivos(briefing_id);

COMMIT;
