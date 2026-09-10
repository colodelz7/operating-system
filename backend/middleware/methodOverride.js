'use strict';

/**
 * Restaura o metodo HTTP real a partir do cabecalho X-HTTP-Method-Override.
 *
 * Por que existe: o WAF de algumas hospedagens bloqueia PUT/PATCH/DELETE com
 * 403 antes de chegar no Node. O front entao envia essas escritas como POST
 * com o metodo verdadeiro no cabecalho, e aqui o metodo volta ao original -
 * caso contrario router.put/patch/delete nunca casariam com a requisicao.
 *
 * Regras (deliberadamente estreitas):
 *  - so age quando a requisicao chegou como POST;
 *  - so aceita PUT, PATCH e DELETE (nunca GET/HEAD/OPTIONS, para o override
 *    nao virar um jeito de burlar CSRF/cache/preflight);
 *  - qualquer outro valor e ignorado (a requisicao segue como POST).
 *
 * Deve rodar ANTES das rotas e depois dos parsers de corpo.
 */

const PERMITIDOS = new Set(['PUT', 'PATCH', 'DELETE']);

function methodOverride(req, res, next) {
  if (req.method !== 'POST') return next();

  const bruto = req.headers['x-http-method-override'];
  if (!bruto) return next();

  const alvo = String(Array.isArray(bruto) ? bruto[0] : bruto).toUpperCase().trim();
  if (!PERMITIDOS.has(alvo)) return next();

  req.metodoOriginal = req.method;
  req.method = alvo;
  next();
}

module.exports = { methodOverride, METODOS_PERMITIDOS: PERMITIDOS };
