'use strict';

/**
 * Textos salvos, em dois sabores com a mesma cara:
 *
 *   /api/prompts           tipo 'prompt'   biblioteca da equipe: todos leem
 *                          e criam; edita/exclui quem criou ou o admin.
 *   /api/mensagens-salvas  tipo 'mensagem' respostas prontas PESSOAIS: cada
 *                          um ve e mexe so nas suas (nem o admin ve as dos
 *                          outros).
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const v = require('../utils/validar');

const textoSchema = z.object({
  titulo: z.any().transform((x) => v.texto(x, 150)).refine((s) => s.length > 0, 'Informe o título'),
  conteudo: z.any().transform((x) => v.texto(x, 20000)),
});

module.exports = function rotasDeTextos(tipo) {
  const pessoal = tipo === 'mensagem';
  const router = express.Router();
  comIdValidado(router);
  router.use(exigirLogin);

  // pessoal: so o dono, e 404 para os outros (nao entrega que existe)
  async function carregar(req, res) {
    const t = await repo.buscarTexto(Number(req.params.id));
    if (!t || t.tipo !== tipo || (pessoal && t.usuario_id !== req.usuario.id)) {
      res.status(404).json({ erro: 'Não encontrado' });
      return null;
    }
    return t;
  }

  function podeAlterar(usuario, t) {
    if (pessoal) return t.usuario_id === usuario.id;
    return usuario.papel === 'admin' || t.usuario_id === usuario.id;
  }

  // so os prompts (da equipe) entram na trilha; mensagem pessoal e privada
  function auditar(req, t, acao, detalhe) {
    if (pessoal) return Promise.resolve();
    return registrar(req, { tipo: acao, entidade: 'prompt', entidade_id: t.id, titulo: t.titulo, detalhe });
  }

  router.get('/', async (req, res, next) => {
    try {
      const itens = await repo.listarTextos({ tipo, usuarioId: pessoal ? req.usuario.id : null });
      res.json({ itens });
    } catch (e) { next(e); }
  });

  router.post('/', validate(textoSchema), async (req, res, next) => {
    try {
      const t = await repo.criarTexto({ tipo, usuario_id: req.usuario.id, ...req.body });
      await auditar(req, t, 'criada', 'criou o prompt');
      res.status(201).json({ item: t });
    } catch (e) { next(e); }
  });

  router.put('/:id', validate(textoSchema), async (req, res, next) => {
    try {
      const atual = await carregar(req, res);
      if (!atual) return;
      if (!podeAlterar(req.usuario, atual)) return res.status(403).json({ erro: 'Só quem criou (ou o admin) pode alterar' });
      const t = await repo.atualizarTexto(atual.id, req.body);
      await auditar(req, t, 'editada', 'editou o prompt');
      res.json({ item: t });
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const atual = await carregar(req, res);
      if (!atual) return;
      if (!podeAlterar(req.usuario, atual)) return res.status(403).json({ erro: 'Só quem criou (ou o admin) pode excluir' });
      await repo.excluirTexto(atual.id);
      await auditar(req, atual, 'excluida', 'excluiu o prompt');
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
};
