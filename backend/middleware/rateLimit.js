'use strict';

/**
 * Rate limit do login. Mitiga forca bruta limitando tentativas por IP.
 * Janela e teto configuraveis via .env (LOGIN_RATE_WINDOW_MS / LOGIN_RATE_MAX).
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const loginRateLimit = rateLimit({
  windowMs: config.loginRateWindowMs,
  max: config.loginRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  // conta so as tentativas que falharam (login OK nao gasta cota)
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

// Teto de mensagens do assistente, por usuario logado (a chamada ao modelo
// custa dinheiro e tempo). Cai para o IP se, por algum motivo, nao houver
// sessao.
const assistenteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: config.assistenteMaxPorMinuto,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'u' + ((req.session && req.session.usuarioId) || req.ip),
  message: { erro: 'Muitas mensagens seguidas para o assistente. Respire e tente de novo em um minuto.' },
});

// Chat: folga para conversa normal, trava quem dispara mensagem em loop.
const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'u' + ((req.session && req.session.usuarioId) || req.ip),
  message: { erro: 'Muitas mensagens em sequência. Aguarde um instante.' },
});

// Cofre: revelar senha e coisa rara; muitas seguidas e sinal de raspagem.
const cofreRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'u' + ((req.session && req.session.usuarioId) || req.ip),
  message: { erro: 'Muitas senhas abertas em pouco tempo. Aguarde alguns minutos.' },
});

module.exports = { loginRateLimit, assistenteRateLimit, chatRateLimit, cofreRateLimit };
