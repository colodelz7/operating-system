-- ============================================================
--  Colodel :: Sistema de Tarefas  ::  SCHEMA (PostgreSQL)
-- ============================================================
--  Uso:
--    createdb colodel_tarefas
--    psql colodel_tarefas -f db/schema.sql
--    psql colodel_tarefas -f db/seed.sql
-- ------------------------------------------------------------

BEGIN;

DROP TABLE IF EXISTS historico           CASCADE;
DROP TABLE IF EXISTS notificacoes        CASCADE;
DROP TABLE IF EXISTS comentarios         CASCADE;
DROP TABLE IF EXISTS anexos              CASCADE;
DROP TABLE IF EXISTS tarefa_responsaveis CASCADE;
DROP TABLE IF EXISTS usuario_colunas     CASCADE;
DROP TABLE IF EXISTS tarefas             CASCADE;
DROP TABLE IF EXISTS colunas_status      CASCADE;
DROP TABLE IF EXISTS clientes            CASCADE;
DROP TABLE IF EXISTS usuarios            CASCADE;
DROP TABLE IF EXISTS setores             CASCADE;

-- ---------------- SETORES ----------------
CREATE TABLE setores (
  id     SERIAL PRIMARY KEY,
  slug   TEXT UNIQUE NOT NULL,
  nome   TEXT NOT NULL,
  ordem  INT  NOT NULL DEFAULT 0,
  cor    TEXT NOT NULL DEFAULT '#120a8f'
);

-- ---------------- USUARIOS ----------------
CREATE TABLE usuarios (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,           -- login (minusculas)
  senha_hash TEXT NOT NULL,                  -- bcrypt
  setor_id   INT  NOT NULL REFERENCES setores(id),
  papel      TEXT NOT NULL DEFAULT 'membro'  -- 'admin' | 'membro'
             CHECK (papel IN ('admin','membro')),
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- desligar alguem sem apagar o historico dela: conta desativada nao entra
  -- e derruba a sessao aberta na requisicao seguinte
  ativo         BOOLEAN NOT NULL DEFAULT true,
  -- pode cadastrar e editar clientes (admin e o Comercial ja podem por regra)
  pode_clientes BOOLEAN NOT NULL DEFAULT false
);

-- ---------------- COLUNAS DO KANBAN (por setor) ----------------
CREATE TABLE colunas_status (
  id          SERIAL PRIMARY KEY,
  setor_id    INT  NOT NULL REFERENCES setores(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  ordem       INT  NOT NULL DEFAULT 0,
  e_conclusao BOOLEAN NOT NULL DEFAULT false   -- ultima coluna dispara o sino do admin
);
CREATE INDEX idx_colunas_setor ON colunas_status(setor_id);

-- ---------------- VISIBILIDADE DE COLUNAS POR USUARIO ----------------
-- Usado no Criativo: define quais colunas (tipos de tarefa) o membro ve.
-- Sem linhas para um usuario = ve todas as colunas do seu setor.
CREATE TABLE usuario_colunas (
  usuario_id INT NOT NULL REFERENCES usuarios(id)       ON DELETE CASCADE,
  coluna_id  INT NOT NULL REFERENCES colunas_status(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, coluna_id)
);

-- ---------------- CLIENTES ----------------
CREATE TABLE clientes (
  id           SERIAL PRIMARY KEY,
  empresa      TEXT NOT NULL,
  razao_social TEXT,
  cnpj         TEXT,
  nicho        TEXT,
  tamanho      TEXT,
  logo_path    TEXT,
  cep          TEXT,
  endereco     TEXT,
  complemento  TEXT,
  cidade       TEXT,
  estado       TEXT,
  contato      TEXT,
  telefone     TEXT,
  email        TEXT,
  site         TEXT,
  instagram    TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- TAREFAS ----------------
CREATE TABLE tarefas (
  id              SERIAL PRIMARY KEY,
  titulo          TEXT NOT NULL,
  descricao       TEXT DEFAULT '',
  setor_id        INT  NOT NULL REFERENCES setores(id),
  coluna_id       INT  NOT NULL REFERENCES colunas_status(id),
  cliente_id      INT  REFERENCES clientes(id) ON DELETE SET NULL,
  prioridade      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  data_inicio     DATE,
  data_entrega    DATE,
  data_publicacao DATE,
  criado_por      INT REFERENCES usuarios(id),
  concluida_em    TIMESTAMPTZ,
  andamento_inicio TIMESTAMPTZ,                 -- cronometro: 1a saida p/ coluna de trabalho
  retrabalho_design INT NOT NULL DEFAULT 0,     -- contadores de retrabalho (Criativo)
  retrabalho_edicao INT NOT NULL DEFAULT 0,
  retrabalho_pdf    INT NOT NULL DEFAULT 0,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Recorrencia: a tarefa "cabeca" da serie guarda a frequencia. Ao concluir
  -- (ou ao passar da entrega), o sistema cria a proxima ocorrencia e anota o
  -- id dela em recorrencia_gerou_id. Esse campo e o que impede gerar duas
  -- vezes a mesma ocorrencia.
  recorrencia        TEXT CHECK (recorrencia IN ('diaria','semanal','quinzenal','mensal')),
  recorrencia_ate    DATE,   -- limite opcional da serie
  recorrencia_origem_id INT, -- de qual tarefa esta veio
  recorrencia_gerou_id  INT  -- qual tarefa esta ja gerou
);
CREATE INDEX idx_tarefas_setor  ON tarefas(setor_id);
CREATE INDEX idx_tarefas_coluna ON tarefas(coluna_id);
CREATE INDEX idx_tarefas_recorrencia ON tarefas(recorrencia) WHERE recorrencia IS NOT NULL;

-- ---------------- RESPONSAVEIS (N:N) ----------------
CREATE TABLE tarefa_responsaveis (
  tarefa_id  INT NOT NULL REFERENCES tarefas(id)  ON DELETE CASCADE,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (tarefa_id, usuario_id)
);

-- ---------------- ANEXOS ----------------
CREATE TABLE anexos (
  id            SERIAL PRIMARY KEY,
  tarefa_id     INT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL,
  nome_arquivo  TEXT NOT NULL,   -- nome no disco/storage
  mime          TEXT,
  tamanho       BIGINT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anexos_tarefa ON anexos(tarefa_id);

-- ---------------- COMENTARIOS (fase futura) ----------------
CREATE TABLE comentarios (
  id         SERIAL PRIMARY KEY,
  tarefa_id  INT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  texto      TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comentarios_tarefa ON comentarios(tarefa_id);

-- ---------------- NOTIFICACOES (destino: admins/atendimento) ----------------
CREATE TABLE notificacoes (
  id         SERIAL PRIMARY KEY,
  tipo       TEXT NOT NULL DEFAULT 'tarefa_concluida',
  titulo     TEXT NOT NULL,
  mensagem   TEXT DEFAULT '',
  tarefa_id  INT REFERENCES tarefas(id) ON DELETE SET NULL,
  setor_id   INT REFERENCES setores(id) ON DELETE SET NULL,  -- escopo do sino (NULL = global)
  prioridade TEXT,                                            -- ex.: 'urgente'
  lida       BOOLEAN NOT NULL DEFAULT false,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_lida  ON notificacoes(lida);
CREATE INDEX idx_notif_setor ON notificacoes(setor_id);

-- ---------------- HISTORICO (trilha de auditoria das tarefas) ----------------
-- Sem FKs de proposito: o historico sobrevive a exclusao de tarefas/usuarios.
-- Trilha de auditoria. Gravada SEMPRE pelo backend (o navegador nunca
-- escreve aqui). Guarda o que houve, com quem, quando, de qual IP e
-- navegador. Sem chave estrangeira de proposito: o registro sobrevive a
-- exclusao da tarefa/cliente/usuario que ele descreve.
CREATE TABLE historico (
  id           SERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL,           -- criada | editada | movida | concluida | excluida | login | login_falha | login_bloqueio | logout
  entidade     TEXT NOT NULL DEFAULT 'tarefa', -- tarefa | cliente | usuario | setor | sessao
  entidade_id  INT,
  tarefa_id    INT,
  titulo       TEXT DEFAULT '',
  setor_id     INT,
  usuario_id   INT,
  usuario_nome TEXT DEFAULT '',
  detalhe      TEXT DEFAULT '',
  cliente_id   INT,
  cliente_nome TEXT DEFAULT '',
  responsaveis JSONB DEFAULT '[]',
  ip           TEXT DEFAULT '',
  user_agent   TEXT DEFAULT '',
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_historico_setor    ON historico(setor_id);
CREATE INDEX idx_historico_criado   ON historico(criado_em DESC);
CREATE INDEX idx_historico_entidade ON historico(entidade);
CREATE INDEX idx_historico_usuario  ON historico(usuario_id);

-- Bloqueio temporario de login (por IP e por conta). Fica no banco para
-- sobreviver a restart e valer para todas as instancias da API.
CREATE TABLE login_bloqueio (
  chave  TEXT PRIMARY KEY,          -- 'ip:1.2.3.4' ou 'conta:fulano'
  falhas INT NOT NULL DEFAULT 0,
  ate    TIMESTAMPTZ,               -- ate quando esta travado (null = so contando)
  visto  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_bloqueio_visto ON login_bloqueio(visto);

COMMIT;
