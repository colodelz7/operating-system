/* Filtro compartilhado (cliente / responsavel / urgencia / periodo).
   Portado do FiltrosUI antigo, agora como funcoes puras. */

export const FILTROS_VAZIOS = { cliente: '', responsavel: '', prioridade: '', de: '', ate: '' };

export function filtrosAtivos(f) {
  return !!(f.cliente || f.responsavel || f.prioridade || f.de || f.ate);
}

export function aplicarFiltros(tarefas, f) {
  if (!filtrosAtivos(f)) return tarefas;
  return tarefas.filter((t) => {
    if (f.cliente && String(t.cliente_id) !== String(f.cliente)) return false;
    if (f.responsavel && !(t.responsaveis || []).some((r) => String(r.id) === String(f.responsavel))) return false;
    if (f.prioridade && t.prioridade !== f.prioridade) return false;
    if (f.de || f.ate) {
      const d = (t.data_entrega || t.data_publicacao || '').slice(0, 10);
      if (!d) return false;
      if (f.de && d < f.de) return false;
      if (f.ate && d > f.ate) return false;
    }
    return true;
  });
}

// opcoes de cliente/responsavel presentes nas tarefas (para os selects)
export function opcoesFiltro(tarefas) {
  const cli = []; const vc = new Set();
  const rsp = []; const vr = new Set();
  tarefas.forEach((t) => {
    if (t.cliente_id && !vc.has(t.cliente_id)) { vc.add(t.cliente_id); cli.push({ id: t.cliente_id, nome: t.cliente_nome }); }
    (t.responsaveis || []).forEach((r) => { if (!vr.has(r.id)) { vr.add(r.id); rsp.push(r); } });
  });
  cli.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  rsp.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  return { cli, rsp };
}
