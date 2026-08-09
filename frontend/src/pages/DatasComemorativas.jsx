import { useState, useEffect, useMemo } from 'react';
import { DATAS_2026, MESES } from '../lib/constants';
import { API } from '../lib/api';

const DOW_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function DatasComemorativas() {
  const hoje = new Date().toISOString().slice(0, 10);
  const anoAtual = Number(hoje.slice(0, 4));
  const iso = (dia, mes) => `${anoAtual}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const diaSemana = (dISO) => DOW_CURTO[new Date(dISO + 'T00:00:00').getDay()];

  const [datasCli, setDatasCli] = useState([]);
  const [cliente, setCliente] = useState(''); // '' = todos

  useEffect(() => {
    let vivo = true;
    (async () => {
      try { const r = await API.get('/api/clientes/datas'); if (vivo) setDatasCli(r.datas || []); }
      catch { /* silencioso: ainda mostra o calendário de marketing */ }
    })();
    return () => { vivo = false; };
  }, []);

  const clientesOpc = useMemo(
    () => Array.from(new Set(datasCli.map((d) => d.cliente_nome))).sort((a, b) => a.localeCompare(b)),
    [datasCli]);

  // ---- calendário unificado: marketing 2026 + datas dos clientes, sem repetir ----
  const merged = useMemo(() => {
    const map = new Map(); // chave: mes-dia-NOME
    const put = (dia, mes, nomeRaw) => {
      const nome = (nomeRaw || '').trim().toUpperCase();
      const key = `${mes}-${dia}-${nome}`;
      let e = map.get(key);
      if (!e) { e = { dia, mes, nome, campanha: false, marketing: false, clientes: new Set() }; map.set(key, e); }
      return e;
    };
    DATAS_2026.forEach((x) => {
      const dia = Number(x.d.slice(8, 10)), mes = Number(x.d.slice(5, 7));
      const e = put(dia, mes, x.nome);
      e.marketing = true;
      if (x.alta) e.campanha = true;
    });
    datasCli.forEach((d) => { put(d.dia, d.mes, d.nome).clientes.add(d.cliente_nome); });
    return [...map.values()];
  }, [datasCli]);

  // filtro: "todos" mostra tudo; um cliente mostra as datas dele + o marketing (compartilhado)
  const visiveis = useMemo(() => {
    const arr = merged.filter((e) => !cliente || e.marketing || e.clientes.has(cliente));
    return arr.sort((a, b) => (a.mes - b.mes) || (a.dia - b.dia) || a.nome.localeCompare(b.nome));
  }, [merged, cliente]);

  const proximas = useMemo(() => {
    const hojeMd = (Number(hoje.slice(5, 7)) * 100) + Number(hoje.slice(8, 10));
    return [...visiveis]
      .map((e) => ({ ...e, md: e.mes * 100 + e.dia }))
      .sort((a, b) => {
        const ka = a.md >= hojeMd ? a.md : a.md + 1300;
        const kb = b.md >= hojeMd ? b.md : b.md + 1300;
        return ka - kb;
      })
      .slice(0, 8);
  }, [visiveis, hoje]);

  const grupos = {};
  visiveis.forEach((e) => { (grupos[e.mes - 1] = grupos[e.mes - 1] || []).push(e); });

  // etiqueta de cliente: só quando é data exclusiva de 1 cliente (não de marketing)
  // e estamos no modo "todos" (no filtro, o cabeçalho já diz o cliente).
  const tagCliente = (e) => (!cliente && !e.marketing && e.clientes.size === 1 ? [...e.clientes][0] : null);

  return (
    <>
      <div className="dc-intro">
        Calendário único: datas de marketing de 2026 e as datas dos clientes, sem repetição.
        As de <span className="dc-flag inline">Campanha</span> têm maior potencial comercial.
        Filtre por cliente para ver as datas dele junto com o calendário de marketing.
      </div>

      <div className="barra-filtros" style={{ marginBottom: 14 }}>
        <span className="bf-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
          Filtro
        </span>
        <select className="bf-sel" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Cliente: todos</option>
          {clientesOpc.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {cliente && <button className="bf-limpar" onClick={() => setCliente('')}>Limpar</button>}
        <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 'auto' }}>
          {visiveis.length} data{visiveis.length === 1 ? '' : 's'}
        </span>
      </div>

      {proximas.length > 0 && (
        <div className="dc-proximas">
          <div className="dc-sub">Próximas datas {cliente ? `— ${cliente}` : ''}</div>
          <div className="dc-chips">
            {proximas.map((e) => (
              <div key={`${e.mes}-${e.dia}-${e.nome}`} className={`dc-chip ${e.campanha ? 'alta' : ''}`}>
                <b>{String(e.dia).padStart(2, '0')}/{String(e.mes).padStart(2, '0')}</b> {e.nome}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dc-grid">
        {MESES.map((nomeMes, i) => {
          const lista = grupos[i] || [];
          if (!lista.length) return null;
          return (
            <div key={nomeMes} className="dc-mes">
              <div className="dc-mes-nome">{nomeMes}</div>
              <div className="dc-lista">
                {lista.map((e) => {
                  const dISO = iso(e.dia, e.mes);
                  const tag = tagCliente(e);
                  return (
                    <div key={`${e.mes}-${e.dia}-${e.nome}`} className={`dc-item ${e.campanha ? 'alta' : ''} ${dISO < hoje ? 'passou' : ''}`}>
                      <span className="dc-dia">{String(e.dia).padStart(2, '0')}<small>{diaSemana(dISO)}</small></span>
                      <span className="dc-nome">
                        {e.nome}
                        {tag && <small style={{ color: 'var(--muted)', display: 'block' }}>{tag}</small>}
                      </span>
                      {e.campanha && <span className="dc-flag">Campanha</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
