'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin, exigirGestaoDeClientes } = require('../middleware/auth');
const { upload, caminhoSeguro } = require('../middleware/upload');
const { conferirAssinatura } = require('../middleware/assinaturaArquivo');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const { criarClienteSchema, atualizarClienteSchema } = require('../schemas/cliente.schema');

const router = express.Router();
// :id sempre numerico (nunca chega NaN no banco)
comIdValidado(router);

// GET /api/clientes/logo/:arquivo  -> serve a imagem da logo (logado)
router.get('/logo/:arquivo', exigirLogin, (req, res) => {
  // caminhoSeguro recusa qualquer nome que tente sair da pasta de uploads
  const destino = caminhoSeguro(req.params.arquivo);
  if (!destino) return res.status(400).json({ erro: 'Arquivo inválido' });
  res.sendFile(destino, (err) => { if (err) res.status(404).end(); });
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
    const destino = caminhoSeguro(c.logo_path);
    if (!destino) return res.status(404).end();
    res.sendFile(destino);
  } catch (e) { next(e); }
});

// POST /api/clientes   (logo opcional no campo "logo")
// upload.single roda antes do validate para popular req.body (multipart).
router.post('/', exigirLogin, exigirGestaoDeClientes, upload.single('logo'), conferirAssinatura, validate(criarClienteSchema), async (req, res, next) => {
  try {
    const dados = { ...req.body };
    if (req.file) dados.logo_path = req.file.filename;
    const c = await repo.criarCliente(dados);
    await registrar(req, {
      tipo: 'criada', entidade: 'cliente', entidade_id: c.id, titulo: c.empresa,
      cliente_id: c.id, cliente_nome: c.empresa, detalhe: 'cadastrou o cliente',
    });
    res.status(201).json({ cliente: c });
  } catch (e) { next(e); }
});

// PUT /api/clientes/:id
router.put('/:id', exigirLogin, exigirGestaoDeClientes, upload.single('logo'), conferirAssinatura, validate(atualizarClienteSchema), async (req, res, next) => {
  try {
    const dados = { ...req.body };
    if (req.file) dados.logo_path = req.file.filename;
    const c = await repo.atualizarCliente(Number(req.params.id), dados);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    await registrar(req, {
      tipo: 'editada', entidade: 'cliente', entidade_id: c.id, titulo: c.empresa,
      cliente_id: c.id, cliente_nome: c.empresa,
      detalhe: `editou o cliente (${Object.keys(dados).join(', ') || 'sem alteração'})`,
    });
    res.json({ cliente: c });
  } catch (e) { next(e); }
});

// DELETE /api/clientes/:id  (somente admin)
router.delete('/:id', exigirLogin, async (req, res, next) => {
  try {
    if (req.usuario.papel !== 'admin') {
      return res.status(403).json({ erro: 'Apenas o Atendimento pode excluir clientes' });
    }
    const id = Number(req.params.id);
    const alvo = await repo.buscarCliente(id);
    const ok = await repo.excluirCliente(id);
    if (!ok) return res.status(404).json({ erro: 'Cliente não encontrado' });
    await registrar(req, {
      tipo: 'excluida', entidade: 'cliente', entidade_id: id,
      titulo: alvo ? alvo.empresa : ('Cliente ' + id),
      cliente_id: id, cliente_nome: alvo ? alvo.empresa : '',
      detalhe: 'excluiu o cliente',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
