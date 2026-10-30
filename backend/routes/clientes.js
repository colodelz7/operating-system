'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin, exigirGestaoDeClientes } = require('../middleware/auth');
const { upload, caminhoSeguro } = require('../middleware/upload');
const { conferirAssinatura } = require('../middleware/assinaturaArquivo');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const {
  criarClienteSchema, atualizarClienteSchema, servicoClienteSchema, dataClienteSchema,
} = require('../schemas/cliente.schema');

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

// GET /api/clientes/datas   (datas importantes de todos os clientes, para a
// aba Datas Comemorativas) -> tem que vir ANTES de /:id
router.get('/datas', exigirLogin, async (req, res, next) => {
  try { res.json({ datas: await repo.listarDatasDeClientes() }); }
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

// ---- servicos contratados e datas importantes (salvos na hora, pela ficha) ----
const idValido = (x) => (/^\d{1,12}$/.test(String(x)) ? Number(x) : null);
const DIAS_NO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 29/02 vale: repete todo ano

async function clienteDaRota(req, res) {
  const c = await repo.buscarCliente(Number(req.params.id));
  if (!c) res.status(404).json({ erro: 'Cliente não encontrado' });
  return c;
}

// POST /api/clientes/:id/servicos   { nome }
router.post('/:id/servicos', exigirLogin, exigirGestaoDeClientes, validate(servicoClienteSchema), async (req, res, next) => {
  try {
    const c = await clienteDaRota(req, res);
    if (!c) return;
    const s = await repo.criarServicoCliente(c.id, req.body.nome);
    if (!s) return res.status(409).json({ erro: 'Esse serviço já está no cliente' });
    await registrar(req, {
      tipo: 'editada', entidade: 'cliente', entidade_id: c.id, titulo: c.empresa,
      cliente_id: c.id, cliente_nome: c.empresa, detalhe: `adicionou o serviço "${s.nome}"`,
    });
    res.status(201).json({ servico: s });
  } catch (e) { next(e); }
});

// DELETE /api/clientes/:id/servicos/:sid
router.delete('/:id/servicos/:sid', exigirLogin, exigirGestaoDeClientes, async (req, res, next) => {
  try {
    const sid = idValido(req.params.sid);
    if (sid === null) return res.status(400).json({ erro: 'Identificador inválido' });
    const c = await clienteDaRota(req, res);
    if (!c) return;
    const s = (c.servicos || []).find((x) => x.id === sid);
    if (!s || !(await repo.excluirServicoCliente(c.id, sid))) return res.status(404).json({ erro: 'Serviço não encontrado' });
    await registrar(req, {
      tipo: 'editada', entidade: 'cliente', entidade_id: c.id, titulo: c.empresa,
      cliente_id: c.id, cliente_nome: c.empresa, detalhe: `removeu o serviço "${s.nome}"`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/clientes/:id/datas   { data: 'AAAA-MM-DD', nome }  (vale so dia e mes)
router.post('/:id/datas', exigirLogin, exigirGestaoDeClientes, validate(dataClienteSchema), async (req, res, next) => {
  try {
    const [, mes, dia] = req.body.data.split('-').map(Number);
    if (!mes || mes > 12 || !dia || dia > DIAS_NO_MES[mes - 1]) return res.status(400).json({ erro: 'Data inválida' });
    const c = await clienteDaRota(req, res);
    if (!c) return;
    const d = await repo.criarDataCliente(c.id, { mes, dia, nome: req.body.nome });
    await registrar(req, {
      tipo: 'editada', entidade: 'cliente', entidade_id: c.id, titulo: c.empresa,
      cliente_id: c.id, cliente_nome: c.empresa,
      detalhe: `adicionou a data "${d.nome}" (${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')})`,
    });
    res.status(201).json({ data: d });
  } catch (e) { next(e); }
});

// DELETE /api/clientes/:id/datas/:did
router.delete('/:id/datas/:did', exigirLogin, exigirGestaoDeClientes, async (req, res, next) => {
  try {
    const did = idValido(req.params.did);
    if (did === null) return res.status(400).json({ erro: 'Identificador inválido' });
    const c = await clienteDaRota(req, res);
    if (!c) return;
    const d = (c.datas || []).find((x) => x.id === did);
    if (!d || !(await repo.excluirDataCliente(c.id, did))) return res.status(404).json({ erro: 'Data não encontrada' });
    await registrar(req, {
      tipo: 'editada', entidade: 'cliente', entidade_id: c.id, titulo: c.empresa,
      cliente_id: c.id, cliente_nome: c.empresa, detalhe: `removeu a data "${d.nome}"`,
    });
    res.json({ ok: true });
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
