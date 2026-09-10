-- ============================================================
--  Colodel :: Sistema Operacional  ::  SEED (PostgreSQL)
-- ============================================================
--  Rode DEPOIS do schema.sql:
--    psql "$DATABASE_URL" -f db/schema.sql
--    psql "$DATABASE_URL" -f db/seed.sql
--
--  Este seed espelha data/seedData.js (fonte da verdade do modo
--  em memoria). Mantenha os dois em sincronia.
--
--  Senha padrao de todos os usuarios de exemplo: colodel
--  (hash bcrypt abaixo). TROQUE as senhas depois de subir.
-- ------------------------------------------------------------

BEGIN;

-- Limpa (CASCADE cuida das tabelas dependentes: usuario_colunas,
-- tarefa_responsaveis, comentarios, anexos, notificacoes).
TRUNCATE historico, notificacoes, comentarios, anexos, tarefa_responsaveis,
         usuario_colunas, tarefas, colunas_status, clientes, usuarios, setores
         RESTART IDENTITY CASCADE;

-- ---------------- SETORES ----------------
-- 5 setores (sem "Geral"). Mesma ordem/cores do seedData.js.
INSERT INTO setores (slug, nome, ordem, cor) VALUES
  ('atendimento',     'Atendimento',     1, '#120a8f'),
  ('comercial',       'Comercial',       2, '#009fe3'),
  ('criativo',        'Criativo',        3, '#6a5cff'),
  ('trafego',         'Tráfego Pago',    4, '#00b2a9'),
  ('desenvolvimento', 'Desenvolvimento', 5, '#3b2fb0');

-- ---------------- USUARIOS ----------------
-- hash de 'colodel'
INSERT INTO usuarios (nome, usuario, senha_hash, setor_id, papel) VALUES
  -- ATENDIMENTO (papel admin: ve todos os setores e gerencia o sistema)
  ('Administrador', 'admin',   '$2a$10$iRBxMBMSduR9LSFmBTpjL.JbOsjwyJK7f3IN8TH6rkO4SHtS7iGv.', 1, 'admin'),
  ('Colodel',       'colodel', '$2a$10$iRBxMBMSduR9LSFmBTpjL.JbOsjwyJK7f3IN8TH6rkO4SHtS7iGv.', 1, 'admin'),
  -- CRIATIVO (membro: enxerga apenas o proprio setor)
  ('Morning',       'morning', '$2a$10$iRBxMBMSduR9LSFmBTpjL.JbOsjwyJK7f3IN8TH6rkO4SHtS7iGv.', 3, 'membro');

-- ---------------- COLUNAS POR SETOR ----------------
-- Atendimento, Comercial, Trafego, Desenvolvimento: fluxo padrao (3 colunas)
INSERT INTO colunas_status (setor_id, nome, ordem, e_conclusao)
SELECT s.id, c.nome, c.ordem, c.e_conclusao
FROM setores s
CROSS JOIN LATERAL (VALUES
  ('Pendente', 1, false),
  ('Em andamento', 2, false),
  ('Concluído', 3, true)
) AS c(nome, ordem, e_conclusao)
WHERE s.slug IN ('atendimento','comercial','trafego','desenvolvimento');

-- Criativo: fluxo completo (13 colunas). Conclusao = "Finalizados".
INSERT INTO colunas_status (setor_id, nome, ordem, e_conclusao)
SELECT s.id, c.nome, c.ordem, c.e_conclusao
FROM setores s
CROSS JOIN LATERAL (VALUES
  ('Pendente',           1,  false),
  ('Até 2 dias',         2,  false),
  ('Pra hoje',           3,  false),
  ('Fazer PDF',          4,  false),
  ('Aprovação',          5,  false),
  ('Programar',          6,  false),
  ('Finalizados',        7,  true),
  ('Referências',        8,  false),
  ('Planejamento',       9,  false),
  ('Roteiros',           10, false),
  ('Retrabalho Design',  11, false),
  ('Retrabalho Edição',  12, false),
  ('Retrabalho PDF',     13, false)
) AS c(nome, ordem, e_conclusao)
WHERE s.slug = 'criativo';

-- ---------------- VISIBILIDADE DE COLUNAS (Criativo) ----------------
-- Vazio = ve todas as colunas do setor. usuario05 nao aparece aqui (ve tudo).
-- usuario07: fluxo sem PDF/Programar.
-- Visibilidade de colunas por usuario (Criativo): ninguem restrito no seed.
-- Para restringir, insira em usuario_colunas os ids de coluna liberados.

-- ---------------- CLIENTES ----------------
INSERT INTO clientes (empresa, razao_social, cnpj, nicho, tamanho, cep, endereco, complemento, cidade, estado, contato, telefone, email, site, instagram) VALUES
  ('Cliente Exemplo A', 'Cliente Exemplo A LTDA', '00.000.000/0001-00', 'Moda', 'Pequena', '00000-000', 'Rua Exemplo, 100', 'Sala 3', 'Curitiba', 'PR', 'Contato Exemplo', '(41) 00000-0000', 'contato@clienteexemploa.com.br', 'clienteexemploa.com.br', '@clienteexemploa'),
  ('Cliente Exemplo B', 'Cliente Exemplo B LTDA', '00.000.000/0002-00', 'Telecomunicações', 'Média', '00000-000', 'Av. Exemplo, 2500', '', 'Curitiba', 'PR', 'Contato Exemplo', '(41) 00000-0001', 'contato@clienteexemplob.com.br', 'clienteexemplob.com.br', '@clienteexemplob');

-- ---------------- TAREFAS DE EXEMPLO ----------------
-- Cliente Exemplo A - 2 estaticos (Criativo / Pendente)
INSERT INTO tarefas (titulo, descricao, setor_id, coluna_id, cliente_id, prioridade, data_entrega, criado_por)
SELECT 'Cliente Exemplo A: 2 estáticos',
       'Desenvolver 2 posts estáticos seguindo o planejamento enviado. Respeitar a estratégia já definida.',
       s.id, col.id, 1, 'normal', CURRENT_DATE + 2, 1
FROM setores s JOIN colunas_status col ON col.setor_id = s.id AND col.nome = 'Pendente'
WHERE s.slug = 'criativo';
INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id)
SELECT currval('tarefas_id_seq'), u.id FROM usuarios u WHERE u.usuario = 'morning';

-- Cliente Exemplo B - Pagina (Desenvolvimento / Em andamento)
INSERT INTO tarefas (titulo, descricao, setor_id, coluna_id, cliente_id, prioridade, data_inicio, data_entrega, data_publicacao, criado_por)
SELECT 'Cliente Exemplo B: Página institucional',
       'Desenvolvimento da nova página com SEO on-page.',
       s.id, col.id, 2, 'alta', CURRENT_DATE - 3, CURRENT_DATE + 1, CURRENT_DATE + 4, 1
FROM setores s JOIN colunas_status col ON col.setor_id = s.id AND col.nome = 'Em andamento'
WHERE s.slug = 'desenvolvimento';
INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id)
SELECT currval('tarefas_id_seq'), u.id FROM usuarios u WHERE u.usuario = 'colodel';

-- Cliente Exemplo A - Trafego (vencida -> atrasada)
INSERT INTO tarefas (titulo, descricao, setor_id, coluna_id, cliente_id, prioridade, data_entrega, criado_por)
SELECT 'Cliente Exemplo A: Campanha de tráfego',
       'Subir campanha de conversão para a coleção de inverno.',
       s.id, col.id, 1, 'normal', CURRENT_DATE - 1, 1
FROM setores s JOIN colunas_status col ON col.setor_id = s.id AND col.nome = 'Pendente'
WHERE s.slug = 'trafego';
INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id)
SELECT currval('tarefas_id_seq'), u.id FROM usuarios u WHERE u.usuario = 'colodel';

COMMIT;