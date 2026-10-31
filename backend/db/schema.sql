-- ============================================================
--  Colodel :: Sistema de Tarefas  ::  SCHEMA (PostgreSQL)
-- ============================================================
--  Uso:
--    createdb colodel_tarefas
--    psql colodel_tarefas -f db/schema.sql
--    psql colodel_tarefas -f db/seed.sql
-- ------------------------------------------------------------

BEGIN;

DROP TABLE IF EXISTS limites_uso         CASCADE;
DROP TABLE IF EXISTS briefing_arquivos   CASCADE;
DROP TABLE IF EXISTS cliente_datas       CASCADE;
DROP TABLE IF EXISTS cliente_servicos    CASCADE;
DROP TABLE IF EXISTS push_inscricoes     CASCADE;
DROP TABLE IF EXISTS acessos             CASCADE;
DROP TABLE IF EXISTS briefings           CASCADE;
DROP TABLE IF EXISTS textos_salvos       CASCADE;
DROP TABLE IF EXISTS chat_mensagens      CASCADE;
DROP TABLE IF EXISTS chat_membros        CASCADE;
DROP TABLE IF EXISTS chat_conversas      CASCADE;
DROP TABLE IF EXISTS evento_participantes CASCADE;
DROP TABLE IF EXISTS eventos             CASCADE;
DROP TABLE IF EXISTS login_bloqueio      CASCADE;
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
  -- Sobe a cada troca de senha. A sessao guarda o valor que valia no login,
  -- entao trocar a senha invalida na hora as sessoes que ja estavam abertas.
  senha_versao INT NOT NULL DEFAULT 0,
  -- desligar alguem sem apagar o historico dela: conta desativada nao entra
  -- e derruba a sessao aberta na requisicao seguinte
  ativo         BOOLEAN NOT NULL DEFAULT true,
  -- pode cadastrar e editar clientes (admin e o Comercial ja podem por regra)
  pode_clientes BOOLEAN NOT NULL DEFAULT false,
  -- foto de perfil (nome do arquivo na pasta de uploads)
  avatar_path   TEXT
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
  prioridade   TEXT DEFAULT '',
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

-- ---------------- LIMITES DE USO (contadores por janela de tempo) ----------------
-- Rate limit do login, do chat, do cofre e do assistente, e a cota de upload
-- por pessoa. No banco (e nao na memoria do processo) para valer entre
-- instancias da API e sobreviver a reinicio.
CREATE TABLE IF NOT EXISTS limites_uso (
  chave       TEXT PRIMARY KEY,
  contador    BIGINT NOT NULL DEFAULT 0,
  reinicia_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_limites_uso_reinicia ON limites_uso(reinicia_em);

-- conversa direta unica por par de pessoas ('menorId:maiorId'); grupo fica NULL
ALTER TABLE chat_conversas ADD COLUMN IF NOT EXISTS chave_direta TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversa_direta ON chat_conversas(chave_direta);

COMMIT;
