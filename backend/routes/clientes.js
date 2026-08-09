'use strict';

const path = require('path');
const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { upload, PASTA_UPLOADS } = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { criarClienteSchema, atualizarClienteSchema } = require('../schemas/cliente.schema');

const router = express.Router();

// GET /api/clientes/logo/:arquivo  -> serve a imagem da logo (logado)
router.get('/logo/:arquivo', exigirLogin, (req, res) => {
  const nome = path.basename(String(req.params.arquivo)); // evita path traversal
  res.sendFile(path.join(PASTA_UPLOADS, nome), (err) => {
    if (err) res.status(404).end();
  });
});

// GET /api/clientes  (qualquer usuario logado pode consultar)
router.get('/', exigirLogin, async (req, res, next) => {
  try { res.json({ clientes: await repo.listarClientes() }); }
  catch (e) { next(e); }
});

// GET /api/clientes/:id
router.get('/:id', exigirLogin, async (req, res, next) => {
  try {
    const c = await repo.buscarCliente(Number(req.params.id));
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json({ cliente: c });
  } catch (e) { next(e); }
});

// GET /api/clientes/:id/logo  -> serve a imagem do logo
router.get('/:id/logo', exigirLogin, async (req, res, next) => {
  try {
    const c = await repo.buscarCliente(Number(req.params.id));
    if (!c || !c.logo_path) return res.status(404).end();
    res.sendFile(path.join(PASTA_UPLOADS, c.logo_path));
  } catch (e) { next(e); }
});

// POST /api/clientes   (logo opcional no campo "logo")
// upload.single roda antes do validate para popular req.body (multipart).
router.post('/', exigirLogin, upload.single('logo'), validate(criarClienteSchema), async (req, res, next) => {
  try {
    const dados = { ...req.body };
    if (req.file) dados.logo_path = req.file.filename;
    const c = await repo.criarCliente(dados);
    res.status(201).json({ cliente: c });
  } catch (e) { next(e); }
});

// PUT /api/clientes/:id
router.put('/:id', exigirLogin, upload.single('logo'), validate(atualizarClienteSchema), async (req, res, next) => {
  try {
    const dados = { ...req.body };
    if (req.file) dados.logo_path = req.file.filename;
    const c = await repo.atualizarCliente(Number(req.params.id), dados);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json({ cliente: c });
  } catch (e) { next(e); }
});

// DELETE /api/clientes/:id  (somente admin)
router.delete('/:id', exigirLogin, async (req, res, next) => {
  try {
    if (req.usuario.papel !== 'admin') {
      return res.status(403).json({ erro: 'Apenas o Atendimento pode excluir clientes' });
    }
    const ok = await repo.excluirCliente(Number(req.params.id));
    if (!ok) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
