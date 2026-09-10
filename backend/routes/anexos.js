'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin, podeAcessarSetor } = require('../middleware/auth');
const { comIdValidado } = require('../middleware/params');
const { caminhoSeguro } = require('../middleware/upload');

const router = express.Router();
// :id sempre numerico (nunca chega NaN no banco)
comIdValidado(router);

// Tipos que o navegador pode exibir na propria pagina com seguranca.
// SVG fica de fora de proposito: e um documento que pode carregar script.
const VISUALIZAVEIS = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
]);

// Carrega o anexo conferindo o acesso de quem pediu.
async function anexoPermitido(req, res) {
  const anexo = await repo.buscarAnexo(Number(req.params.id));
  if (!anexo) { res.status(404).json({ erro: 'Anexo não encontrado' }); return null; }

  const tarefa = await repo.buscarTarefa(anexo.tarefa_id);
  if (!tarefa || !podeAcessarSetor(req.usuario, tarefa.setor_id)) {
    res.status(403).json({ erro: 'Sem acesso' });
    return null;
  }
  const destino = caminhoSeguro(anexo.nome_arquivo);
  if (!destino) { res.status(404).json({ erro: 'Anexo não encontrado' }); return null; }
  return { anexo, destino };
}

// GET /api/anexos/:id  -> baixa o arquivo com o nome original
router.get('/:id', exigirLogin, async (req, res, next) => {
  try {
    const ok = await anexoPermitido(req, res);
    if (!ok) return;
    res.download(ok.destino, ok.anexo.nome_original);
  } catch (e) { next(e); }
});

/**
 * GET /api/anexos/:id/preview -> mostra o arquivo na propria tela.
 *
 * Diferenca para a rota de cima: aqui vai "inline", para a imagem aparecer
 * dentro do modal em vez de baixar. So para os tipos que o navegador exibe
 * com seguranca; o resto continua sendo download.
 */
router.get('/:id/preview', exigirLogin, async (req, res, next) => {
  try {
    const ok = await anexoPermitido(req, res);
    if (!ok) return;

    const mime = String(ok.anexo.mime || '');
    if (!VISUALIZAVEIS.has(mime)) {
      return res.status(415).json({ erro: 'Este tipo de arquivo não tem pré-visualização' });
    }

    res.setHeader('Content-Type', mime);
    // nome entre aspas e sem quebra de linha: cabecalho nao aceita
    const nome = String(ok.anexo.nome_original || 'arquivo').replace(/["\r\n]/g, '');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    // cache curto e privado: o arquivo e de dentro do sistema
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(ok.destino, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (e) { next(e); }
});

module.exports = router;
