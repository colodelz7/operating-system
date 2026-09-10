/* ============================================================
   Validacao do endereco do calendario incorporado.

   O endereco vem de quem usa o sistema (campo livre) e vai parar no src de
   um <iframe>. Sem validar, daria para colar javascript:, data: ou um site
   qualquer e executar coisa dentro da nossa pagina. Entao: so https e so
   dominio de calendario conhecido.
   ============================================================ */

// Dominios aceitos (o proprio host ou qualquer subdominio dele).
export const DOMINIOS_CALENDARIO = [
  'calendar.google.com',
  'calendar.google.com.br',
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.live.com',
  'calendar.yahoo.com',
  'app.cal.com',
];

export const MSG_URL_INVALIDA =
  'Endereço não aceito. Cole o link de "Incorporar" (src) de um calendário em https, '
  + 'de um destes serviços: ' + DOMINIOS_CALENDARIO.join(', ') + '.';

function hostPermitido(host) {
  const h = String(host || '').toLowerCase();
  return DOMINIOS_CALENDARIO.some((d) => h === d || h.endsWith('.' + d));
}

/**
 * Devolve a URL normalizada se for aceitavel, ou null se nao for.
 * Recusa qualquer esquema que nao seja https (inclusive javascript:, data:,
 * blob: e http sem TLS) e qualquer dominio fora da lista.
 */
export function validarUrlCalendario(valor) {
  const bruto = String(valor || '').trim();
  if (!bruto) return null;
  let u;
  try { u = new URL(bruto); } catch (_) { return null; }
  if (u.protocol !== 'https:') return null;
  if (!hostPermitido(u.hostname)) return null;
  return u.toString();
}

export default validarUrlCalendario;
