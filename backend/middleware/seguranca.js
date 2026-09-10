'use strict';

/**
 * Cabecalhos de seguranca aplicados a TODAS as respostas da API.
 *
 * Este servico e uma API JSON (o front e servido a parte), entao a CSP pode
 * ser bem restritiva: nada de script, estilo, imagem ou frame vindos daqui.
 */

const config = require('../config');

const CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",       // logos/anexos servidos pela propria API
  "connect-src 'self'",
  "sandbox",                     // conteudo servido daqui nunca executa nada
].join('; ');

const PERMISSIONS = [
  'accelerometer=()', 'autoplay=()', 'camera=()', 'display-capture=()',
  'encrypted-media=()', 'fullscreen=(self)', 'geolocation=()', 'gyroscope=()',
  'magnetometer=()', 'microphone=()', 'midi=()', 'payment=()',
  'picture-in-picture=()', 'usb=()', 'xr-spatial-tracking=()',
].join(', ');

function cabecalhosSeguranca(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', PERMISSIONS);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Resposta de API nunca deve ficar em cache compartilhado.
  res.setHeader('Cache-Control', 'no-store');

  // HSTS so faz sentido quando o trafego ja e HTTPS (producao atras do proxy).
  if (config.cookieSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/**
 * Checagem de origem nas escritas (reforco anti-CSRF).
 *
 * O cookie ja e sameSite=lax, o que sozinho barra POST vindo de outro site.
 * Esta e a segunda tranca: se o navegador mandou o cabecalho Origin (ele
 * manda em toda escrita), o host precisa ser o mesmo da requisicao. Compara
 * so o hostname, nao a porta, porque em desenvolvimento o front (5174) fala
 * com a API (3001) na mesma maquina.
 *
 * Requisicao sem Origin passa: e o caso de curl, dos testes e da chamada que
 * o proprio servidor faz quando o assistente executa uma acao.
 */
const METODOS_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function verificarOrigem(req, res, next) {
  if (!METODOS_ESCRITA.has(req.method)) return next();

  const origem = req.headers.origin;
  if (!origem) return next();

  let host;
  try { host = new URL(origem).hostname.toLowerCase(); } catch (_) { host = null; }
  if (!host) return res.status(403).json({ erro: 'Origem inválida' });

  const daCasa = host === String(req.hostname || '').toLowerCase();
  const liberada = config.origensPermitidas.includes(host)
    || config.origensPermitidas.includes(String(origem).toLowerCase());

  if (daCasa || liberada) return next();
  res.status(403).json({ erro: 'Origem não autorizada' });
}

module.exports = { cabecalhosSeguranca, verificarOrigem, CSP };
