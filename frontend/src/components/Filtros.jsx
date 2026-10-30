import { useState } from 'react';
import { useApp } from '../context/AppContext';
import RecorrentesPanel from './RecorrentesPanel';
import { opcoesFiltro, filtrosAtivos } from '../lib/filtros';

// Barra de filtros compartilhada (cliente / responsavel / urgencia / periodo).
export default function Filtros({ tarefas }) {
  const { filtros, setFiltros, limparFiltros } = useApp();
  const { cli, rsp } = opcoesFiltro(tarefas || []);
  const set = (campo, valor) => setFiltros((f) => ({ ...f, [campo]: valor }));
  const cap = (p) => p[0].toUpperCase() + p.slice(1);
  const [verRecorrentes, setVerRecorrentes] = useState(false);

  return (
    <div className="barra-filtros">
      <span className="bf-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
        Filtros
      </span>
      <select className="bf-sel" value={filtros.cliente} onChange={(e) => set('cliente', e.target.value)}>
        <option value="">Cliente: todos</option>
        {cli.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
      </select>
      <select className="bf-sel" value={filtros.responsavel} onChange={(e) => set('responsavel', e.target.value)}>
        <option value="">Responsável: todos</option>
        {rsp.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
      </select>
      <select className="bf-sel" value={filtros.prioridade} onChange={(e) => set('prioridade', e.target.value)}>
        <option value="">Urgência: todas</option>
        {['urgente', 'alta', 'normal', 'baixa'].map((p) => <option key={p} value={p}>{cap(p)}</option>)}
      </select>
      <label className="bf-data-wrap">De <input type="date" className="bf-data" value={filtros.de || ''} onChange={(e) => set('de', e.target.value)} /></label>
      <label className="bf-data-wrap">Até <input type="date" className="bf-data" value={filtros.ate || ''} onChange={(e) => set('ate', e.target.value)} /></label>
      {filtrosAtivos(filtros) && <button className="bf-limpar" onClick={limparFiltros}>Limpar</button>}
      <button className="bf-recorrentes" onClick={() => setVerRecorrentes(true)} title="Ver e ajustar as tarefas que se repetem">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
        Recorrentes
      </button>
      {verRecorrentes && <RecorrentesPanel onFechar={() => setVerRecorrentes(false)} />}
    </div>
  );
}
