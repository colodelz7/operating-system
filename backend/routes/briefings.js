'use strict';

/**
 * Briefing de entrada do cliente. Qualquer pessoa logada preenche e consulta
 * (e trabalho de equipe); excluir fica com quem criou e com o admin.
 * As perguntas vem de services/briefing.js e so as chaves conhecidas sao
 * guardadas.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const { upload, apagarArquivo, caminhoSeguro } = require('../middleware/upload');
const { conferirAssinatura } = require('../middleware/assinaturaArquivo');
const { CAMPOS, CHAVES, limparRespostas, contarPreenchidos } = require('../services/briefing');
const v = require('../utils/validar');

const router = express.Router();
comIdValidado(router);
router.use(exigirLogin);

const campos = {
  empresa: z.any().transform((x) => v.texto(x, 200)).refine((s) => s.length > 0, 'Informe o nome da empresa'),
  cliente_id: z.any().transform((x) => v.inteiroOuNull(x)),
  respostas: z.any().transform(limparRespostas),
};
const criarSchema = z.object(campos);
const atualizarSchema = z.object(campos).partial();

// resumo para a lista (sem as respostas inteiras)
function resumo(b) {
  return {
    id: b.id, empresa: b.empresa, cliente_id: b.cliente_id, cliente_nome: b.cliente_nome, criado_por: b.criado_por,
    preenchidos: contarPreenchidos(b.respostas), total: CHAVES.length,
    atualizado_em: b.atualizado_em, atualizado_por_nome: b.atualizado_por_nome,
  };
}

async function clienteValido(id) {
  return id == null || !!(await repo.buscarCliente(id));
}

// GET /api/briefings/campos   (as perguntas; a tela monta o formulario disto)
router.get('/campos', (req, res) => res.json({ campos: CAMPOS }));

router.get('/', async (req, res, next) => {
  try { res.json({ briefings: (await repo.listarBriefings()).map(resumo) }); }
  catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const b = await repo.buscarBriefing(Number(req.params.id));
    if (!b) return res.status(404).json({ erro: 'Briefing não encontrado' });
    res.json({ briefing: b });
  } catch (e) { next(e); }
});

router.post('/', validate(criarSchema), async (req, res, next) => {
  try {
    if (!(await clienteValido(req.body.cliente_id))) return res.status(400).json({ erro: 'Cliente inválido' });
    const b = await repo.criarBriefing({ ...req.body, criado_por: req.usuario.id });
    await registrar(req, {
      tipo: 'criada', entidade: 'briefing', entidade_id: b.id, titulo: b.empresa,
      cliente_id: b.cliente_id, cliente_nome: b.cliente_nome || '', detalhe: 'criou o briefing',
    });
    res.status(201).json({ briefing: b });
  } catch (e) { next(e); }
});

router.put('/:id', validate(atualizarSchema), async (req, res, next) => {
  try {
    if ('cliente_id' in req.body && !(await clienteValido(req.body.cliente_id))) {
      return res.status(400).json({ erro: 'Cliente inválido' });
    }
    const b = await repo.atualizarBriefing(Number(req.params.id), { ...req.body, atualizado_por: req.usuario.id });
    if (!b) return res.status(404).json({ erro: 'Briefing não encontrado' });
    await registrar(req, {
      tipo: 'editada', entidade: 'briefing', entidade_id: b.id, titulo: b.empresa,
      cliente_id: b.cliente_id, cliente_nome: b.cliente_nome || '', detalhe: 'editou o briefing',
    });
    res.json({ briefing: b });
  } catch (e) { next(e); }
});

// ---- arquivos do briefing (logo, fotos, manual de marca, contrato) ----
const MAX_ARQUIVOS = 40;

// GET /api/briefings/arquivos/:arq   (baixa; imagem e PDF abrem na tela)
router.get('/arquivos/:arq', async (req, res, next) => {
  try {
    const id = /^\d{1,12}$/.test(req.params.arq) ? Number(req.params.arq) : null;
    const a = id && await repo.buscarArquivoBriefing(id);
    const destino = a ? caminhoSeguro(a.nome_arquivo) : null;
    if (!destino) return res.status(404).json({ erro: 'Arquivo não encontrado' });
    const nome = String(a.nome_original || 'arquivo');
    const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    const inline = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'].includes(a.mime);
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(destino, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (e) { next(e); }
});

// DELETE /api/briefings/arquivos/:arq   (quem enviou, quem criou o briefing ou admin)
router.delete('/arquivos/:arq', async (req, res, next) => {
  try {
    const id = /^\d{1,12}$/.test(req.params.arq) ? Number(req.params.arq) : null;
    const a = id && await repo.buscarArquivoBriefing(id);
    if (!a) return res.status(404).json({ erro: 'Arquivo não encontrado' });
    const b = await repo.buscarBriefing(a.briefing_id);
    const pode = req.usuario.papel === 'admin' || a.enviado_por === req.usuario.id || (b && b.criado_por === req.usuario.id);
    if (!pode) return res.status(403).json({ erro: 'Só quem enviou, quem criou o briefing ou o admin pode apagar' });
    await repo.excluirArquivoBriefing(a.id);
    apagarArquivo(a.nome_arquivo);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/briefings/:id/arquivos
router.get('/:id/arquivos', async (req, res, next) => {
  try {
    const b = await repo.buscarBriefing(Number(req.params.id));
    if (!b) return res.status(404).json({ erro: 'Briefing não encontrado' });
    res.json({ arquivos: await repo.listarArquivosBriefing(b.id) });
  } catch (e) { next(e); }
});

// POST /api/briefings/:id/arquivos   (campo "arquivo"; mesmas regras dos anexos de tarefa)
router.post('/:id/arquivos', async (req, res, next) => {
  // o briefing tem que existir ANTES de gravar qualquer coisa no disco
  try {
    const b = await repo.buscarBriefing(Number(req.params.id));
    if (!b) return res.status(404).json({ erro: 'Briefing não encontrado' });
    if ((await repo.listarArquivosBriefing(b.id)).length >= MAX_ARQUIVOS) {
      return res.status(400).json({ erro: `Um briefing guarda no máximo ${MAX_ARQUIVOS} arquivos` });
    }
    req.briefing = b;
    next();
  } catch (e) { next(e); }
}, upload.single('arquivo'), conferirAssinatura, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo' });
    const a = await repo.criarArquivoBriefing({
      briefing_id: req.briefing.id,
      nome_original: String(req.file.originalname || 'arquivo').slice(0, 200),
      nome_arquivo: req.file.filename, mime: req.file.mimetype, tamanho: req.file.size,
      enviado_por: req.usuario.id,
    });
    res.status(201).json({ arquivo: a });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const b = await repo.buscarBriefing(Number(req.params.id));
    if (!b) return res.status(404).json({ erro: 'Briefing não encontrado' });
    if (req.usuario.papel !== 'admin' && b.criado_por !== req.usuario.id) {
      return res.status(403).json({ erro: 'Só quem criou o briefing (ou o admin) pode excluí-lo' });
    }
    const r = await repo.excluirBriefing(b.id);
    (r && r.arquivos ? r.arquivos : []).forEach(apagarArquivo);
    await registrar(req, {
      tipo: 'excluida', entidade: 'briefing', entidade_id: b.id, titulo: b.empresa,
      cliente_id: b.cliente_id, cliente_nome: b.cliente_nome || '', detalhe: 'excluiu o briefing',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
