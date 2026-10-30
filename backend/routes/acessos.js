'use strict';

/**
 * Cofre de acessos dos clientes (logins de painel, hospedagem, redes...).
 *
 * Travas:
 *  - so admin entra aqui;
 *  - a senha fica cifrada no banco (services/cofre.js) e NUNCA vem na
 *    listagem: para ver, e preciso pedir uma por uma em /:id/revelar;
 *  - cada senha revelada vira registro na trilha de auditoria (quem, quando,
 *    de qual IP), e o pedido tem limite de frequencia;
 *  - sem COFRE_CHAVE no .env, o cofre inteiro responde 503 em vez de guardar
 *    senha em texto puro.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../data');
const { exigirLogin, exigirAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const { cofreRateLimit } = require('../middleware/rateLimit');
const { cofreAtivo, cifrar, decifrar } = require('../services/cofre');
const v = require('../utils/validar');

const router = express.Router();
comIdValidado(router);
router.use(exigirLogin, exigirAdmin);

router.use((req, res, next) => {
  if (cofreAtivo()) return next();
  res.status(503).json({
    erro: 'Cofre desligado: defina COFRE_CHAVE no .env do servidor (32 bytes em base64).',
    cofre_desligado: true,
  });
});

// so http(s); o resto (javascript:, data:...) vira vazio
const zUrl = z.any().transform((x) => {
  const s = v.texto(x, 500);
  if (!s) return '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '';
  } catch (_) { return ''; }
});

const campos = {
  servico: z.any().transform((x) => v.texto(x, 150)).refine((s) => s.length > 0, 'Informe o serviço (ex.: Hospedagem, Instagram)'),
  cliente_id: z.any().transform((x) => v.inteiroOuNull(x)),
  url: zUrl,
  login: z.any().transform((x) => v.texto(x, 200)),
  // senha: undefined = nao mexe; '' = apaga; texto = troca
  senha: z.any().transform((x) => (x === undefined || x === null ? undefined : String(x).slice(0, 500))),
  observacoes: z.any().transform((x) => v.texto(x, 2000)),
};
const criarSchema = z.object(campos);
const atualizarSchema = z.object(campos).partial();

async function clienteValido(id) {
  return id == null || !!(await repo.buscarCliente(id));
}

function dadosParaGravar(body) {
  const d = {};
  ['servico', 'cliente_id', 'url', 'login', 'observacoes'].forEach((k) => { if (k in body) d[k] = body[k]; });
  if (body.senha !== undefined) d.senha_cifrada = body.senha ? cifrar(body.senha) : null;
  return d;
}

router.get('/', async (req, res, next) => {
  try { res.json({ acessos: await repo.listarAcessos() }); }
  catch (e) { next(e); }
});

router.post('/', validate(criarSchema), async (req, res, next) => {
  try {
    if (!(await clienteValido(req.body.cliente_id))) return res.status(400).json({ erro: 'Cliente inválido' });
    const a = await repo.criarAcesso({ ...dadosParaGravar(req.body), criado_por: req.usuario.id });
    await registrar(req, {
      tipo: 'criada', entidade: 'acesso', entidade_id: a.id, titulo: a.servico,
      cliente_id: a.cliente_id, cliente_nome: a.cliente_nome || '', detalhe: 'guardou um acesso no cofre',
    });
    res.status(201).json({ acesso: a });
  } catch (e) { next(e); }
});

router.put('/:id', validate(atualizarSchema), async (req, res, next) => {
  try {
    if ('cliente_id' in req.body && !(await clienteValido(req.body.cliente_id))) {
      return res.status(400).json({ erro: 'Cliente inválido' });
    }
    const d = dadosParaGravar(req.body);
    const a = await repo.atualizarAcesso(Number(req.params.id), d);
    if (!a) return res.status(404).json({ erro: 'Acesso não encontrado' });
    // a senha nunca entra no detalhe: registra so QUE mudou
    const mudou = Object.keys(d).map((k) => (k === 'senha_cifrada' ? 'senha' : k));
    await registrar(req, {
      tipo: 'editada', entidade: 'acesso', entidade_id: a.id, titulo: a.servico,
      cliente_id: a.cliente_id, cliente_nome: a.cliente_nome || '',
      detalhe: `editou o acesso (${mudou.join(', ') || 'sem alteração'})`,
    });
    res.json({ acesso: a });
  } catch (e) { next(e); }
});

// POST (e nao GET) de proposito: nao fica em historico do navegador, em
// cache nem em log de proxy, e passa pela checagem de origem das escritas.
router.post('/:id/revelar', cofreRateLimit, async (req, res, next) => {
  try {
    const a = await repo.buscarAcesso(Number(req.params.id));
    if (!a) return res.status(404).json({ erro: 'Acesso não encontrado' });
    const guardada = await repo.lerSenhaCifrada(a.id);
    if (!guardada) return res.json({ senha: '' });
    let senha;
    try { senha = decifrar(guardada); }
    catch (_) {
      return res.status(500).json({ erro: 'Não foi possível abrir esta senha (a COFRE_CHAVE mudou?)' });
    }
    await registrar(req, {
      tipo: 'senha_vista', entidade: 'acesso', entidade_id: a.id, titulo: a.servico,
      cliente_id: a.cliente_id, cliente_nome: a.cliente_nome || '', detalhe: 'abriu a senha do cofre',
    });
    res.json({ senha });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const a = await repo.buscarAcesso(Number(req.params.id));
    if (!a) return res.status(404).json({ erro: 'Acesso não encontrado' });
    await repo.excluirAcesso(a.id);
    await registrar(req, {
      tipo: 'excluida', entidade: 'acesso', entidade_id: a.id, titulo: a.servico,
      cliente_id: a.cliente_id, cliente_nome: a.cliente_nome || '', detalhe: 'excluiu o acesso do cofre',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
