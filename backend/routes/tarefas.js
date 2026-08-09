'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin, exigirAdmin, podeAcessarSetor } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { criarTarefaSchema, atualizarTarefaSchema, moverTarefaSchema } = require('../schemas/tarefa.schema');
const v = require('../utils/validar');

const router = express.Router();

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
  await repo.criarNotificacao({
    tipo: 'urgente',
    prioridade: 'urgente',
    setor_id: tarefa.setor_id,
    tarefa_id: tarefa.id,
    titulo: `Urgente · ${nome}`,
    mensagem: `Tarefa urgente: "${tarefa.titulo}"${tarefa.cliente_nome ? ' — cliente ' + tarefa.cliente_nome : ''}. Priorize o quanto antes.`,
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
    const historico = await repo.listarHistorico({ limit: 300 });
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
    });

    // avisa o setor: nova demanda criada
    const nomeSet = await nomeSetor(setorId);
    await repo.criarNotificacao({
      tipo: 'nova_demanda',
      setor_id: setorId,
      tarefa_id: nova.id,
      titulo: `Nova demanda · ${nomeSet}`,
      mensagem: `"${nova.titulo}"${nova.cliente_nome ? ' — cliente ' + nova.cliente_nome : ''}${nova.data_entrega ? ' · entrega ' + nova.data_entrega : ''}.`,
    });
    if (nova.prioridade === 'urgente') await notificarUrgente(nova);

    await repo.registrarHistorico({
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
    if ('responsaveis' in req.body) {
      dados.responsaveis = await filtrarResponsaveisDoSetor(req.body.responsaveis, atual.setor_id);
    }
    const t = await repo.atualizarTarefa(atual.id, dados);
    if (dados.prioridade === 'urgente' && atual.prioridade !== 'urgente') {
      await notificarUrgente(t);
    }
    await repo.registrarHistorico({
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
      await repo.criarNotificacao({
        tipo: 'tarefa_concluida',
        titulo: `Tarefa concluída · ${nomeSetor}`,
        mensagem: `O setor ${nomeSetor} finalizou "${resultado.tarefa.titulo}"${resultado.tarefa.cliente_nome ? ' — cliente ' + resultado.tarefa.cliente_nome : ''}.`,
        tarefa_id: resultado.tarefa.id,
      });
    }
    await repo.registrarHistorico({
      tipo: resultado.concluiuAgora ? 'concluida' : 'movida',
      tarefa_id: resultado.tarefa.id, titulo: resultado.tarefa.titulo, setor_id: resultado.tarefa.setor_id,
      usuario_id: req.usuario.id, usuario_nome: req.usuario.nome,
      cliente_id: resultado.tarefa.cliente_id, cliente_nome: resultado.tarefa.cliente_nome,
      responsaveis: resultado.tarefa.responsaveis || [],
      detalhe: resultado.concluiuAgora ? 'concluiu a tarefa' : `moveu para "${resultado.tarefa.coluna_nome}"`,
    });

    res.json({ tarefa: resultado.tarefa });
  } catch (e) { next(e); }
});

// DELETE /api/tarefas/:id   (apenas admin)
router.delete('/:id', exigirLogin, exigirAdmin, async (req, res, next) => {
  try {
    const atual = await repo.buscarTarefa(Number(req.params.id));
    if (!atual) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    await repo.excluirTarefa(atual.id);
    await repo.registrarHistorico({
      tipo: 'excluida', tarefa_id: atual.id, titulo: atual.titulo, setor_id: atual.setor_id,
      usuario_id: req.usuario.id, usuario_nome: req.usuario.nome,
      cliente_id: atual.cliente_id, cliente_nome: atual.cliente_nome, responsaveis: atual.responsaveis || [],
      detalhe: 'excluiu a tarefa',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/tarefas/:id/anexos   (multipart: campo "arquivo")
router.post('/:id/anexos', exigirLogin, upload.single('arquivo'), async (req, res, next) => {
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
