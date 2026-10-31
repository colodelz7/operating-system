'use strict';

/**
 * Limites de frequencia e cota de upload.
 *
 * A contagem fica no repositorio (tabela limites_uso no Postgres), e nao na
 * memoria do processo: assim reiniciar a API nao zera o limite, duas
 * instancias contam juntas e a soma e atomica no banco.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');
const repo = require('../data');
const { apagarArquivo } = require('./upload');

/**
 * Store do express-rate-limit que guarda a contagem no repositorio.
 * Cada limitador tem o seu prefixo, para as chaves nao se misturarem.
 */
class StoreNoBanco {
  constructor(prefixo) {
    this.prefix = prefixo;
    this.localKeys = false;
  }

  init(opcoes) { this.janelaMs = opcoes.windowMs; }

  async increment(chave) {
    const r = await repo.somarUso(this.prefix + chave, 1, this.janelaMs);
    return { totalHits: r.contador, resetTime: new Date(r.reinicia_em) };
  }

  async decrement(chave) {
    await repo.somarUso(this.prefix + chave, -1, this.janelaMs);
  }

  async resetKey(chave) {
    await repo.zerarUso(this.prefix + chave);
  }
}

// chave por pessoa logada; cai para o IP se, por algum motivo, nao houver sessao
const porUsuario = (req) => 'u' + ((req.session && req.session.usuarioId) || req.ip);

const loginRateLimit = rateLimit({
  windowMs: config.loginRateWindowMs,
  max: config.loginRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: new StoreNoBanco('rl-login:'),
  // conta so as tentativas que falharam (login OK nao gasta cota)
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

// Teto de mensagens do assistente, por usuario logado (a chamada ao modelo
// custa dinheiro e tempo).
const assistenteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: config.assistenteMaxPorMinuto,
  standardHeaders: true,
  legacyHeaders: false,
  store: new StoreNoBanco('rl-assistente:'),
  keyGenerator: porUsuario,
  message: { erro: 'Muitas mensagens seguidas para o assistente. Respire e tente de novo em um minuto.' },
});

// Chat: folga para conversa normal, trava quem dispara mensagem em loop.
const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: new StoreNoBanco('rl-chat:'),
  keyGenerator: porUsuario,
  message: { erro: 'Muitas mensagens em sequência. Aguarde um instante.' },
});

// Cofre: revelar senha e coisa rara; muitas seguidas e sinal de raspagem.
const cofreRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: new StoreNoBanco('rl-cofre:'),
  keyGenerator: porUsuario,
  message: { erro: 'Muitas senhas abertas em pouco tempo. Aguarde alguns minutos.' },
});

// ---------------- cota de upload por pessoa ----------------
// Sem isto, uma conta logada enchia o disco do servidor (o chat sozinho
// aceitava 60 arquivos de 25MB por minuto).
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const chaveQtd = (req) => `upload-qtd:${porUsuario(req)}`;
const chaveBytes = (req) => `upload-bytes:${porUsuario(req)}`;
const mb = (b) => Math.round(b / (1024 * 1024));

/**
 * Antes de gravar: confere quantos arquivos a pessoa mandou na ultima hora e
 * se ainda tem espaco no dia. Vem ANTES do multer, para o arquivo recusado
 * nem chegar ao disco. Requisicao sem arquivo (so texto) passa direto.
 */
async function limiteDeUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  try {
    const usados = await repo.lerUso(chaveBytes(req));
    if (usados && usados.contador >= config.uploadCotaDiariaBytes) {
      return res.status(429).json({ erro: `Você atingiu o limite de ${mb(config.uploadCotaDiariaBytes)}MB de arquivos enviados hoje.` });
    }
    const qtd = await repo.somarUso(chaveQtd(req), 1, HORA);
    if (qtd.contador > config.uploadMaxPorHora) {
      return res.status(429).json({ erro: `Limite de ${config.uploadMaxPorHora} arquivos por hora atingido. Aguarde um pouco.` });
    }
    next();
  } catch (e) { next(e); }
}

/**
 * Depois de aceito: soma o tamanho real na cota do dia. Se este arquivo
 * estourou a cota, ele e apagado e a requisicao recusada.
 */
async function contarUpload(req, res, next) {
  if (!req.file) return next();
  try {
    const total = await repo.somarUso(chaveBytes(req), req.file.size, DIA);
    if (total.contador > config.uploadCotaDiariaBytes) {
      await repo.somarUso(chaveBytes(req), -req.file.size, DIA);
      apagarArquivo(req.file.filename);
      req.file = undefined;
      return res.status(429).json({ erro: `Este arquivo passa do limite de ${mb(config.uploadCotaDiariaBytes)}MB enviados por dia.` });
    }
    next();
  } catch (e) { next(e); }
}

module.exports = {
  loginRateLimit, assistenteRateLimit, chatRateLimit, cofreRateLimit,
  limiteDeUpload, contarUpload, StoreNoBanco,
};
