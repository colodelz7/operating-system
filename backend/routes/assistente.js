'use strict';

/**
 * Assistente (ColodelBot dentro do sistema).
 *
 * O navegador manda a frase; quem fala com o modelo e executa acoes e o
 * servidor. A chave da API nunca sai daqui, e toda acao passa pelas mesmas
 * rotas (e permissoes) que as telas usam.
 */

const express = require('express');
const config = require('../config');
const { exigirLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { assistenteRateLimit } = require('../middleware/rateLimit');
const { mensagemSchema } = require('../schemas/assistente.schema');
const { conversar, conversarStream } = require('../services/assistente/gemini');

const router = express.Router();
router.use(exigirLogin);

// GET /api/assistente/status -> o front so mostra o botao se estiver de pe
router.get('/status', (req, res) => {
  res.json({ disponivel: !!config.geminiApiKey, modelo: config.geminiModel });
});

// POST /api/assistente  { mensagem, historico }
router.post('/', assistenteRateLimit, validate(mensagemSchema), async (req, res, next) => {
  try {
    const { resposta, acoes, falhas } = await conversar({
      mensagem: req.body.mensagem,
      historico: req.body.historico,
      req,
      usuario: req.usuario,
    });
    res.json({ resposta, acoes, falhas, mudou: acoes.length > 0 });
  } catch (e) {
    if (e.codigo === 'SEM_CHAVE') return res.status(503).json({ erro: e.message });
    console.error('[assistente]', e.status || '', e.message);

    // Mensagens honestas por tipo de falha: quem esta conversando precisa
    // saber se e para tentar de novo, se acabou a cota ou se e problema nosso.
    if (e.status === 429) {
      return res.status(429).json({ erro: 'A cota do modelo acabou por agora. Tente de novo em alguns minutos.' });
    }
    if (e.status === 503 || /high demand|overload/i.test(e.message || '')) {
      return res.status(503).json({ erro: 'O modelo está sobrecarregado neste momento. Tente de novo em alguns segundos.' });
    }
    if (e.status === 0) {
      return res.status(502).json({ erro: 'O servidor não conseguiu alcançar o modelo. Verifique a conexão.' });
    }
    res.status(502).json({ erro: 'Não consegui falar com o assistente agora. Tente de novo.' });
  }
});

/**
 * POST /api/assistente/stream  { mensagem, historico }
 *
 * Mesma conversa da rota acima, so que a resposta sai em pedacos: o texto vai
 * aparecendo enquanto o modelo escreve, e cada ferramenta executada vira um
 * aviso ("consultando clientes..."). Usa Server-Sent Events sobre POST, entao
 * o front le com fetch + ReadableStream (EventSource so faz GET).
 */
router.post('/stream', assistenteRateLimit, validate(mensagemSchema), async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const enviar = (evento, dados) => {
    if (res.writableEnded) return;
    res.write(`event: ${evento}\ndata: ${JSON.stringify(dados || {})}\n\n`);
  };

  // se a pessoa fechar a janela no meio, paramos de escrever
  let cancelado = false;
  req.on('close', () => { cancelado = true; });

  try {
    const { resposta, acoes, falhas } = await conversarStream({
      mensagem: req.body.mensagem,
      historico: req.body.historico,
      req,
      usuario: req.usuario,
      aoEvento: (tipo, dados) => { if (!cancelado) enviar(tipo, dados); },
    });
    enviar('fim', { resposta, acoes, falhas, mudou: acoes.length > 0 });
  } catch (e) {
    console.error('[assistente:stream]', e.status || '', e.message);
    const mensagem = e.codigo === 'SEM_CHAVE'
      ? e.message
      : (e.status === 429 ? 'A cota do modelo acabou por agora. Tente de novo em alguns minutos.'
        : (e.status === 503 ? 'O modelo está sobrecarregado neste momento. Tente de novo em alguns segundos.'
          : 'Não consegui falar com o assistente agora. Tente de novo.'));
    enviar('erro', { mensagem });
  } finally {
    res.end();
  }
});

module.exports = router;
