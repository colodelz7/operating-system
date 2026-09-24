'use strict';

/**
 * Armazenamento POSTGRES. Mesma interface do memoryRepo.
 * Usado quando DATABASE_URL esta configurado.
 *
 * Antes de usar: rode db/schema.sql e db/seed.sql no seu banco.
 */

const pg = require('pg');
const { Pool } = pg;
const config = require('../config');

// Colunas DATE (oid 1082) chegam como texto 'AAAA-MM-DD', do mesmo jeito que
// o repositorio em memoria devolve. Sem isto o driver monta um Date e o JSON
// vira '2026-09-07T00:00:00.000Z', que ja tem fuso e nao entra num
// <input type="date">. Datas de calendario nao tem hora nem fuso.
pg.types.setTypeParser(1082, (valor) => valor);

const pool = new Pool({ connectionString: config.databaseUrl });

const q = (text, params) => pool.query(text, params);

// contadores de retrabalho: mapeia o nome da coluna para o campo correspondente
function ehRetrabalho(nome) {
  const n = (nome || '').toLowerCase();
  if (!/retrabalho/.test(n)) return null;
  if (/design/.test(n)) return 'design';
  if (/edi/.test(n)) return 'edicao';
  if (/pdf/.test(n)) return 'pdf';
  return null;
}

// id da primeira coluna (menor ordem) de um setor
async function primeiraColunaId(setorId) {
  const r = await q('SELECT id FROM colunas_status WHERE setor_id = $1 ORDER BY ordem LIMIT 1', [setorId]);
  return r.rows[0] ? r.rows[0].id : null;
}

// Power-up de urgencia (Criativo): tarefa que vence HOJE vira urgente e vai p/ "Pra hoje".
// Idempotente: o UPDATE so retorna as tarefas que realmente mudaram, e a notificacao
// e criada no maximo 1x por tarefa por dia.
async function sweepUrgencia() {
  const movidas = await q(`
    WITH crv AS (
      SELECT ph.id AS pra_hoje_id, s.id AS setor_id
        FROM setores s
        JOIN colunas_status ph ON ph.setor_id = s.id AND ph.nome = 'Pra hoje'
       WHERE s.slug = 'criativo'
    )
    UPDATE tarefas t
       SET prioridade = 'urgente', coluna_id = crv.pra_hoje_id
      FROM crv
     WHERE t.setor_id = crv.setor_id
       AND t.concluida_em IS NULL
       AND t.data_entrega = CURRENT_DATE
       AND (t.prioridade <> 'urgente' OR t.coluna_id <> crv.pra_hoje_id)
    RETURNING t.id, t.titulo, t.setor_id
  `);
  for (const t of movidas.rows) {
    await q(`
      INSERT INTO notificacoes (tipo, prioridade, setor_id, tarefa_id, titulo, mensagem)
      SELECT 'urgente', 'urgente', $1, $2, 'Urgente hoje · Criativo',
             '"' || $3 || '" vence hoje e foi movida para "Pra hoje".'
       WHERE NOT EXISTS (
         SELECT 1 FROM notificacoes n
          WHERE n.tarefa_id = $2 AND n.tipo = 'urgente'
            AND n.criado_em::date = CURRENT_DATE
       )
    `, [t.setor_id, t.id, t.titulo]);
  }
}

// SELECT que ja monta a tarefa com coluna, cliente, responsaveis e flag de atraso
const TAREFA_SELECT = `
  SELECT t.*,
         col.nome  AS coluna_nome,
         col.e_conclusao AS coluna_conclusao,
         setr.nome AS setor_nome,
         cli.empresa AS cliente_nome,
         COALESCE(
           (SELECT json_agg(json_build_object('id', u.id, 'nome', u.nome, 'usuario', u.usuario))
              FROM tarefa_responsaveis tr JOIN usuarios u ON u.id = tr.usuario_id
             WHERE tr.tarefa_id = t.id), '[]'
         ) AS responsaveis,
         COALESCE(
           (SELECT json_agg(json_build_object('id', a.id, 'nome_original', a.nome_original,
                                               'mime', a.mime, 'tamanho', a.tamanho))
              FROM anexos a WHERE a.tarefa_id = t.id), '[]'
         ) AS anexos,
         (t.concluida_em IS NULL AND col.e_conclusao = false
           AND t.data_entrega IS NOT NULL AND t.data_entrega < CURRENT_DATE) AS atrasada,
         (t.concluida_em IS NOT NULL
           AND t.concluida_em < now() - INTERVAL '7 days') AS arquivada,
         (SELECT count(*)::int FROM comentarios cm WHERE cm.tarefa_id = t.id) AS comentarios,
         CASE WHEN t.andamento_inicio IS NULL THEN 0
              ELSE (EXTRACT(EPOCH FROM (COALESCE(t.concluida_em, now()) - t.andamento_inicio)) * 1000)::double precision
         END AS tempo_ms
    FROM tarefas t
    JOIN colunas_status col ON col.id = t.coluna_id
    JOIN setores setr ON setr.id = t.setor_id
    LEFT JOIN clientes cli ON cli.id = t.cliente_id
`;

async function setResponsaveis(tarefaId, ids) {
  await q('DELETE FROM tarefa_responsaveis WHERE tarefa_id = $1', [tarefaId]);
  for (const uid of (ids || [])) {
    await q('INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tarefaId, uid]);
  }
}

// visibilidade de colunas por usuario (Criativo). ids vazio/null = ve todas.
async function setColunasVisiveis(usuarioId, ids) {
  await q('DELETE FROM usuario_colunas WHERE usuario_id = $1', [usuarioId]);
  for (const cid of (Array.isArray(ids) ? ids : [])) {
    await q('INSERT INTO usuario_colunas (usuario_id, coluna_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [usuarioId, cid]);
  }
}

module.exports = {
  modo: 'postgres',

  async init() {
    await pool.query('SELECT 1'); // valida conexao no boot
  },

  // ---------------- USUARIOS ----------------
  async buscarUsuarioPorLogin(usuario) {
    const r = await q('SELECT * FROM usuarios WHERE usuario = $1', [String(usuario).toLowerCase().trim()]);
    return r.rows[0] || null;
  },
  async buscarUsuarioPorId(id) {
    const r = await q(
      `SELECT u.id, u.nome, u.usuario, u.papel, u.setor_id, u.ativo, u.pode_clientes,
              u.senha_versao, s.slug AS setor_slug, s.nome AS setor_nome
         FROM usuarios u JOIN setores s ON s.id = u.setor_id
        WHERE u.id = $1`, [id]);
    return r.rows[0] || null;
  },
  async listarUsuariosDoSetor(setorId) {
    const r = await q('SELECT id, nome, usuario FROM usuarios WHERE setor_id = $1 AND ativo ORDER BY nome', [setorId]);
    return r.rows;
  },

  // ---- gerenciamento (admin) ----
  async buscarUsuarioPublico(id) {
    const r = await q(
      `SELECT u.id, u.nome, u.usuario, u.papel, u.setor_id, u.ativo, u.pode_clientes,
              s.slug AS setor_slug, s.nome AS setor_nome,
              COALESCE((SELECT json_agg(uc.coluna_id)
                          FROM usuario_colunas uc WHERE uc.usuario_id = u.id), '[]') AS colunas_visiveis
         FROM usuarios u JOIN setores s ON s.id = u.setor_id
        WHERE u.id = $1`, [id]);
    const row = r.rows[0];
    if (!row) return null;
    row.colunas_visiveis = (row.colunas_visiveis && row.colunas_visiveis.length) ? row.colunas_visiveis : null;
    return row;
  },
  async listarUsuarios() {
    const r = await q(
      `SELECT u.id, u.nome, u.usuario, u.papel, u.setor_id, u.ativo, u.pode_clientes,
              s.slug AS setor_slug, s.nome AS setor_nome,
              COALESCE((SELECT json_agg(uc.coluna_id)
                          FROM usuario_colunas uc WHERE uc.usuario_id = u.id), '[]') AS colunas_visiveis
         FROM usuarios u JOIN setores s ON s.id = u.setor_id
        ORDER BY u.nome`);
    return r.rows.map((row) => ({
      ...row,
      colunas_visiveis: (row.colunas_visiveis && row.colunas_visiveis.length) ? row.colunas_visiveis : null,
    }));
  },
  async contarAdmins() {
    const r = await q("SELECT count(*)::int AS n FROM usuarios WHERE papel = 'admin' AND ativo");
    return r.rows[0].n;
  },
  async criarUsuario(d) {
    const r = await q(
      `INSERT INTO usuarios (nome, usuario, senha_hash, setor_id, papel, ativo, pode_clientes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.nome, d.usuario, d.senha_hash, d.setor_id, d.papel,
       d.ativo !== false, !!d.pode_clientes]);
    const id = r.rows[0].id;
    await setColunasVisiveis(id, d.colunas_visiveis);
    return this.buscarUsuarioPublico(id);
  },
  async atualizarUsuario(id, d) {
    const cols = ['nome', 'usuario', 'senha_hash', 'setor_id', 'papel', 'ativo', 'pode_clientes'];
    const presentes = cols.filter((c) => c in d && !(c === 'senha_hash' && !d[c]));
    if (presentes.length) {
      const set = presentes.map((c, i) => `${c} = $${i + 1}`).join(',');
      // senha nova, versao nova: quem estava logado com a antiga cai
      const extra = presentes.includes('senha_hash') ? ', senha_versao = senha_versao + 1' : '';
      const vals = presentes.map((c) => d[c]);
      vals.push(id);
      await q(`UPDATE usuarios SET ${set}${extra} WHERE id = ${vals.length}`, vals);
    }
    if ('colunas_visiveis' in d) await setColunasVisiveis(id, d.colunas_visiveis);
    return this.buscarUsuarioPublico(id);
  },
  async excluirUsuario(id) {
    // preserva historico/tarefas: desvincula em vez de bloquear a exclusao
    await q('UPDATE tarefas SET criado_por = NULL WHERE criado_por = $1', [id]);
    await q('DELETE FROM comentarios WHERE usuario_id = $1', [id]);
    const r = await q('DELETE FROM usuarios WHERE id = $1', [id]); // cascata em usuario_colunas e tarefa_responsaveis
    return r.rowCount > 0;
  },

  // ---------------- SETORES / COLUNAS ----------------
  async listarSetores() {
    const r = await q('SELECT id, slug, nome, ordem, cor FROM setores ORDER BY ordem');
    return r.rows;
  },
  async buscarSetorPorSlug(slug) {
    const r = await q('SELECT id, slug, nome, ordem, cor FROM setores WHERE slug = $1', [slug]);
    return r.rows[0] || null;
  },
  async listarColunas(setorId, usuario) {
    const r = await q('SELECT * FROM colunas_status WHERE setor_id = $1 ORDER BY ordem', [setorId]);
    let cols = r.rows;
    if (usuario && usuario.papel !== 'admin') {
      const vr = await q('SELECT coluna_id FROM usuario_colunas WHERE usuario_id = $1', [usuario.id]);
      if (vr.rows.length) {
        const ids = new Set(vr.rows.map((x) => x.coluna_id));
        cols = cols.filter((c) => ids.has(c.id));
      }
    }
    return cols;
  },

  // ---------------- CLIENTES ----------------
  async listarClientes() {
    const r = await q('SELECT * FROM clientes ORDER BY empresa');
    return r.rows;
  },
  async buscarCliente(id) {
    const r = await q('SELECT * FROM clientes WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  async criarCliente(d) {
    const cols = ['empresa','razao_social','cnpj','nicho','tamanho','logo_path','cep',
                  'endereco','complemento','cidade','estado','contato','telefone','email','site','instagram'];
    const vals = cols.map((c) => d[c] ?? null);
    const ph = cols.map((_, i) => `$${i + 1}`).join(',');
    const r = await q(`INSERT INTO clientes (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
    return r.rows[0];
  },
  async atualizarCliente(id, d) {
    const cols = ['empresa','razao_social','cnpj','nicho','tamanho','logo_path','cep',
                  'endereco','complemento','cidade','estado','contato','telefone','email','site','instagram'];
    const presentes = cols.filter((c) => c in d);
    if (!presentes.length) return this.buscarCliente(id);
    const set = presentes.map((c, i) => `${c} = $${i + 1}`).join(',');
    const vals = presentes.map((c) => d[c]);
    vals.push(id);
    const r = await q(`UPDATE clientes SET ${set} WHERE id = $${vals.length} RETURNING *`, vals);
    return r.rows[0] || null;
  },
  async excluirCliente(id) {
    const r = await q('DELETE FROM clientes WHERE id = $1', [id]);
    return r.rowCount > 0;
  },

  // ---------------- TAREFAS ----------------
  async listarTarefasPorSetor(setorId, { incluirArquivadas = false } = {}) {
    await sweepUrgencia();
    const filtroArq = incluirArquivadas ? ''
      : ` AND NOT (t.concluida_em IS NOT NULL AND t.concluida_em < now() - INTERVAL '7 days')`;
    const r = await q(`${TAREFA_SELECT} WHERE t.setor_id = $1${filtroArq} ORDER BY t.id`, [setorId]);
    return r.rows;
  },
  async listarTodasTarefas({ incluirArquivadas = false } = {}) {
    await sweepUrgencia();
    const filtroArq = incluirArquivadas ? ''
      : ` WHERE NOT (t.concluida_em IS NOT NULL AND t.concluida_em < now() - INTERVAL '7 days')`;
    const r = await q(`${TAREFA_SELECT}${filtroArq} ORDER BY t.id`);
    return r.rows;
  },
  async buscarTarefa(id) {
    const r = await q(`${TAREFA_SELECT} WHERE t.id = $1`, [id]);
    return r.rows[0] || null;
  },
  async criarTarefa(d) {
    // se a tarefa ja nasce numa coluna de trabalho (nao a primeira, nao conclusao),
    // inicia o cronometro; e se nasce numa coluna de retrabalho, ja conta 1.
    const primeiraId = await primeiraColunaId(d.setor_id);
    const cr = await q('SELECT nome, e_conclusao FROM colunas_status WHERE id = $1', [d.coluna_id]);
    const col = cr.rows[0] || {};
    const emTrabalho = primeiraId && d.coluna_id !== primeiraId && !col.e_conclusao;
    let andamentoInicio = null;
    const retr = { design: 0, edicao: 0, pdf: 0 };
    if (emTrabalho) {
      andamentoInicio = new Date();
      const rt = ehRetrabalho(col.nome);
      if (rt) retr[rt] = 1;
    }
    // nasceu direto numa coluna de conclusao: ja entra concluida (mesma regra
    // do repositorio em memoria)
    const concluidaEm = col.e_conclusao ? new Date() : null;
    const r = await q(
      `INSERT INTO tarefas (titulo, descricao, setor_id, coluna_id, cliente_id, prioridade,
                            data_inicio, data_entrega, data_publicacao, criado_por,
                            andamento_inicio, concluida_em, retrabalho_design, retrabalho_edicao, retrabalho_pdf,
                            recorrencia, recorrencia_ate, recorrencia_origem_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [d.titulo, d.descricao || '', d.setor_id, d.coluna_id, d.cliente_id || null,
       d.prioridade || 'normal', d.data_inicio || null, d.data_entrega || null,
       d.data_publicacao || null, d.criado_por,
       andamentoInicio, concluidaEm, retr.design, retr.edicao, retr.pdf,
       d.recorrencia || null, d.recorrencia_ate || null, d.recorrencia_origem_id || null]);
    const id = r.rows[0].id;
    await setResponsaveis(id, d.responsaveis);
    return this.buscarTarefa(id);
  },
  async atualizarTarefa(id, d) {
    const cols = ['titulo','descricao','cliente_id','prioridade','data_inicio','data_entrega','data_publicacao',
                  'recorrencia','recorrencia_ate'];
    const presentes = cols.filter((c) => c in d);
    if (presentes.length) {
      const set = presentes.map((c, i) => `${c} = $${i + 1}`).join(',');
      const vals = presentes.map((c) => d[c]);
      vals.push(id);
      await q(`UPDATE tarefas SET ${set} WHERE id = $${vals.length}`, vals);
    }
    if (Array.isArray(d.responsaveis)) await setResponsaveis(id, d.responsaveis);
    return this.buscarTarefa(id);
  },
  async moverTarefa(id, colunaId) {
    const tr = await q('SELECT setor_id, concluida_em, andamento_inicio FROM tarefas WHERE id = $1', [id]);
    if (!tr.rows[0]) return null;
    const cr = await q('SELECT setor_id, nome, e_conclusao FROM colunas_status WHERE id = $1', [colunaId]);
    const col = cr.rows[0];
    if (!col || col.setor_id !== tr.rows[0].setor_id) return null;

    const primeiraId = await primeiraColunaId(tr.rows[0].setor_id);

    // cronometro: primeira saida da coluna inicial para uma coluna de trabalho
    let andamentoInicio = tr.rows[0].andamento_inicio;
    const iniciaTrabalho = primeiraId && colunaId !== primeiraId && !col.e_conclusao;
    if (iniciaTrabalho && !andamentoInicio) andamentoInicio = new Date();

    // conclusao
    let concluiuAgora = false;
    let concluida_em = tr.rows[0].concluida_em;
    if (col.e_conclusao && !concluida_em) { concluida_em = new Date(); concluiuAgora = true; }
    else if (!col.e_conclusao) { concluida_em = null; }

    // contador de retrabalho: incrementa ao ENTRAR numa coluna de retrabalho.
    // rt vem de um conjunto fixo (design/edicao/pdf), nao de entrada do usuario.
    const rt = ehRetrabalho(col.nome);
    const setRetr = rt ? `, retrabalho_${rt} = retrabalho_${rt} + 1` : '';

    await q(
      `UPDATE tarefas
          SET coluna_id = $1, concluida_em = $2, andamento_inicio = $3${setRetr}
        WHERE id = $4`,
      [colunaId, concluida_em, andamentoInicio, id]);
    return { tarefa: await this.buscarTarefa(id), concluiuAgora };
  },
  async excluirTarefa(id) {
    const r = await q('DELETE FROM tarefas WHERE id = $1', [id]);
    return r.rowCount > 0;
  },

  // ---------------- BLOQUEIO DE LOGIN ----------------
  // No Postgres o bloqueio sobrevive a restart e vale para todas as
  // instancias da API (em memoria, cada processo tinha a sua contagem).
  async lerBloqueio(chave) {
    const r = await q('SELECT falhas, ate, visto FROM login_bloqueio WHERE chave = $1', [chave]);
    const row = r.rows[0];
    if (!row) return null;
    return {
      falhas: row.falhas,
      ate: row.ate ? new Date(row.ate).getTime() : null,
      visto: new Date(row.visto).getTime(),
    };
  },
  async salvarBloqueio(chave, dados) {
    await q(
      `INSERT INTO login_bloqueio (chave, falhas, ate, visto)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chave) DO UPDATE SET falhas = $2, ate = $3, visto = $4`,
      [chave, dados.falhas, dados.ate ? new Date(dados.ate) : null,
       new Date(dados.visto || Date.now())]);
    return true;
  },
  async limparBloqueios(chaves) {
    if (!chaves || !chaves.length) return true;
    await q('DELETE FROM login_bloqueio WHERE chave = ANY($1)', [chaves]);
    return true;
  },
  async limparBloqueiosVelhos(antesDe) {
    await q('DELETE FROM login_bloqueio WHERE (ate IS NOT NULL AND ate <= now()) OR (ate IS NULL AND visto < $1)',
      [new Date(antesDe)]);
    return true;
  },

  // ---------------- COMENTARIOS ----------------
  async listarComentarios(tarefaId) {
    const r = await q(
      `SELECT c.id, c.tarefa_id, c.usuario_id, c.texto, c.criado_em,
              COALESCE(u.nome, 'Usuário removido') AS usuario_nome
         FROM comentarios c LEFT JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.tarefa_id = $1
        ORDER BY c.id`, [tarefaId]);
    return r.rows;
  },
  async criarComentario(d) {
    const r = await q(
      'INSERT INTO comentarios (tarefa_id, usuario_id, texto) VALUES ($1,$2,$3) RETURNING id',
      [d.tarefa_id, d.usuario_id, d.texto]);
    const rr = await q(
      `SELECT c.id, c.tarefa_id, c.usuario_id, c.texto, c.criado_em, u.nome AS usuario_nome
         FROM comentarios c JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.id = $1`, [r.rows[0].id]);
    return rr.rows[0];
  },
  async buscarComentario(id) {
    const r = await q('SELECT * FROM comentarios WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  async excluirComentario(id) {
    const r = await q('DELETE FROM comentarios WHERE id = $1', [id]);
    return r.rowCount > 0;
  },

  // ---------------- RECORRENCIA ----------------
  // Cabeca da serie = tem frequencia definida e ainda nao gerou a proxima.
  async listarTarefasRecorrentesPendentes() {
    const r = await q(`${TAREFA_SELECT}
      WHERE t.recorrencia IS NOT NULL AND t.recorrencia_gerou_id IS NULL
      ORDER BY t.id`);
    return r.rows;
  },
  async marcarRecorrenciaGerada(id, novaId) {
    const r = await q('UPDATE tarefas SET recorrencia_gerou_id = $1 WHERE id = $2', [novaId, id]);
    return r.rowCount > 0;
  },

  // ---------------- ANEXOS ----------------
  async criarAnexo(d) {
    const r = await q(
      `INSERT INTO anexos (tarefa_id, nome_original, nome_arquivo, mime, tamanho)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.tarefa_id, d.nome_original, d.nome_arquivo, d.mime, d.tamanho]);
    return r.rows[0];
  },
  async buscarAnexo(id) {
    const r = await q('SELECT * FROM anexos WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  // ---------------- HISTORICO (trilha de auditoria) ----------------
  async registrarHistorico(d) {
    const r = await q(
      `INSERT INTO historico (tipo, entidade, entidade_id, tarefa_id, titulo, setor_id,
                              usuario_id, usuario_nome, detalhe, cliente_id, cliente_nome,
                              responsaveis, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [d.tipo, d.entidade || 'tarefa', d.entidade_id != null ? d.entidade_id : (d.tarefa_id || null),
       d.tarefa_id || null, d.titulo || '', d.setor_id || null,
       d.usuario_id || null, d.usuario_nome || '', d.detalhe || '',
       d.cliente_id || null, d.cliente_nome || '',
       JSON.stringify(Array.isArray(d.responsaveis) ? d.responsaveis : []),
       d.ip || '', d.user_agent || '']);
    return r.rows[0];
  },
  // Mesmos filtros do memoryRepo (paridade): setorId, entidade, tipo,
  // usuarioId, de/ate (YYYY-MM-DD), q (busca livre) e limit.
  async listarHistorico(filtros = {}) {
    const { limit = 300, setorId = null, entidade = null, tipo = null,
            usuarioId = null, de = null, ate = null, q: busca = null, antesDe = null } = filtros;
    const cond = [];
    const params = [];
    const add = (sql, valor) => { params.push(valor); cond.push(sql.replace('$?', '$' + params.length)); };

    if (antesDe != null)  add('id < $?', Number(antesDe)); // cursor da pagina seguinte
    if (setorId != null)  add('setor_id = $?', Number(setorId));
    if (entidade)         add('entidade = $?', entidade);
    if (tipo)             add('tipo = $?', tipo);
    if (usuarioId != null) add('usuario_id = $?', Number(usuarioId));
    if (de)               add('criado_em >= $?::date', de);
    if (ate)              add('criado_em < ($?::date + 1)', ate);
    if (busca) {
      params.push('%' + String(busca).toLowerCase() + '%');
      const i = '$' + params.length;
      cond.push(`(lower(titulo) LIKE ${i} OR lower(usuario_nome) LIKE ${i}
                  OR lower(cliente_nome) LIKE ${i} OR lower(detalhe) LIKE ${i}
                  OR lower(ip) LIKE ${i})`);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    params.push(Math.min(Number(limit) || 300, 2000));
    // atencao: LIMIT usa placeholder ($N), nunca o numero interpolado direto
    const r = await q(`SELECT * FROM historico ${where} ORDER BY id DESC LIMIT $${params.length}`, params);
    return r.rows;
  },
  // Valores distintos para montar os seletores da tela sem depender da
  // pagina carregada.
  async opcoesHistorico() {
    const r = await q(`
      SELECT
        (SELECT COALESCE(json_agg(DISTINCT usuario_nome ORDER BY usuario_nome), '[]')
           FROM historico WHERE usuario_nome <> '') AS pessoas,
        (SELECT COALESCE(json_agg(DISTINCT cliente_nome ORDER BY cliente_nome), '[]')
           FROM historico WHERE cliente_nome <> '') AS clientes,
        (SELECT COALESCE(json_agg(DISTINCT setor_id ORDER BY setor_id), '[]')
           FROM historico WHERE setor_id IS NOT NULL) AS setores,
        (SELECT COALESCE(json_agg(DISTINCT entidade ORDER BY entidade), '[]') FROM historico) AS entidades,
        (SELECT COALESCE(json_agg(DISTINCT tipo ORDER BY tipo), '[]') FROM historico) AS tipos,
        (SELECT count(*)::int FROM historico) AS total
    `);
    return r.rows[0];
  },

  // ---------------- NOTIFICACOES ----------------
  async criarNotificacao(d) {
    const r = await q(
      `INSERT INTO notificacoes (tipo, titulo, mensagem, tarefa_id, setor_id, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.tipo || 'tarefa_concluida', d.titulo, d.mensagem || '',
       d.tarefa_id || null, d.setor_id || null, d.prioridade || null]);
    return r.rows[0];
  },
  async listarNotificacoes({ apenasNaoLidas = false, setorId = null } = {}) {
    const cond = [];
    const params = [];
    if (setorId != null) {
      params.push(setorId);
      cond.push(`(setor_id = $${params.length} OR setor_id IS NULL)`);
    }
    if (apenasNaoLidas) cond.push('lida = false');
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const r = await q(`SELECT * FROM notificacoes ${where} ORDER BY id DESC`, params);
    return r.rows;
  },
  async marcarNotificacaoLida(id) {
    const r = await q('UPDATE notificacoes SET lida = true WHERE id = $1', [id]);
    return r.rowCount > 0;
  },
  async marcarTodasNotificacoesLidas(setorId = null) {
    if (setorId != null) {
      await q('UPDATE notificacoes SET lida = true WHERE lida = false AND (setor_id = $1 OR setor_id IS NULL)', [setorId]);
    } else {
      await q('UPDATE notificacoes SET lida = true WHERE lida = false');
    }
    return true;
  },
};