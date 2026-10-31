'use strict';

/**
 * Chat interno: grupos por assunto e conversa direta entre duas pessoas.
 *
 * Regra de ouro: so quem e membro da conversa le, escreve ou baixa anexo
 * dela. Nem o admin le conversa alheia (isto e conversa entre colegas, nao
 * trilha de auditoria). O aviso de mensagem nova vai pelo mesmo canal SSE
 * das notificacoes e, se a pessoa ativou, por push no aparelho.
 */

const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { comIdValidado } = require('../middleware/params');
const { upload, apagarArquivo, caminhoSeguro } = require('../middleware/upload');
const { conferirAssinatura } = require('../middleware/assinaturaArquivo');
const { chatRateLimit, limiteDeUpload, contarUpload } = require('../middleware/rateLimit');
const { avisarChat } = require('../services/eventos');
const push = require('../services/push');
const {
  criarConversaSchema, atualizarConversaSchema, mensagemSchema, lidaSchema, paginaMensagensSchema,
} = require('../schemas/chat.schema');

const router = express.Router();
comIdValidado(router);
router.use(exigirLogin);

const POR_PAGINA = 50;
const MAX_MEMBROS = 100;
// imagens aparecem na conversa; o resto e baixado
const EXIBIVEIS = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const ehMembro = (conversa, uid) => (conversa.membros || []).some((m) => m.id === uid);
const idsMembros = (conversa) => (conversa.membros || []).map((m) => m.id);

// Carrega a conversa e confere que quem pediu e membro. 404 para quem nao e:
// nao entrega nem que a conversa existe.
async function conversaDoUsuario(req, res) {
  const c = await repo.buscarConversa(Number(req.params.id), req.usuario.id);
  if (!c || !ehMembro(c, req.usuario.id)) {
    res.status(404).json({ erro: 'Conversa não encontrada' });
    return null;
  }
  return c;
}

// membros validos = colegas ativos
async function filtrarMembros(ids) {
  const equipe = new Set((await repo.listarEquipe()).map((u) => u.id));
  return Array.from(new Set(ids)).filter((id) => equipe.has(id));
}

function podeAdministrarGrupo(usuario, conversa) {
  return conversa.tipo === 'grupo' && (usuario.papel === 'admin' || conversa.criado_por === usuario.id);
}

// GET /api/chat/resumo  -> total de nao lidas (o numerinho do menu)
router.get('/resumo', async (req, res, next) => {
  try { res.json({ nao_lidas: await repo.contarChatNaoLidas(req.usuario.id) }); }
  catch (e) { next(e); }
});

// GET /api/chat/conversas
router.get('/conversas', async (req, res, next) => {
  try { res.json({ conversas: await repo.listarConversasDoUsuario(req.usuario.id) }); }
  catch (e) { next(e); }
});

// POST /api/chat/conversas
router.post('/conversas', validate(criarConversaSchema), async (req, res, next) => {
  try {
    const eu = req.usuario.id;
    if (req.body.tipo === 'direta') {
      const outro = req.body.usuario_id;
      if (outro === eu) return res.status(400).json({ erro: 'Escolha outra pessoa para conversar' });
      if (!(await filtrarMembros([outro])).length) return res.status(400).json({ erro: 'Pessoa não encontrada' });
      // conversa direta e unica por par: se ja existe, devolve a mesma
      const existente = await repo.buscarConversaDireta(eu, outro);
      if (existente) return res.json({ conversa: existente });
      // se a outra pessoa abriu no mesmo instante, a chave unica devolve a dela
      const c = await repo.criarConversa({ tipo: 'direta', nome: '', criado_por: eu, membros: [eu, outro] });
      const { ja_existia: jaExistia, ...conversa } = c;
      return res.status(jaExistia ? 200 : 201).json({ conversa });
    }

    const membros = await filtrarMembros([eu, ...req.body.membros]);
    if (membros.length > MAX_MEMBROS) return res.status(400).json({ erro: `Um grupo tem no máximo ${MAX_MEMBROS} pessoas` });
    const c = await repo.criarConversa({ tipo: 'grupo', nome: req.body.nome, criado_por: eu, membros });
    avisarChat({ conversa_id: c.id, membros });
    res.status(201).json({ conversa: c });
  } catch (e) { next(e); }
});

// PUT /api/chat/conversas/:id   (grupo: renomear e trocar membros)
router.put('/conversas/:id', validate(atualizarConversaSchema), async (req, res, next) => {
  try {
    const c = await conversaDoUsuario(req, res);
    if (!c) return;
    if (!podeAdministrarGrupo(req.usuario, c)) {
      return res.status(403).json({ erro: 'Só quem criou o grupo (ou o admin) pode alterá-lo' });
    }
    const d = {};
    if ('nome' in req.body) d.nome = req.body.nome;
    if ('membros' in req.body) {
      // quem esta alterando continua no grupo
      d.membros = await filtrarMembros([req.usuario.id, ...req.body.membros]);
      if (d.membros.length > MAX_MEMBROS) return res.status(400).json({ erro: `Um grupo tem no máximo ${MAX_MEMBROS} pessoas` });
    }
    const atualizada = await repo.atualizarConversa(c.id, d);
    // avisa quem estava e quem entrou
    avisarChat({ conversa_id: c.id, membros: Array.from(new Set([...idsMembros(c), ...idsMembros(atualizada)])) });
    res.json({ conversa: await repo.buscarConversa(c.id, req.usuario.id) });
  } catch (e) { next(e); }
});

// POST /api/chat/conversas/:id/sair   (sair de um grupo)
router.post('/conversas/:id/sair', async (req, res, next) => {
  try {
    const c = await conversaDoUsuario(req, res);
    if (!c) return;
    if (c.tipo !== 'grupo') return res.status(400).json({ erro: 'Só dá para sair de grupos' });
    await repo.removerMembroConversa(c.id, req.usuario.id);
    avisarChat({ conversa_id: c.id, membros: idsMembros(c) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/chat/conversas/:id   (apaga o grupo inteiro, com as mensagens)
router.delete('/conversas/:id', async (req, res, next) => {
  try {
    const c = await conversaDoUsuario(req, res);
    if (!c) return;
    if (!podeAdministrarGrupo(req.usuario, c)) {
      return res.status(403).json({ erro: 'Só quem criou o grupo (ou o admin) pode apagá-lo' });
    }
    const r = await repo.excluirConversa(c.id);
    (r && r.arquivos ? r.arquivos : []).forEach(apagarArquivo);
    avisarChat({ conversa_id: c.id, membros: idsMembros(c) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/chat/conversas/:id/mensagens?antes_de=ID
// Devolve em ordem cronologica (a mais nova por ultimo).
router.get('/conversas/:id/mensagens', validate(paginaMensagensSchema, 'query'), async (req, res, next) => {
  try {
    const c = await conversaDoUsuario(req, res);
    if (!c) return;
    const pagina = await repo.listarMensagens(c.id, { antesDe: req.query.antes_de, limit: POR_PAGINA + 1 });
    const temMais = pagina.length > POR_PAGINA;
    const mensagens = (temMais ? pagina.slice(0, POR_PAGINA) : pagina).reverse();
    res.json({ mensagens, tem_mais: temMais, conversa: c });
  } catch (e) { next(e); }
});

// POST /api/chat/conversas/:id/mensagens   (JSON { texto } ou multipart com "arquivo")
router.post('/conversas/:id/mensagens', chatRateLimit, async (req, res, next) => {
  // a checagem de membro vem ANTES do upload: quem nao e membro nao grava nada no disco
  try {
    const c = await conversaDoUsuario(req, res);
    if (!c) return;
    req.conversa = c;
    next();
  } catch (e) { next(e); }
}, limiteDeUpload, upload.single('arquivo'), conferirAssinatura, contarUpload, validate(mensagemSchema), async (req, res, next) => {
  try {
    const c = req.conversa;
    const texto = req.body.texto;
    if (!texto && !req.file) return res.status(400).json({ erro: 'Escreva uma mensagem ou anexe um arquivo' });

    const m = await repo.criarMensagem({
      conversa_id: c.id,
      usuario_id: req.usuario.id,
      texto,
      anexo_nome_original: req.file ? String(req.file.originalname || 'arquivo').slice(0, 200) : null,
      anexo_arquivo: req.file ? req.file.filename : null,
      anexo_mime: req.file ? req.file.mimetype : null,
      anexo_tamanho: req.file ? req.file.size : null,
    });

    const membros = idsMembros(c);
    avisarChat({ conversa_id: c.id, membros, mensagem_id: m.id });
    push.enviarPara(membros.filter((id) => id !== req.usuario.id), {
      titulo: c.tipo === 'grupo' ? `${req.usuario.nome} em ${c.nome}` : req.usuario.nome,
      corpo: texto || `enviou um arquivo: ${m.anexo_nome_original}`,
      url: `/chat?c=${c.id}`,
      tag: `chat-${c.id}`,
    }).catch(() => {});

    res.status(201).json({ mensagem: m });
  } catch (e) { next(e); }
});

// POST /api/chat/conversas/:id/lida   { ate_id }
router.post('/conversas/:id/lida', validate(lidaSchema), async (req, res, next) => {
  try {
    const c = await conversaDoUsuario(req, res);
    if (!c) return;
    await repo.marcarConversaLida(c.id, req.usuario.id, req.body.ate_id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/chat/anexos/:id   (id da MENSAGEM; imagem abre na tela, o resto baixa)
router.get('/anexos/:id', async (req, res, next) => {
  try {
    const m = await repo.buscarMensagem(Number(req.params.id));
    if (!m || !m.anexo_arquivo) return res.status(404).json({ erro: 'Arquivo não encontrado' });
    const c = await repo.buscarConversa(m.conversa_id, req.usuario.id);
    if (!c || !ehMembro(c, req.usuario.id)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
    const destino = caminhoSeguro(m.anexo_arquivo);
    if (!destino) return res.status(404).json({ erro: 'Arquivo não encontrado' });

    const nome = String(m.anexo_nome_original || 'arquivo');
    const inline = EXIBIVEIS.has(String(m.anexo_mime || '')) && req.query.baixar !== '1';
    // filename* aceita acento e emoji; o filename simples fica so com ASCII
    const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Type', m.anexo_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(destino, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (e) { next(e); }
});

module.exports = router;
