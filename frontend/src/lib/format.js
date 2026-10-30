/* Helpers de formatacao (portados do front antigo). Em JSX o React
   ja escapa texto, entao "escapar" nao e mais necessario. */

export function iniciais(nome) {
  return String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export function formatarData(iso) {
  if (!iso) return '';
  const [, m, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${m}`;
}

export function formatarDataLonga(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// duracao legivel a partir de milissegundos (ex.: "2d 4h", "3h 12min", "8min")
export function formatarDuracao(ms) {
  if (!ms || ms <= 0) return '-';
  const min = Math.floor(ms / 60000);
  const dias = Math.floor(min / 1440);
  const horas = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${mins}min`;
  return `${mins}min`;
}

export function formatarQuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// Data local em 'YYYY-MM-DD' (toISOString usa UTC e vira o dia errado a noite)
export function isoLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// tamanho de arquivo legivel
export function formatarTamanho(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// copia texto para a area de transferencia; devolve true se deu certo
export async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(String(texto ?? '')); return true; }
  catch (_) { return false; }
}
