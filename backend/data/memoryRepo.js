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
  uso: new Map(),      // contadores de limite por janela de tempo
  eventos: [],
  chatConversas: [],
  chatMembros: [],     // { conversa_id, usuario_id, ultima_lida_id }
  chatMensagens: [],
  textos: [],          // prompts (equipe) e mensagens salvas (pessoais)
  briefings: [],
  briefingArquivos: [],
  acessos: [],
  push: [],
  clienteServicos: [],
  clienteDatas: [],
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
    avatar_path: u.avatar_path || null,
  };
}
// cliente com os servicos contratados e as datas importantes
function montaCliente(c) {
  return {
    ...clone(c),
    servicos: db.clienteServicos.filter((s) => s.cliente_id === c.id)
      .sort((a, b) => a.nome.localeCompare(b.nome)).map((s) => ({ id: s.id, nome: s.nome })),
    datas: db.clienteDatas.filter((d) => d.cliente_id === c.id)
      .sort((a, b) => (a.mes - b.mes) || (a.dia - b.dia)).map((d) => ({ id: d.id, mes: d.mes, dia: d.dia, nome: d.nome })),
  };
}
// so o que qualquer colega pode ver de outra pessoa
function pessoa(uid) {
  const u = db.usuarios.find((x) => x.id === uid);
  return u ? { id: u.id, nome: u.nome, avatar_path: u.avatar_path || null } : null;
}
function montaEvento(e) {
  const setor = e.setor_id ? db.setores.find((s) => s.id === e.setor_id) : null;
  const autor = db.usuarios.find((u) => u.id === e.criado_por);
  return {
    ...clone(e),
    participantes: e.participantes.map(pessoa).filter(Boolean),
    setor_nome: setor ? setor.nome : null,
    criado_por_nome: autor ? autor.nome : '',
  };
}
function montaMensagem(m) {
  const u = db.usuarios.find((x) => x.id === m.usuario_id);
  return { ...clone(m), usuario_nome: u ? u.nome : 'Usuário removido' };
}
function montaConversa(c, uid) {
  const membros = db.chatMembros.filter((m) => m.conversa_id === c.id);
  const msgs = db.chatMensagens.filter((m) => m.conversa_id === c.id);
  const ultima = msgs.length ? msgs[msgs.length - 1] : null;
  const eu = membros.find((m) => m.usuario_id === uid);
  const lidaAte = eu ? eu.ultima_lida_id : 0;
  return {
    ...clone(c),
    membros: membros.map((m) => pessoa(m.usuario_id)).filter(Boolean),
    ultima_mensagem: ultima ? montaMensagem(ultima) : null,
    nao_lidas: msgs.filter((m) => m.id > lidaAte && m.usuario_id !== uid).length,
  };
}
function montaBriefing(b) {
  const cli = b.cliente_id ? db.clientes.find((c) => c.id === b.cliente_id) : null;
  const autor = db.usuarios.find((u) => u.id === (b.atualizado_por || b.criado_por));
  return { ...clone(b), cliente_nome: cli ? cli.empresa : null, atualizado_por_nome: autor ? autor.nome : '' };
}
// o cofre nunca devolve a senha cifrada junto com o resto: so diz se tem
function montaAcesso(a) {
  const cli = a.cliente_id ? db.clientes.find((c) => c.id === a.cliente_id) : null;
  const { senha_cifrada, ...resto } = clone(a);
  return { ...resto, tem_senha: !!senha_cifrada, cliente_nome: cli ? cli.empresa : null };
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
  // mesmos campos do pgRepo: o nome do arquivo em disco nunca sai daqui
  const anexos = db.anexos.filter((a) => a.tarefa_id === t.id)
    .map((a) => ({ id: a.id, nome_original: a.nome_original, mime: a.mime, tamanho: a.tamanho }));
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
             senha_versao: u.senha_versao || 0,
             setor_id: u.setor_id, setor_slug: s ? s.slug : null, setor_nome: s ? s.nome : null,
             ativo: u.ativo !== false, pode_clientes: !!u.pode_clientes,
             avatar_path: u.avatar_path || null };
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
    // mesma barreira da chave unica do Postgres (login repetido -> 23505)
    if (db.usuarios.some((x) => x.usuario === d.usuario)) throw Object.assign(new Error('login duplicado'), { code: '23505' });
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
    if ('senha_hash' in d && d.senha_hash) {
      u.senha_hash = d.senha_hash;
      // senha nova, versao nova: quem estava logado com a antiga cai
      u.senha_versao = (u.senha_versao || 0) + 1;
    }
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
    // mesmas cascatas do Postgres
    db.eventos.forEach((e) => { e.participantes = e.participantes.filter((p) => p !== id); });
    db.chatMembros = db.chatMembros.filter((m) => m.usuario_id !== id);
    db.textos = db.textos.filter((t) => !(t.tipo === 'mensagem' && t.usuario_id === id));
    db.push = db.push.filter((p) => p.usuario_id !== id);
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
    return db.clientes.slice().sort((a, b) => a.empresa.localeCompare(b.empresa)).map(montaCliente);
  },
  async buscarCliente(id) {
    const c = db.clientes.find((x) => x.id === id); return c ? montaCliente(c) : null;
  },
  async criarCliente(dados) {
    const novo = { id: nextId(db.clientes), ...dados }; db.clientes.push(novo); return montaCliente(novo);
  },
  async atualizarCliente(id, dados) {
    const c = db.clientes.find((x) => x.id === id); if (!c) return null;
    Object.assign(c, dados); return montaCliente(c);
  },
  async excluirCliente(id) {
    const i = db.clientes.findIndex((x) => x.id === id); if (i === -1) return false;
    db.clientes.splice(i, 1);
    db.clienteServicos = db.clienteServicos.filter((s) => s.cliente_id !== id);
    db.clienteDatas = db.clienteDatas.filter((d) => d.cliente_id !== id);
    return true;
  },

  // servicos contratados (nome unico por cliente, sem diferenciar maiuscula)
  async criarServicoCliente(clienteId, nome) {
    const existe = db.clienteServicos.some((s) => s.cliente_id === clienteId && s.nome.toLowerCase() === nome.toLowerCase());
    if (existe) return null;
    const s = { id: nextId(db.clienteServicos), cliente_id: clienteId, nome };
    db.clienteServicos.push(s);
    return { id: s.id, nome: s.nome };
  },
  async excluirServicoCliente(clienteId, servicoId) {
    const antes = db.clienteServicos.length;
    db.clienteServicos = db.clienteServicos.filter((s) => !(s.id === servicoId && s.cliente_id === clienteId));
    return db.clienteServicos.length < antes;
  },
  // datas importantes (repetem todo ano)
  async criarDataCliente(clienteId, d) {
    const nova = { id: nextId(db.clienteDatas), cliente_id: clienteId, mes: d.mes, dia: d.dia, nome: d.nome };
    db.clienteDatas.push(nova);
    return { id: nova.id, mes: nova.mes, dia: nova.dia, nome: nova.nome };
  },
  async excluirDataCliente(clienteId, dataId) {
    const antes = db.clienteDatas.length;
    db.clienteDatas = db.clienteDatas.filter((d) => !(d.id === dataId && d.cliente_id === clienteId));
    return db.clienteDatas.length < antes;
  },
  async listarDatasDeClientes() {
    return db.clienteDatas
      .map((d) => {
        const c = db.clientes.find((x) => x.id === d.cliente_id);
        return { id: d.id, cliente_id: d.cliente_id, cliente_nome: c ? c.empresa : '', mes: d.mes, dia: d.dia, nome: d.nome };
      })
      .sort((a, b) => (a.mes - b.mes) || (a.dia - b.dia));
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
  // -2 = "gerando agora": so quem achou a serie livre leva a reserva
  async reservarRecorrencia(id) {
    const t = db.tarefas.find((x) => x.id === id);
    if (!t || t.recorrencia_gerou_id) return false;
    t.recorrencia_gerou_id = -2;
    return true;
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
      prioridade: dados.prioridade || '',
      ip: dados.ip || '', user_agent: dados.user_agent || '',
      criado_em: new Date().toISOString(),
    };
    db.historico.push(h);
    return clone(h);
  },
  // Filtros aceitos: setorId, entidade, tipo, tipos (lista), usuarioId,
  // clienteNome, responsavelNome, prioridade, de/ate (YYYY-MM-DD),
  // q (busca livre em titulo, autor, cliente, detalhe e IP) e limit.
  async listarHistorico(filtros = {}) {
    const { limit = 300, setorId = null, entidade = null, tipo = null, tipos = null,
            usuarioId = null, clienteNome = null, responsavelNome = null, prioridade = null,
            de = null, ate = null, q = null, antesDe = null } = filtros;
    const busca = q ? String(q).toLowerCase() : null;

    let l = db.historico.slice().sort((a, b) => b.id - a.id);
    // cursor: so o que veio ANTES do ultimo id ja entregue (pagina seguinte)
    if (antesDe != null) l = l.filter((h) => h.id < Number(antesDe));
    if (setorId != null) l = l.filter((h) => h.setor_id === Number(setorId));
    if (entidade) l = l.filter((h) => (h.entidade || 'tarefa') === entidade);
    if (tipo) l = l.filter((h) => h.tipo === tipo);
    if (Array.isArray(tipos) && tipos.length) l = l.filter((h) => tipos.includes(h.tipo));
    if (usuarioId != null) l = l.filter((h) => h.usuario_id === Number(usuarioId));
    if (clienteNome) l = l.filter((h) => h.cliente_nome === clienteNome);
    if (responsavelNome) l = l.filter((h) => (h.responsaveis || []).some((r) => r && r.nome === responsavelNome));
    if (prioridade) l = l.filter((h) => h.prioridade === prioridade);
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
      responsaveis: Array.from(new Set(db.historico.flatMap((h) => (h.responsaveis || []).map((r) => r && r.nome))
        .filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))),
      prioridades: distintos((h) => h.prioridade).sort(),
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
  // mesma regra do pgRepo; aqui ler e gravar acontecem sem await no meio,
  // entao duas chamadas simultaneas nao se atropelam
  async somarFalhaBloqueio(chave, { limite = null, ate = null } = {}) {
    const b = db.bloqueios.get(chave) || { falhas: 0, ate: null };
    const falhas = b.falhas + 1;
    const novo = {
      falhas,
      ate: limite != null && falhas >= limite ? (b.ate || ate) : b.ate,
      visto: Date.now(),
    };
    db.bloqueios.set(chave, novo);
    return { falhas: novo.falhas, ate: novo.ate };
  },

  // ---------------- CONTADORES DE USO (limites por janela de tempo) ----------------
  async somarUso(chave, quantidade, janelaMs) {
    const agora = Date.now();
    const u = db.uso.get(chave);
    const atual = u && u.reinicia_em > agora ? u : { contador: 0, reinicia_em: agora + janelaMs };
    atual.contador += quantidade;
    db.uso.set(chave, atual);
    return { ...atual };
  },
  async lerUso(chave) {
    const u = db.uso.get(chave);
    return u && u.reinicia_em > Date.now() ? { ...u } : null;
  },
  async zerarUso(chave) {
    db.uso.delete(chave);
    return true;
  },
  async limparUsoVencido() {
    const agora = Date.now();
    for (const [chave, u] of db.uso) if (u.reinicia_em <= agora) db.uso.delete(chave);
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

  // ---------------- EQUIPE / FOTO DE PERFIL ----------------
  // Lista de colegas que qualquer pessoa logada pode ver (sem login nem papel).
  async listarEquipe() {
    return db.usuarios.filter((u) => u.ativo !== false)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((u) => {
        const s = db.setores.find((x) => x.id === u.setor_id);
        return { id: u.id, nome: u.nome, setor_id: u.setor_id, setor_nome: s ? s.nome : null,
                 avatar_path: u.avatar_path || null };
      });
  },
  // devolve o arquivo anterior, para quem chamou apagar do disco
  async definirAvatar(usuarioId, caminho) {
    const u = db.usuarios.find((x) => x.id === usuarioId);
    if (!u) return null;
    const anterior = u.avatar_path || null;
    u.avatar_path = caminho || null;
    return { anterior };
  },

  // ---------------- CALENDARIO DA EQUIPE ----------------
  // Quem pode ver o que e decidido na rota; aqui so o recorte por data.
  async listarEventos({ de = null, ate = null } = {}) {
    return db.eventos
      .filter((e) => (!de || e.data >= de) && (!ate || e.data <= ate))
      .sort((a, b) => (a.data.localeCompare(b.data)) || String(a.hora_inicio || '').localeCompare(String(b.hora_inicio || '')) || a.id - b.id)
      .map(montaEvento);
  },
  async buscarEvento(id) {
    const e = db.eventos.find((x) => x.id === id);
    return e ? montaEvento(e) : null;
  },
  async criarEvento(d) {
    const agora = new Date().toISOString();
    const e = {
      id: nextId(db.eventos), titulo: d.titulo, descricao: d.descricao || '', data: d.data,
      hora_inicio: d.hora_inicio || null, hora_fim: d.hora_fim || null, local: d.local || '',
      setor_id: d.setor_id || null, criado_por: d.criado_por || null,
      participantes: Array.isArray(d.participantes) ? d.participantes.slice() : [],
      criado_em: agora, atualizado_em: agora,
    };
    db.eventos.push(e);
    return montaEvento(e);
  },
  async atualizarEvento(id, d) {
    const e = db.eventos.find((x) => x.id === id);
    if (!e) return null;
    ['titulo', 'descricao', 'data', 'hora_inicio', 'hora_fim', 'local', 'setor_id']
      .forEach((k) => { if (k in d) e[k] = d[k]; });
    if (Array.isArray(d.participantes)) e.participantes = d.participantes.slice();
    e.atualizado_em = new Date().toISOString();
    return montaEvento(e);
  },
  async excluirEvento(id) {
    const i = db.eventos.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.eventos.splice(i, 1);
    return true;
  },

  // ---------------- CHAT ----------------
  async listarConversasDoUsuario(uid) {
    const ids = new Set(db.chatMembros.filter((m) => m.usuario_id === uid).map((m) => m.conversa_id));
    return db.chatConversas.filter((c) => ids.has(c.id))
      .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)) || b.id - a.id)
      .map((c) => montaConversa(c, uid));
  },
  async buscarConversa(id, uid = null) {
    const c = db.chatConversas.find((x) => x.id === id);
    return c ? montaConversa(c, uid) : null;
  },
  async buscarConversaDireta(uidA, uidB) {
    const c = db.chatConversas.find((x) => {
      if (x.tipo !== 'direta') return false;
      const ids = db.chatMembros.filter((m) => m.conversa_id === x.id).map((m) => m.usuario_id).sort();
      const alvo = [uidA, uidB].sort();
      return ids.length === 2 && ids[0] === alvo[0] && ids[1] === alvo[1];
    });
    return c ? montaConversa(c, uidA) : null;
  },
  async criarConversa(d) {
    const agora = new Date().toISOString();
    // mesma regra da chave unica do Postgres: um par, uma conversa direta
    const chave = d.tipo === 'direta' ? [Number(d.membros[0]), Number(d.membros[1])].sort((x, y) => x - y).join(':') : null;
    const existente = chave && db.chatConversas.find((x) => x.chave_direta === chave);
    if (existente) return { ...montaConversa(existente, d.criado_por), ja_existia: true };
    const c = { id: nextId(db.chatConversas), tipo: d.tipo, nome: d.nome || '', chave_direta: chave,
                criado_por: d.criado_por || null, criado_em: agora, atualizado_em: agora };
    db.chatConversas.push(c);
    Array.from(new Set(d.membros || [])).forEach((uid) => {
      db.chatMembros.push({ conversa_id: c.id, usuario_id: uid, ultima_lida_id: 0 });
    });
    return montaConversa(c, d.criado_por);
  },
  // membros: lista completa nova (quem continua guarda ate onde ja leu)
  async atualizarConversa(id, d) {
    const c = db.chatConversas.find((x) => x.id === id);
    if (!c) return null;
    if ('nome' in d) c.nome = d.nome;
    if (Array.isArray(d.membros)) {
      const novos = new Set(d.membros);
      db.chatMembros = db.chatMembros.filter((m) => m.conversa_id !== id || novos.has(m.usuario_id));
      novos.forEach((uid) => {
        if (!db.chatMembros.some((m) => m.conversa_id === id && m.usuario_id === uid)) {
          db.chatMembros.push({ conversa_id: id, usuario_id: uid, ultima_lida_id: 0 });
        }
      });
    }
    return montaConversa(c, null);
  },
  async removerMembroConversa(id, uid) {
    const antes = db.chatMembros.length;
    db.chatMembros = db.chatMembros.filter((m) => !(m.conversa_id === id && m.usuario_id === uid));
    return db.chatMembros.length < antes;
  },
  // devolve os arquivos anexados, para quem chamou apagar do disco
  async excluirConversa(id) {
    const i = db.chatConversas.findIndex((x) => x.id === id);
    if (i === -1) return null;
    db.chatConversas.splice(i, 1);
    const arquivos = db.chatMensagens.filter((m) => m.conversa_id === id && m.anexo_arquivo).map((m) => m.anexo_arquivo);
    db.chatMensagens = db.chatMensagens.filter((m) => m.conversa_id !== id);
    db.chatMembros = db.chatMembros.filter((m) => m.conversa_id !== id);
    return { arquivos };
  },
  // mais novas primeiro; antesDe = cursor para buscar as mais antigas
  async listarMensagens(conversaId, { antesDe = null, limit = 50 } = {}) {
    return db.chatMensagens
      .filter((m) => m.conversa_id === conversaId && (antesDe == null || m.id < Number(antesDe)))
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map(montaMensagem);
  },
  async criarMensagem(d) {
    const m = {
      id: nextId(db.chatMensagens), conversa_id: d.conversa_id, usuario_id: d.usuario_id,
      texto: d.texto || '', anexo_nome_original: d.anexo_nome_original || null,
      anexo_arquivo: d.anexo_arquivo || null, anexo_mime: d.anexo_mime || null,
      anexo_tamanho: d.anexo_tamanho || null, criado_em: new Date().toISOString(),
    };
    db.chatMensagens.push(m);
    const c = db.chatConversas.find((x) => x.id === d.conversa_id);
    if (c) c.atualizado_em = m.criado_em;
    // quem escreveu ja leu ate a propria mensagem
    const eu = db.chatMembros.find((x) => x.conversa_id === d.conversa_id && x.usuario_id === d.usuario_id);
    if (eu) eu.ultima_lida_id = m.id;
    return montaMensagem(m);
  },
  async buscarMensagem(id) {
    const m = db.chatMensagens.find((x) => x.id === id);
    return m ? montaMensagem(m) : null;
  },
  async marcarConversaLida(conversaId, uid, ateId) {
    const eu = db.chatMembros.find((x) => x.conversa_id === conversaId && x.usuario_id === uid);
    if (!eu) return false;
    // so avanca: uma aba velha nao "desle" o que outra aba ja leu
    eu.ultima_lida_id = Math.max(eu.ultima_lida_id, Number(ateId) || 0);
    return true;
  },
  async contarChatNaoLidas(uid) {
    return db.chatMembros.filter((m) => m.usuario_id === uid)
      .reduce((tot, m) => tot + db.chatMensagens.filter((x) => x.conversa_id === m.conversa_id
        && x.id > m.ultima_lida_id && x.usuario_id !== uid).length, 0);
  },

  // ---------------- PROMPTS E MENSAGENS SALVAS ----------------
  async listarTextos({ tipo, usuarioId = null }) {
    return db.textos
      .filter((t) => t.tipo === tipo && (usuarioId == null || t.usuario_id === usuarioId))
      .sort((a, b) => a.titulo.localeCompare(b.titulo))
      .map((t) => {
        const u = db.usuarios.find((x) => x.id === t.usuario_id);
        return { ...clone(t), autor_nome: u ? u.nome : '' };
      });
  },
  async buscarTexto(id) {
    const t = db.textos.find((x) => x.id === id);
    return t ? clone(t) : null;
  },
  async criarTexto(d) {
    const agora = new Date().toISOString();
    const t = { id: nextId(db.textos), tipo: d.tipo, usuario_id: d.usuario_id || null,
                titulo: d.titulo, conteudo: d.conteudo || '', criado_em: agora, atualizado_em: agora };
    db.textos.push(t);
    return clone(t);
  },
  async atualizarTexto(id, d) {
    const t = db.textos.find((x) => x.id === id);
    if (!t) return null;
    if ('titulo' in d) t.titulo = d.titulo;
    if ('conteudo' in d) t.conteudo = d.conteudo;
    t.atualizado_em = new Date().toISOString();
    return clone(t);
  },
  async excluirTexto(id) {
    const i = db.textos.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.textos.splice(i, 1);
    return true;
  },

  // ---------------- BRIEFINGS ----------------
  async listarBriefings() {
    return db.briefings.slice()
      .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))
      .map(montaBriefing);
  },
  async buscarBriefing(id) {
    const b = db.briefings.find((x) => x.id === id);
    return b ? montaBriefing(b) : null;
  },
  async criarBriefing(d) {
    const agora = new Date().toISOString();
    const b = { id: nextId(db.briefings), cliente_id: d.cliente_id || null, empresa: d.empresa,
                respostas: { ...(d.respostas || {}) }, criado_por: d.criado_por || null,
                atualizado_por: d.criado_por || null, criado_em: agora, atualizado_em: agora };
    db.briefings.push(b);
    return montaBriefing(b);
  },
  async atualizarBriefing(id, d) {
    const b = db.briefings.find((x) => x.id === id);
    if (!b) return null;
    ['cliente_id', 'empresa', 'atualizado_por'].forEach((k) => { if (k in d) b[k] = d[k]; });
    if (d.respostas) b.respostas = { ...d.respostas };
    b.atualizado_em = new Date().toISOString();
    return montaBriefing(b);
  },
  // devolve os arquivos anexados, para quem chamou apagar do disco
  async excluirBriefing(id) {
    const i = db.briefings.findIndex((x) => x.id === id);
    if (i === -1) return null;
    db.briefings.splice(i, 1);
    const arquivos = db.briefingArquivos.filter((a) => a.briefing_id === id).map((a) => a.nome_arquivo);
    db.briefingArquivos = db.briefingArquivos.filter((a) => a.briefing_id !== id);
    return { arquivos };
  },
  async listarArquivosBriefing(briefingId) {
    return db.briefingArquivos.filter((a) => a.briefing_id === briefingId)
      .sort((a, b) => a.id - b.id)
      .map((a) => {
        const u = db.usuarios.find((x) => x.id === a.enviado_por);
        return { ...clone(a), enviado_por_nome: u ? u.nome : '' };
      });
  },
  async criarArquivoBriefing(d) {
    const a = { id: nextId(db.briefingArquivos), ...d, criado_em: new Date().toISOString() };
    db.briefingArquivos.push(a);
    return clone(a);
  },
  async buscarArquivoBriefing(id) {
    const a = db.briefingArquivos.find((x) => x.id === id);
    return a ? clone(a) : null;
  },
  async excluirArquivoBriefing(id) {
    const i = db.briefingArquivos.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.briefingArquivos.splice(i, 1);
    return true;
  },

  // ---------------- COFRE DE ACESSOS ----------------
  async listarAcessos() {
    return db.acessos.slice()
      .sort((a, b) => {
        const ca = (montaAcesso(a).cliente_nome || '').localeCompare(montaAcesso(b).cliente_nome || '');
        return ca || a.servico.localeCompare(b.servico);
      })
      .map(montaAcesso);
  },
  async buscarAcesso(id) {
    const a = db.acessos.find((x) => x.id === id);
    return a ? montaAcesso(a) : null;
  },
  async lerSenhaCifrada(id) {
    const a = db.acessos.find((x) => x.id === id);
    return a ? (a.senha_cifrada || null) : null;
  },
  async criarAcesso(d) {
    const agora = new Date().toISOString();
    const a = { id: nextId(db.acessos), cliente_id: d.cliente_id || null, servico: d.servico,
                url: d.url || '', login: d.login || '', senha_cifrada: d.senha_cifrada || null,
                observacoes: d.observacoes || '', criado_por: d.criado_por || null,
                criado_em: agora, atualizado_em: agora };
    db.acessos.push(a);
    return montaAcesso(a);
  },
  async atualizarAcesso(id, d) {
    const a = db.acessos.find((x) => x.id === id);
    if (!a) return null;
    ['cliente_id', 'servico', 'url', 'login', 'senha_cifrada', 'observacoes']
      .forEach((k) => { if (k in d) a[k] = d[k]; });
    a.atualizado_em = new Date().toISOString();
    return montaAcesso(a);
  },
  async excluirAcesso(id) {
    const i = db.acessos.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.acessos.splice(i, 1);
    return true;
  },

  // ---------------- PUSH ----------------
  // O mesmo aparelho (endpoint) pode trocar de dono quando outra pessoa
  // entra nele: a inscricao passa a ser de quem esta logado agora.
  async salvarInscricaoPush(d) {
    const atual = db.push.find((p) => p.endpoint === d.endpoint);
    if (atual) Object.assign(atual, { usuario_id: d.usuario_id, p256dh: d.p256dh, auth: d.auth });
    else db.push.push({ id: nextId(db.push), ...d, criado_em: new Date().toISOString() });
    return true;
  },
  async removerInscricaoPush(endpoint, usuarioId = null) {
    const antes = db.push.length;
    db.push = db.push.filter((p) => !(p.endpoint === endpoint && (usuarioId == null || p.usuario_id === usuarioId)));
    return db.push.length < antes;
  },
  async listarInscricoesPush(usuarioIds) {
    const ids = new Set(usuarioIds || []);
    return db.push.filter((p) => ids.has(p.usuario_id)).map(clone);
  },
};