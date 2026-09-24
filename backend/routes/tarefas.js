'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin, exigirAdmin, podeAcessarSetor } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { conferirAssinatura } = require('../middleware/assinaturaArquivo');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { criarNotificacao } = require('../services/notificacoes');
const { gerarProxima } = require('../services/recorrencia');
const { comentarioSchema } = require('../schemas/comentario.schema');
const { comIdValidado } = require('../middleware/params');
const { criarTarefaSchema, atualizarTarefaSchema, moverTarefaSchema } = require('../schemas/tarefa.schema');
const v = require('../utils/validar');

const router = express.Router();
// :id sempre numerico (nunca chega NaN no banco)
comIdValidado(router);

// -------- validacao: responsaveis tem que pertencer ao setor da tarefa --------
async function filtrarResponsaveisDoSetor(ids, setorId) {
  const validos = [];
  for (const uid of ids) {
    const u = await repo.buscarUsuarioPorId(uid);
    if (u && (u.setor_id === setorId || u.papel === 'admin')) validos.push(uid);
  }
  return validos;
}

async function nomeSetor(id) {
  const setores = await repo.listarSetores();
  const s = setores.find((x) => x.id === id);
  return s ? s.nome : 'Setor';
}

// gera notificação de tarefa urgente para o setor designado
async function notificarUrgente(tarefa) {
  const nome = await nomeSetor(tarefa.setor_id);
  await criarNotificacao({
    tipo: 'urgente',
    prioridade: 'urgente',
    setor_id: tarefa.setor_id,
    tarefa_id: tarefa.id,
    titulo: `Urgente · ${nome}`,
    mensagem: `Tarefa urgente: "${tarefa.titulo}"${tarefa.cliente_nome ? ' · cliente ' + tarefa.cliente_nome : ''}. Priorize o quanto antes.`,
  });
}

// GET /api/tarefas?setor=ID&arquivadas=1  (query segue com normalizacao leve)
router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const incluirArquivadas = req.query.arquivadas === '1' && req.usuario.papel === 'admin';
    const setorId = v.inteiroOuNull(req.query.setor);
    if (setorId) {
      if (!podeAcessarSetor(req.usuario, setorId)) {
        return res.status(403).json({ erro: 'Sem acesso a este setor' });
      }
      return res.json({ tarefas: await repo.listarTarefasPorSetor(setorId, { incluirArquivadas }) });
    }
    if (req.usuario.papel === 'admin') {
      return res.json({ tarefas: await repo.listarTodasTarefas({ incluirArquivadas }) });
    }
    res.json({ tarefas: await repo.listarTarefasPorSetor(req.usuario.setor_id, { incluirArquivadas }) });
  } catch (e) { next(e); }
});

// GET /api/tarefas/historico   (apenas admin)  -> tem que vir ANTES de /:id
router.get('/historico', exigirLogin, exigirAdmin, async (req, res, next) => {
  try {
    const historico = await repo.listarHistorico({ limit: 300, entidade: 'tarefa' });
    res.json({ historico });
  } catch (e) { next(e); }
});

// GET /api/tarefas/:id
router.get('/:id', exigirLogin, async (req, res, next) => {
  try {
    const t = await repo.buscarTarefa(Number(req.params.id));
    if (!t) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, t.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso' });
    }
    res.json({ tarefa: t });
  } catch (e) { next(e); }
});

// POST /api/tarefas   (criar/distribuir)
// Admin cria em qualquer setor; membro so no proprio.
router.post('/', exigirLogin, validate(criarTarefaSchema), async (req, res, next) => {
  try {
    const setorId = req.body.setor_id; // ja validado (inteiro, obrigatorio)
    if (!podeAcessarSetor(req.usuario, setorId)) {
      return res.status(403).json({ erro: 'Sem permissão para criar neste setor' });
    }

    // coluna: usa a informada (se for do setor) ou a primeira do setor
    const colunas = await repo.listarColunas(setorId);
    if (!colunas.length) return res.status(400).json({ erro: 'Setor sem colunas configuradas' });
    let colunaId = req.body.coluna_id;
    if (!colunas.some((c) => c.id === colunaId)) colunaId = colunas[0].id;

    const responsaveis = await filtrarResponsaveisDoSetor(req.body.responsaveis, setorId);

    const nova = await repo.criarTarefa({
      titulo: req.body.titulo,
      descricao: req.body.descricao,
      setor_id: setorId,
      coluna_id: colunaId,
      cliente_id: req.body.cliente_id,
      prioridade: req.body.prioridade,
      data_inicio: req.body.data_inicio,
      data_entrega: req.body.data_entrega,
      data_publicacao: req.body.data_publicacao,
      criado_por: req.usuario.id,
      responsaveis,
      recorrencia: req.body.recorrencia,
      recorrencia_ate: req.body.recorrencia_ate,
    });

    // avisa o setor: nova demanda criada
    const nomeSet = await nomeSetor(setorId);
    await criarNotificacao({
      tipo: 'nova_demanda',
      setor_id: setorId,
      tarefa_id: nova.id,
      titulo: `Nova demanda · ${nomeSet}`,
      mensagem: `"${nova.titulo}"${nova.cliente_nome ? ' · cliente ' + nova.cliente_nome : ''}${nova.data_entrega ? ' · entrega ' + nova.data_entrega : ''}.`,
    });
    if (nova.prioridade === 'urgente') await notificarUrgente(nova);

    await registrar(req, {
      tipo: 'criada', tarefa_id: nova.id, titulo: nova.titulo, setor_id: setorId,
      usuario_id: req.usuario.id, usuario_nome: req.usuario.nome,
      cliente_id: nova.cliente_id, cliente_nome: nova.cliente_nome,
      responsaveis: nova.responsaveis || [],
      detalhe: `criou a tarefa${nova.cliente_nome ? ' (' + nova.cliente_nome + ')' : ''}`,
    });

    res.status(201).json({ tarefa: nova });
  } catch (e) { next(e); }
});

// PUT /api/tarefas/:id   (editar campos)
router.put('/:id', exigirLogin, validate(atualizarTarefaSchema), async (req, res, next) => {
  try {
    const atual = await repo.buscarTarefa(Number(req.params.id));
    if (!atual) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, atual.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso' });
    }
    const dados = {};
    if ('titulo' in req.body) dados.titulo = req.body.titulo;
    if ('descricao' in req.body) dados.descricao = req.body.descricao;
    if ('cliente_id' in req.body) dados.cliente_id = req.body.cliente_id;
    if ('prioridade' in req.body) dados.prioridade = req.body.prioridade;
    if ('data_inicio' in req.body) dados.data_inicio = req.body.data_inicio;
    if ('data_entrega' in req.body) dados.data_entrega = req.body.data_entrega;
    if ('data_publicacao' in req.body) dados.data_publicacao = req.body.data_publicacao;
    if ('recorrencia' in req.body) dados.recorrencia = req.body.recorrencia;
    if ('recorrencia_ate' in req.body) dados.recorrencia_ate = req.body.recorrencia_ate;
    if ('responsaveis' in req.body) {
      dados.responsaveis = await filtrarResponsaveisDoSetor(req.body.responsaveis, atual.setor_id);
    }
    const t = await repo.atualizarTarefa(atual.id, dados);
    if (dados.prioridade === 'urgente' && atual.prioridade !== 'urgente') {
      await notificarUrgente(t);
    }
    await registrar(req, {
      tipo: 'editada', tarefa_id: t.id, titulo: t.titulo, setor_id: t.setor_id,
      usuario_id: req.usuario.id, usuario_nome: req.usuario.nome,
      cliente_id: t.cliente_id, cliente_nome: t.cliente_nome, responsaveis: t.responsaveis || [],
      detalhe: 'editou a tarefa',
    });
    res.json({ tarefa: t });
  } catch (e) { next(e); }
});

// PATCH /api/tarefas/:id/mover   { coluna_id }
router.patch('/:id/mover', exigirLogin, validate(moverTarefaSchema), async (req, res, next) => {
  try {
    const atual = await repo.buscarTarefa(Number(req.params.id));
    if (!atual) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, atual.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso' });
    }
    const resultado = await repo.moverTarefa(atual.id, req.body.coluna_id);
    if (!resultado) return res.status(400).json({ erro: 'Coluna inválida para este setor' });

    // ao concluir, notifica os admins (atendimento) dizendo QUAL setor finalizou
    if (resultado.concluiuAgora) {
      const setores = await repo.listarSetores();
      const setor = setores.find((s) => s.id === resultado.tarefa.setor_id);
      const nomeSetor = setor ? setor.nome : 'Um setor';
      await criarNotificacao({
        tipo: 'tarefa_concluida',
        titulo: `Tarefa concluída · ${nomeSetor}`,
        mensagem: `O setor ${nomeSetor} finalizou "${resultado.tarefa.titulo}"${resultado.tarefa.cliente_nome ? ' · cliente ' + resultado.tarefa.cliente_nome : ''}.`,
        tarefa_id: resultado.tarefa.id,
      });
    }
    // tarefa recorrente concluida: a proxima ocorrencia nasce na hora, sem
    // esperar a varredura de hora em hora
    let recorrente = null;
    if (resultado.concluiuAgora && resultado.tarefa.recorrencia && !resultado.tarefa.recorrencia_gerou_id) {
      try { recorrente = await gerarProxima(resultado.tarefa, { motivo: 'recorrência (após conclusão)' }); }
      catch (e) { console.error('[recorrencia] falha ao gerar apos conclusao:', e.message); }
    }

    await registrar(req, {
      tipo: resultado.concluiuAgora ? 'concluida' : 'movida',
      tarefa_id: resultado.tarefa.id, titulo: resultado.tarefa.titulo, setor_id: resultado.tarefa.setor_id,
      usuario_id: req.usuario.id, usuario_nome: req.usuario.nome,
      cliente_id: resultado.tarefa.cliente_id, cliente_nome: resultado.tarefa.cliente_nome,
      responsaveis: resultado.tarefa.responsaveis || [],
      detalhe: resultado.concluiuAgora ? 'concluiu a tarefa' : `moveu para "${resultado.tarefa.coluna_nome}"`,
    });

    res.json({ tarefa: resultado.tarefa, recorrente: recorrente || null });
  } catch (e) { next(e); }
});

// DELETE /api/tarefas/:id   (apenas admin)
router.delete('/:id', exigirLogin, exigirAdmin, async (req, res, next) => {
  try {
    const atual = await repo.buscarTarefa(Number(req.params.id));
    if (!atual) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    await repo.excluirTarefa(atual.id);
    await registrar(req, {
      tipo: 'excluida', tarefa_id: atual.id, titulo: atual.titulo, setor_id: atual.setor_id,
      usuario_id: req.usuario.id, usuario_nome: req.usuario.nome,
      cliente_id: atual.cliente_id, cliente_nome: atual.cliente_nome, responsaveis: atual.responsaveis || [],
      detalhe: 'excluiu a tarefa',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/tarefas/:id/duplicar
// Copia a tarefa para uma nova, no inicio do fluxo. Nao leva anexos,
// comentarios, cronometro nem recorrencia: e uma tarefa nova com o mesmo
// conteudo, e nao uma continuacao da antiga.
router.post('/:id/duplicar', exigirLogin, async (req, res, next) => {
  try {
    const origem = await repo.buscarTarefa(Number(req.params.id));
    if (!origem) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, origem.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso a esta tarefa' });
    }

    const colunas = await repo.listarColunas(origem.setor_id);
    if (!colunas.length) return res.status(400).json({ erro: 'Setor sem colunas configuradas' });

    const titulo = String(req.body && req.body.titulo ? req.body.titulo : origem.titulo + ' (cópia)').slice(0, 200);
    const nova = await repo.criarTarefa({
      titulo,
      descricao: origem.descricao,
      setor_id: origem.setor_id,
      coluna_id: colunas[0].id,
      cliente_id: origem.cliente_id,
      prioridade: origem.prioridade,
      data_inicio: origem.data_inicio,
      data_entrega: origem.data_entrega,
      data_publicacao: origem.data_publicacao,
      criado_por: req.usuario.id,
      responsaveis: (origem.responsaveis || []).map((r) => r.id),
    });

    await registrar(req, {
      tipo: 'criada', tarefa_id: nova.id, titulo: nova.titulo, setor_id: nova.setor_id,
      cliente_id: nova.cliente_id, cliente_nome: nova.cliente_nome,
      responsaveis: nova.responsaveis || [],
      detalhe: `duplicou a tarefa #${origem.id}`,
    });

    res.status(201).json({ tarefa: nova });
  } catch (e) { next(e); }
});

// GET /api/tarefas/:id/comentarios
router.get('/:id/comentarios', exigirLogin, async (req, res, next) => {
  try {
    const tarefa = await repo.buscarTarefa(Number(req.params.id));
    if (!tarefa) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, tarefa.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso a esta tarefa' });
    }
    res.json({ comentarios: await repo.listarComentarios(tarefa.id) });
  } catch (e) { next(e); }
});

// POST /api/tarefas/:id/comentarios   { texto }
// Quem comenta e sempre a sessao: o front nao escolhe autor.
router.post('/:id/comentarios', exigirLogin, validate(comentarioSchema), async (req, res, next) => {
  try {
    const tarefa = await repo.buscarTarefa(Number(req.params.id));
    if (!tarefa) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, tarefa.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso a esta tarefa' });
    }

    const comentario = await repo.criarComentario({
      tarefa_id: tarefa.id,
      usuario_id: req.usuario.id,
      texto: req.body.texto,
    });

    // avisa o setor da tarefa (quem esta com a tela aberta ve na hora)
    await criarNotificacao({
      tipo: 'comentario',
      setor_id: tarefa.setor_id,
      tarefa_id: tarefa.id,
      titulo: `Comentário · ${tarefa.titulo}`,
      mensagem: `${req.usuario.nome}: ${req.body.texto.slice(0, 120)}`,
    });

    await registrar(req, {
      tipo: 'editada', tarefa_id: tarefa.id, titulo: tarefa.titulo, setor_id: tarefa.setor_id,
      cliente_id: tarefa.cliente_id, cliente_nome: tarefa.cliente_nome,
      detalhe: 'comentou na tarefa',
    });

    res.status(201).json({ comentario });
  } catch (e) { next(e); }
});

// DELETE /api/tarefas/:id/comentarios/:comentarioId
// Apaga so o proprio comentario. Admin apaga qualquer um.
router.delete('/:id/comentarios/:comentarioId', exigirLogin, async (req, res, next) => {
  try {
    const idComentario = Number(req.params.comentarioId);
    if (!Number.isInteger(idComentario)) return res.status(400).json({ erro: 'Identificador inválido' });

    const comentario = await repo.buscarComentario(idComentario);
    if (!comentario || comentario.tarefa_id !== Number(req.params.id)) {
      return res.status(404).json({ erro: 'Comentário não encontrado' });
    }
    const tarefa = await repo.buscarTarefa(comentario.tarefa_id);
    if (!tarefa || !podeAcessarSetor(req.usuario, tarefa.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso a esta tarefa' });
    }
    if (comentario.usuario_id !== req.usuario.id && req.usuario.papel !== 'admin') {
      return res.status(403).json({ erro: 'Só o autor (ou o Atendimento) pode apagar o comentário' });
    }

    await repo.excluirComentario(idComentario);
    await registrar(req, {
      tipo: 'editada', tarefa_id: tarefa.id, titulo: tarefa.titulo, setor_id: tarefa.setor_id,
      detalhe: 'apagou um comentário da tarefa',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/tarefas/:id/anexos   (multipart: campo "arquivo")
router.post('/:id/anexos', exigirLogin, upload.single('arquivo'), conferirAssinatura, async (req, res, next) => {
  try {
    const atual = await repo.buscarTarefa(Number(req.params.id));
    if (!atual) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    if (!podeAcessarSetor(req.usuario, atual.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso' });
    }
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const anexo = await repo.criarAnexo({
      tarefa_id: atual.id,
      nome_original: req.file.originalname,
      nome_arquivo: req.file.filename,
      mime: req.file.mimetype,
      tamanho: req.file.size,
    });
    res.status(201).json({ anexo });
  } catch (e) { next(e); }
});

module.exports = router;
