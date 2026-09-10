'use strict';

/**
 * Armazenamento EM MEMORIA. Mesma interface do pgRepo.
 */

const bcrypt = require('bcryptjs');
const seed = require('./seedData');

const db = {
  setores:   seed.setores.map((x) => ({ ...x })),
  colunas:   seed.colunas.map((x) => ({ ...x })),
  usuarios:  seed.usuarios.map((x) => ({
    ...x, senha_hash: bcrypt.hashSync(seed.SENHA_PADRAO, 10),
    ativo: x.ativo !== false, pode_clientes: !!x.pode_clientes,
  })),
  clientes:  seed.clientes.map((x) => ({ ...x })),
  tarefas:   seed.tarefas.map((x) => ({
    ...x, responsaveis: [...x.responsaveis],
    andamento_inicio: x.andamento_inicio || null,
    retrabalho_design: 0, retrabalho_edicao: 0, retrabalho_pdf: 0,
  })),
  anexos:    [],
  notificacoes: [],
  comentarios: [],
  historico: [],
  bloqueios: new Map(),
};

const nextId = (arr) => (arr.reduce((m, x) => Math.max(m, x.id), 0) + 1);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- helpers ----------
function setorPublico(s) {
  return { id: s.id, slug: s.slug, nome: s.nome, ordem: s.ordem, cor: s.cor };
}
// Formato publico do usuario (sem senha_hash). colunas_visiveis = ids de coluna
// que o membro enxerga (Criativo); null = ve todas as colunas do setor.
function usuarioPublico(u) {
  const s = db.setores.find((x) => x.id === u.setor_id);
  return {
    id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel,
    setor_id: u.setor_id, setor_slug: s ? s.slug : null, setor_nome: s ? s.nome : null,
    colunas_visiveis: Array.isArray(u.colunas_visiveis) ? u.colunas_visiveis.slice() : null,
    ativo: u.ativo !== false,
    pode_clientes: !!u.pode_clientes,
  };
}
// resolve nomes de coluna -> ids dentro de um setor
function idsDasColunas(setorId, nomes) {
  if (!Array.isArray(nomes)) return null;
  return db.colunas.filter((c) => c.setor_id === setorId && nomes.includes(c.nome)).map((c) => c.id);
}
function colunasDoSetor(setorId) {
  return db.colunas.filter((c) => c.setor_id === setorId).sort((a, b) => a.ordem - b.ordem).map(clone);
}
function primeiraColunaDo(setorId) {
  const cols = db.colunas.filter((c) => c.setor_id === setorId).sort((a, b) => a.ordem - b.ordem);
  return cols[0] || null;
}
function ehRetrabalho(nome) {
  const n = (nome || '').toLowerCase();
  if (!/retrabalho/.test(n)) return null;
  if (/design/.test(n)) return 'design';
  if (/edi/.test(n)) return 'edicao';
  if (/pdf/.test(n)) return 'pdf';
  return null;
}
function isAtrasada(t, colunaEConclusao) {
  if (t.concluida_em) return false;
  if (colunaEConclusao) return false;
  if (!t.data_entrega) return false;
  const hoje = new Date().toISOString().slice(0, 10);
  return t.data_entrega < hoje;
}
function ehArquivada(t) {
  if (!t.concluida_em) return false;
  const dias = (Date.now() - new Date(t.concluida_em).getTime()) / 86400000;
  return dias > 7;
}
function tempoMs(t) {
  if (!t.andamento_inicio) return 0;
  const ini = new Date(t.andamento_inicio).getTime();
  const fim = t.concluida_em ? new Date(t.concluida_em).getTime() : Date.now();
  return Math.max(0, fim - ini);
}

// Semeia a visibilidade de colunas por usuario a partir do mapa (por nome)
// do seedData, convertendo para ids. Assim o admin passa a poder editar isso
// pela tela de gerenciamento, sem perder o comportamento atual.
db.usuarios.forEach((u) => {
  if (!('colunas_visiveis' in u)) {
    const nomes = seed.colunasVisiveisPorUsuario[u.usuario];
    u.colunas_visiveis = nomes ? idsDasColunas(u.setor_id, nomes) : null;
  }
});

// inicializa cronometro das tarefas-semente que ja nascem "em trabalho"
db.tarefas.forEach((t) => {
  const primeira = primeiraColunaDo(t.setor_id);
  const col = db.colunas.find((c) => c.id === t.coluna_id);
  const emTrabalho = col && primeira && col.id !== primeira.id && !col.e_conclusao;
  if (emTrabalho && !t.andamento_inicio) {
    t.andamento_inicio = t.data_inicio ? t.data_inicio + 'T09:00:00.000Z' : new Date().toISOString();
  }
});

function montaTarefa(t) {
  const cliente = t.cliente_id ? db.clientes.find((c) => c.id === t.cliente_id) : null;
  const coluna = db.colunas.find((c) => c.id === t.coluna_id);
  const setor = db.setores.find((s) => s.id === t.setor_id);
  const responsaveis = t.responsaveis
    .map((uid) => db.usuarios.find((u) => u.id === uid)).filter(Boolean)
    .map((u) => ({ id: u.id, nome: u.nome, usuario: u.usuario }));
  const anexos = db.anexos.filter((a) => a.tarefa_id === t.id).map(clone);
  return {
    id: t.id,
    titulo: t.titulo,
    descricao: t.descricao,
    setor_id: t.setor_id,
    setor_nome: setor ? setor.nome : null,
    coluna_id: t.coluna_id,
    coluna_nome: coluna ? coluna.nome : null,
    // o front decide "concluida" por esta flag (nunca pelo nome da coluna):
    // sem ela, kanban, calendario e visao geral tratavam tarefa pronta como
    // pendente no modo em memoria.
    coluna_conclusao: coluna ? !!coluna.e_conclusao : false,
    prioridade: t.prioridade,
    data_inicio: t.data_inicio,
    data_entrega: t.data_entrega,
    data_publicacao: t.data_publicacao,
    cliente_id: t.cliente_id,
    cliente_nome: cliente ? cliente.empresa : null,
    responsaveis,
    anexos,
    concluida_em: t.concluida_em,
    criado_por: t.criado_por,
    atrasada: isAtrasada(t, coluna ? coluna.e_conclusao : false),
    arquivada: ehArquivada(t),
    andamento_inicio: t.andamento_inicio || null,
    tempo_ms: tempoMs(t),
    retrabalho_design: t.retrabalho_design || 0,
    retrabalho_edicao: t.retrabalho_edicao || 0,
    retrabalho_pdf: t.retrabalho_pdf || 0,
    recorrencia: t.recorrencia || null,
    recorrencia_ate: t.recorrencia_ate || null,
    recorrencia_origem_id: t.recorrencia_origem_id || null,
    recorrencia_gerou_id: t.recorrencia_gerou_id || null,
    comentarios: db.comentarios.filter((c) => c.tarefa_id === t.id).length,
  };
}

// Power-up de urgencia (Criativo): tarefa que vence HOJE vira urgente e vai p/ "Pra hoje".
function sweepUrgencia() {
  const hoje = new Date().toISOString().slice(0, 10);
  db.tarefas.forEach((t) => {
    if (t.concluida_em || !t.data_entrega) return;
    const setor = db.setores.find((s) => s.id === t.setor_id);
    if (!setor || setor.slug !== 'criativo') return;
    if (t.data_entrega !== hoje) return;
    const praHoje = db.colunas.find((c) => c.setor_id === t.setor_id && c.nome === 'Pra hoje');
    const jaUrgente = t.prioridade === 'urgente';
    const jaNaColuna = praHoje && t.coluna_id === praHoje.id;
    if (jaUrgente && jaNaColuna) return;
    t.prioridade = 'urgente';
    if (praHoje) t.coluna_id = praHoje.id;
    if (!t._avisoUrgHoje) {
      t._avisoUrgHoje = true;
      db.notificacoes.push({
        id: nextId(db.notificacoes), tipo: 'urgente', prioridade: 'urgente',
        setor_id: t.setor_id, tarefa_id: t.id,
        titulo: 'Urgente hoje · Criativo',
        mensagem: `"${t.titulo}" vence hoje e foi movida para "Pra hoje".`,
        lida: false, criado_em: new Date().toISOString(),
      });
    }
  });
}

// =====================================================================
module.exports = {
  modo: 'memoria',
  async init() {},

  // ---------------- USUARIOS ----------------
  async buscarUsuarioPorLogin(usuario) {
    const u = db.usuarios.find((x) => x.usuario === String(usuario).toLowerCase().trim());
    return u ? clone(u) : null;
  },
  async buscarUsuarioPorId(id) {
    const u = db.usuarios.find((x) => x.id === id);
    if (!u) return null;
    const s = db.setores.find((x) => x.id === u.setor_id);
    return { id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel,
             setor_id: u.setor_id, setor_slug: s ? s.slug : null, setor_nome: s ? s.nome : null,
             ativo: u.ativo !== false, pode_clientes: !!u.pode_clientes };
  },
  async listarUsuariosDoSetor(setorId) {
    return db.usuarios.filter((u) => u.setor_id === setorId && u.ativo !== false)
      .map((u) => ({ id: u.id, nome: u.nome, usuario: u.usuario }));
  },

  // ---- gerenciamento (admin) ----
  async listarUsuarios() {
    return db.usuarios.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map(usuarioPublico);
  },
  async contarAdmins() {
    return db.usuarios.filter((u) => u.papel === 'admin' && u.ativo !== false).length;
  },
  async criarUsuario(d) {
    const u = {
      id: nextId(db.usuarios),
      nome: d.nome, usuario: d.usuario, senha_hash: d.senha_hash,
      setor_id: d.setor_id, papel: d.papel,
      colunas_visiveis: Array.isArray(d.colunas_visiveis) ? d.colunas_visiveis.slice() : null,
      ativo: d.ativo !== false,
      pode_clientes: !!d.pode_clientes,
    };
    db.usuarios.push(u);
    return usuarioPublico(u);
  },
  async atualizarUsuario(id, d) {
    const u = db.usuarios.find((x) => x.id === id);
    if (!u) return null;
    if ('nome' in d) u.nome = d.nome;
    if ('usuario' in d) u.usuario = d.usuario;
    if ('senha_hash' in d && d.senha_hash) u.senha_hash = d.senha_hash;
    if ('setor_id' in d) u.setor_id = d.setor_id;
    if ('papel' in d) u.papel = d.papel;
    if ('ativo' in d) u.ativo = !!d.ativo;
    if ('pode_clientes' in d) u.pode_clientes = !!d.pode_clientes;
    if ('colunas_visiveis' in d) {
      u.colunas_visiveis = Array.isArray(d.colunas_visiveis) ? d.colunas_visiveis.slice() : null;
    }
    return usuarioPublico(u);
  },
  async excluirUsuario(id) {
    const i = db.usuarios.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.usuarios.splice(i, 1);
    // remove o usuario de qualquer tarefa em que era responsavel
    db.tarefas.forEach((t) => { t.responsaveis = t.responsaveis.filter((r) => r !== id); });
    return true;
  },

  // ---------------- SETORES / COLUNAS ----------------
  async listarSetores() {
    return db.setores.slice().sort((a, b) => a.ordem - b.ordem).map(setorPublico);
  },
  async buscarSetorPorSlug(slug) {
    const s = db.setores.find((x) => x.slug === slug);
    return s ? setorPublico(s) : null;
  },
  // usuario opcional: filtra colunas pela visibilidade (Criativo restrito)
  async listarColunas(setorId, usuario) {
    let cols = colunasDoSetor(setorId);
    if (usuario && usuario.papel !== 'admin') {
      const u = db.usuarios.find((x) => x.id === usuario.id);
      const vis = u && Array.isArray(u.colunas_visiveis) ? u.colunas_visiveis : null;
      if (vis && vis.length) cols = cols.filter((c) => vis.includes(c.id));
    }
    return cols;
  },

  // ---------------- CLIENTES ----------------
  async listarClientes() {
    return db.clientes.slice().sort((a, b) => a.empresa.localeCompare(b.empresa)).map(clone);
  },
  async buscarCliente(id) {
    const c = db.clientes.find((x) => x.id === id); return c ? clone(c) : null;
  },
  async criarCliente(dados) {
    const novo = { id: nextId(db.clientes), ...dados }; db.clientes.push(novo); return clone(novo);
  },
  async atualizarCliente(id, dados) {
    const c = db.clientes.find((x) => x.id === id); if (!c) return null;
    Object.assign(c, dados); return clone(c);
  },
  async excluirCliente(id) {
    const i = db.clientes.findIndex((x) => x.id === id); if (i === -1) return false;
    db.clientes.splice(i, 1); return true;
  },

  // ---------------- TAREFAS ----------------
  async listarTarefasPorSetor(setorId, { incluirArquivadas = false } = {}) {
    sweepUrgencia();
    return db.tarefas.filter((t) => t.setor_id === setorId).map(montaTarefa)
      .filter((t) => incluirArquivadas || !t.arquivada);
  },
  async listarTodasTarefas({ incluirArquivadas = false } = {}) {
    sweepUrgencia();
    return db.tarefas.map(montaTarefa).filter((t) => incluirArquivadas || !t.arquivada);
  },
  async buscarTarefa(id) {
    const t = db.tarefas.find((x) => x.id === id); return t ? montaTarefa(t) : null;
  },
  async criarTarefa(dados) {
    const t = {
      id: nextId(db.tarefas),
      titulo: dados.titulo, descricao: dados.descricao || '',
      setor_id: dados.setor_id, coluna_id: dados.coluna_id,
      cliente_id: dados.cliente_id || null, prioridade: dados.prioridade || 'normal',
      data_inicio: dados.data_inicio || null, data_entrega: dados.data_entrega || null,
      data_publicacao: dados.data_publicacao || null, criado_por: dados.criado_por,
      responsaveis: Array.isArray(dados.responsaveis) ? dados.responsaveis.slice() : [],
      concluida_em: null, andamento_inicio: null,
      retrabalho_design: 0, retrabalho_edicao: 0, retrabalho_pdf: 0,
      recorrencia: dados.recorrencia || null,
      recorrencia_ate: dados.recorrencia_ate || null,
      recorrencia_origem_id: dados.recorrencia_origem_id || null,
      recorrencia_gerou_id: null,
    };
    // se ja nasce numa coluna de trabalho, inicia cronometro
    const primeira = primeiraColunaDo(t.setor_id);
    const col = db.colunas.find((c) => c.id === t.coluna_id);
    if (col && primeira && col.id !== primeira.id && !col.e_conclusao) {
      t.andamento_inicio = new Date().toISOString();
      const rt = ehRetrabalho(col.nome); if (rt) t['retrabalho_' + rt] += 1;
    }
    // nasceu direto numa coluna de conclusao: ja entra concluida (antes ficava
    // na coluna de "pronto" para sempre sem data de conclusao)
    if (col && col.e_conclusao) t.concluida_em = new Date().toISOString();
    db.tarefas.push(t);
    return montaTarefa(t);
  },
  async atualizarTarefa(id, dados) {
    const t = db.tarefas.find((x) => x.id === id); if (!t) return null;
    ['titulo', 'descricao', 'cliente_id', 'prioridade', 'data_inicio', 'data_entrega', 'data_publicacao',
      'recorrencia', 'recorrencia_ate']
      .forEach((k) => { if (k in dados) t[k] = dados[k]; });
    if (Array.isArray(dados.responsaveis)) t.responsaveis = dados.responsaveis.slice();
    return montaTarefa(t);
  },
  async moverTarefa(id, colunaId) {
    const t = db.tarefas.find((x) => x.id === id); if (!t) return null;
    const col = db.colunas.find((c) => c.id === colunaId);
    if (!col || col.setor_id !== t.setor_id) return null;

    t.coluna_id = colunaId;

    // cronometro: primeira saida da coluna inicial para uma coluna de trabalho
    const primeira = primeiraColunaDo(t.setor_id);
    const iniciaTrabalho = primeira && col.id !== primeira.id && !col.e_conclusao;
    if (iniciaTrabalho && !t.andamento_inicio) t.andamento_inicio = new Date().toISOString();

    // contador de retrabalho
    const rt = ehRetrabalho(col.nome);
    if (rt) t['retrabalho_' + rt] = (t['retrabalho_' + rt] || 0) + 1;

    // conclusao
    let concluiuAgora = false;
    if (col.e_conclusao && !t.concluida_em) { t.concluida_em = new Date().toISOString(); concluiuAgora = true; }
    else if (!col.e_conclusao) { t.concluida_em = null; }

    return { tarefa: montaTarefa(t), concluiuAgora };
  },
  async excluirTarefa(id) {
    const i = db.tarefas.findIndex((x) => x.id === id); if (i === -1) return false;
    db.tarefas.splice(i, 1);
    db.anexos = db.anexos.filter((a) => a.tarefa_id !== id);
    return true;
  },

  // ---------------- COMENTARIOS ----------------
  async listarComentarios(tarefaId) {
    return db.comentarios
      .filter((c) => c.tarefa_id === tarefaId)
      .sort((a, b) => a.id - b.id)
      .map((c) => {
        const u = db.usuarios.find((x) => x.id === c.usuario_id);
        return { ...clone(c), usuario_nome: u ? u.nome : 'Usuário removido' };
      });
  },
  async criarComentario(dados) {
    const c = {
      id: nextId(db.comentarios),
      tarefa_id: dados.tarefa_id,
      usuario_id: dados.usuario_id,
      texto: dados.texto,
      criado_em: new Date().toISOString(),
    };
    db.comentarios.push(c);
    const u = db.usuarios.find((x) => x.id === c.usuario_id);
    return { ...clone(c), usuario_nome: u ? u.nome : '' };
  },
  async buscarComentario(id) {
    const c = db.comentarios.find((x) => x.id === id);
    return c ? clone(c) : null;
  },
  async excluirComentario(id) {
    const i = db.comentarios.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.comentarios.splice(i, 1);
    return true;
  },

  // ---------------- RECORRENCIA ----------------
  // Cabeca da serie = tem frequencia definida e ainda nao gerou a proxima.
  async listarTarefasRecorrentesPendentes() {
    return db.tarefas
      .filter((t) => t.recorrencia && !t.recorrencia_gerou_id)
      .map(montaTarefa);
  },
  async marcarRecorrenciaGerada(id, novaId) {
    const t = db.tarefas.find((x) => x.id === id);
    if (!t) return false;
    t.recorrencia_gerou_id = novaId;
    return true;
  },

  // ---------------- HISTORICO (trilha de auditoria) ----------------
  async registrarHistorico(dados) {
    const h = {
      id: nextId(db.historico),
      tipo: dados.tipo,
      entidade: dados.entidade || 'tarefa',
      entidade_id: dados.entidade_id != null ? dados.entidade_id : (dados.tarefa_id || null),
      tarefa_id: dados.tarefa_id || null,
      titulo: dados.titulo || '',
      setor_id: dados.setor_id || null, usuario_id: dados.usuario_id || null,
      usuario_nome: dados.usuario_nome || '', detalhe: dados.detalhe || '',
      cliente_id: dados.cliente_id || null, cliente_nome: dados.cliente_nome || '',
      responsaveis: Array.isArray(dados.responsaveis) ? dados.responsaveis : [],
      ip: dados.ip || '', user_agent: dados.user_agent || '',
      criado_em: new Date().toISOString(),
    };
    db.historico.push(h);
    return clone(h);
  },
  // Filtros aceitos: setorId, entidade, tipo, usuarioId, de/ate (YYYY-MM-DD),
  // q (busca livre em titulo, autor, cliente, detalhe e IP) e limit.
  async listarHistorico(filtros = {}) {
    const { limit = 300, setorId = null, entidade = null, tipo = null,
            usuarioId = null, de = null, ate = null, q = null, antesDe = null } = filtros;
    const busca = q ? String(q).toLowerCase() : null;

    let l = db.historico.slice().sort((a, b) => b.id - a.id);
    // cursor: so o que veio ANTES do ultimo id ja entregue (pagina seguinte)
    if (antesDe != null) l = l.filter((h) => h.id < Number(antesDe));
    if (setorId != null) l = l.filter((h) => h.setor_id === Number(setorId));
    if (entidade) l = l.filter((h) => (h.entidade || 'tarefa') === entidade);
    if (tipo) l = l.filter((h) => h.tipo === tipo);
    if (usuarioId != null) l = l.filter((h) => h.usuario_id === Number(usuarioId));
    if (de) l = l.filter((h) => (h.criado_em || '').slice(0, 10) >= de);
    if (ate) l = l.filter((h) => (h.criado_em || '').slice(0, 10) <= ate);
    if (busca) {
      l = l.filter((h) => [h.titulo, h.usuario_nome, h.cliente_nome, h.detalhe, h.ip]
        .some((c) => String(c || '').toLowerCase().includes(busca)));
    }
    return l.slice(0, limit).map(clone);
  },
  // Valores distintos para montar os seletores da tela sem depender da
  // pagina carregada.
  async opcoesHistorico() {
    const distintos = (fn) => Array.from(new Set(db.historico.map(fn).filter((v) => v !== null && v !== undefined && v !== '')));
    return {
      pessoas: distintos((h) => h.usuario_nome).sort((a, b) => String(a).localeCompare(String(b))),
      clientes: distintos((h) => h.cliente_nome).sort((a, b) => String(a).localeCompare(String(b))),
      setores: distintos((h) => h.setor_id).sort((a, b) => a - b),
      entidades: distintos((h) => h.entidade || 'tarefa').sort(),
      tipos: distintos((h) => h.tipo).sort(),
      total: db.historico.length,
    };
  },

  // ---------------- BLOQUEIO DE LOGIN ----------------
  // Mesma interface do pgRepo: quem decide a regra e o middleware, aqui so
  // guardamos e devolvemos o contador.
  async lerBloqueio(chave) {
    const b = db.bloqueios.get(chave);
    return b ? { ...b } : null;
  },
  async salvarBloqueio(chave, dados) {
    db.bloqueios.set(chave, {
      falhas: dados.falhas,
      ate: dados.ate || null,
      visto: dados.visto || Date.now(),
    });
    return true;
  },
  async limparBloqueios(chaves) {
    (chaves || []).forEach((c) => db.bloqueios.delete(c));
    return true;
  },
  async limparBloqueiosVelhos(antesDe) {
    for (const [chave, b] of db.bloqueios) {
      const expirou = (b.ate && b.ate <= Date.now()) || (!b.ate && b.visto < antesDe);
      if (expirou) db.bloqueios.delete(chave);
    }
    return true;
  },

  // ---------------- ANEXOS ----------------
  async criarAnexo(dados) {
    const a = { id: nextId(db.anexos), ...dados, criado_em: new Date().toISOString() };
    db.anexos.push(a); return clone(a);
  },
  async buscarAnexo(id) {
    const a = db.anexos.find((x) => x.id === id); return a ? clone(a) : null;
  },

  // ---------------- NOTIFICACOES ----------------
  async criarNotificacao(dados) {
    const n = {
      id: nextId(db.notificacoes), tipo: dados.tipo || 'tarefa_concluida',
      titulo: dados.titulo, mensagem: dados.mensagem || '',
      tarefa_id: dados.tarefa_id || null, setor_id: dados.setor_id || null,
      prioridade: dados.prioridade || null, lida: false, criado_em: new Date().toISOString(),
    };
    db.notificacoes.push(n); return clone(n);
  },
  async listarNotificacoes({ apenasNaoLidas = false, setorId = null } = {}) {
    let lista = db.notificacoes.slice().sort((a, b) => b.id - a.id);
    if (setorId != null) lista = lista.filter((n) => n.setor_id === setorId || n.setor_id == null);
    if (apenasNaoLidas) lista = lista.filter((n) => !n.lida);
    return lista.map(clone);
  },
  async marcarNotificacaoLida(id) {
    const n = db.notificacoes.find((x) => x.id === id); if (!n) return false;
    n.lida = true; return true;
  },
  async marcarTodasNotificacoesLidas(setorId = null) {
    db.notificacoes.forEach((n) => {
      if (setorId == null || n.setor_id === setorId || n.setor_id == null) n.lida = true;
    });
    return true;
  },
};