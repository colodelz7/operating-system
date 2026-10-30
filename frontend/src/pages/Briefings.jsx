import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatarTamanho } from '../lib/format';

/* ============================================================
   BRIEFING · formulario de entrada do cliente (visual do sistema
   original). As perguntas vem do servidor (GET /api/briefings/campos):
   pergunta nova se acrescenta so no backend.
   Rascunho automatico no navegador: se a aba fechar antes de salvar,
   o texto volta ao reabrir. Some quando o briefing e salvo.
   ============================================================ */

const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const preenchidos = (chaves, dados) => chaves.filter((k) => String((dados || {})[k] || '').trim()).length;

const chaveRascunho = (id) => `colodel-briefing-rascunho-${id || 'novo'}`;
function lerRascunho(id) {
  try { const r = localStorage.getItem(chaveRascunho(id)); return r ? JSON.parse(r) : null; }
  catch (_) { return null; }
}
function gravarRascunho(id, empresa, dados) {
  try { localStorage.setItem(chaveRascunho(id), JSON.stringify({ empresa, dados, ts: Date.now() })); }
  catch (_) { /* navegador sem storage: segue sem rascunho */ }
}
function limparRascunho(id) {
  try { localStorage.removeItem(chaveRascunho(id)); } catch (_) { /* sem storage */ }
}
const temConteudo = (empresa, dados) => Boolean((empresa || '').trim()) || Object.values(dados || {}).some((v) => String(v || '').trim());

/* Arquivos do briefing: logo, fotos, manual, contrato. O arquivo precisa de
   um briefing salvo; se ainda nao tem, salva na hora e segue o envio. */
function Arquivos({ briefingId, criadoPor, garantirId }) {
  const { usuario, ehAdmin } = useAuth();
  const toast = useToast();
  const [arquivos, setArquivos] = useState([]);
  const [subindo, setSubindo] = useState(false);

  const carregar = useCallback(async () => {
    if (!briefingId) { setArquivos([]); return; }
    try { setArquivos((await API.get(`/api/briefings/${briefingId}/arquivos`)).arquivos || []); }
    catch (_) { /* a lista some, o formulario continua */ }
  }, [briefingId]);
  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (e) => {
    const lista = Array.from(e.target.files || []);
    e.target.value = '';
    if (!lista.length) return;
    setSubindo(true);
    try {
      const id = briefingId || (await garantirId());
      if (!id) return;
      let enviados = 0;
      for (const arquivo of lista) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        try { await API.post(`/api/briefings/${id}/arquivos`, fd, true); enviados++; }
        catch (err) { toast(`${arquivo.name}: ${err.message}`, 'erro'); }
      }
      if (enviados) toast(enviados > 1 ? `${enviados} arquivos anexados ✓` : 'Arquivo anexado ✓', 'ok');
      try { setArquivos((await API.get(`/api/briefings/${id}/arquivos`)).arquivos || []); } catch (_) { /* ok */ }
    } finally { setSubindo(false); }
  };

  const excluir = async (a) => {
    if (!window.confirm(`Remover "${a.nome_original}"?`)) return;
    try { await API.del(`/api/briefings/arquivos/${a.id}`); carregar(); }
    catch (err) { toast(err.message, 'erro'); }
  };

  const podeApagar = (a) => ehAdmin || a.enviado_por === usuario?.id || criadoPor === usuario?.id;

  return (
    <section className="brf-bloco">
      <header className="brf-bloco-topo">
        <h4>Arquivos</h4>
        <label className={`brf-anexar ${subindo ? 'ocupado' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
            <path d="M21.4 11.1l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
          </svg>
          {subindo ? 'Enviando...' : 'Adicionar anexo'}
          <input type="file" multiple hidden onChange={enviar} disabled={subindo}
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx" />
        </label>
      </header>
      {arquivos.length ? (
        <ul className="brf-arq-lista">
          {arquivos.map((a) => (
            <li key={a.id}>
              <svg className="brf-arq-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
              </svg>
              <a href={`/api/briefings/arquivos/${a.id}`} target="_blank" rel="noreferrer" title={`Abrir ${a.nome_original}`}>{a.nome_original}</a>
              <span>{formatarTamanho(a.tamanho)}{a.enviado_por_nome ? ` · ${a.enviado_por_nome}` : ''}</span>
              {podeApagar(a) && <button type="button" className="brf-arq-del" onClick={() => excluir(a)} title="Remover arquivo">&times;</button>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="brf-vazio">
          Nenhum arquivo ainda. Anexe logo, fotos, contrato e manual de marca.
          <br />PNG, JPEG, GIF, WebP, PDF, DOC e XLS, até 25MB cada.
        </p>
      )}
    </section>
  );
}

function Formulario({ campos, briefing, onVoltar, onSalvo }) {
  const toast = useToast();
  const chaves = useMemo(() => campos.flatMap((b) => b.itens.map((i) => i.k)), [campos]);
  const [id, setId] = useState(briefing?.id || null);
  const [empresa, setEmpresa] = useState(briefing?.empresa || '');
  const [dados, setDados] = useState(briefing?.respostas || {});
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [recuperado, setRecuperado] = useState(false);
  const empresaRef = useRef(null);

  const set = (k) => (e) => { setDados((d) => ({ ...d, [k]: e.target.value })); setSujo(true); };

  // rascunho mais novo que o salvo: volta para a tela, avisando
  useEffect(() => {
    const r = lerRascunho(briefing?.id || null);
    if (!r || !temConteudo(r.empresa, r.dados)) return;
    const salvoTs = briefing?.atualizado_em ? new Date(briefing.atualizado_em).getTime() : 0;
    if (r.ts > salvoTs) {
      setEmpresa(r.empresa || '');
      setDados(r.dados || {});
      setRecuperado(true);
      setSujo(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // grava o rascunho so depois que a pessoa mexeu em algo
  useEffect(() => {
    if (!sujo || !temConteudo(empresa, dados)) return;
    gravarRascunho(id, empresa, dados);
  }, [id, empresa, dados, sujo]);

  const descartarRascunho = () => {
    limparRascunho(id);
    setEmpresa(briefing?.empresa || '');
    setDados(briefing?.respostas || {});
    setRecuperado(false);
    setSujo(false);
  };

  const salvar = async () => {
    if (!empresa.trim()) {
      toast('Informe o nome do cliente', 'erro');
      empresaRef.current?.focus();
      return null;
    }
    setSalvando(true);
    const idAntes = id;
    try {
      const corpo = { empresa: empresa.trim(), respostas: dados };
      const r = id ? await API.put(`/api/briefings/${id}`, corpo) : await API.post('/api/briefings', corpo);
      toast('Briefing salvo ✓', 'ok');
      setSujo(false);
      setRecuperado(false);
      setId(r.briefing.id);
      limparRascunho(idAntes);
      limparRascunho(r.briefing.id);
      onSalvo(r.briefing);
      return r.briefing;
    } catch (e) { toast(e.message, 'erro'); return null; }
    finally { setSalvando(false); }
  };
  const garantirId = async () => (await salvar())?.id || null;

  // abre uma pagina pronta para "Salvar como PDF" na impressao. Sem script
  // dentro dela (a CSP nao deixa): quem chama o imprimir e esta aba.
  const exportarPdf = () => {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nl = (s) => esc(s).replace(/\n/g, '<br>');
    const hoje = new Date().toLocaleDateString('pt-BR');
    const nomeCliente = empresa.trim() || 'Cliente';
    const blocos = campos.map((b, idx) => {
      const linhas = b.itens.map((i) => {
        const val = String(dados[i.k] || '').trim();
        return `<tr><th>${esc(i.r)}</th><td>${val ? nl(val) : '<span class="vazio">não informado</span>'}</td></tr>`;
      }).join('');
      return `<section><h2><span class="n">${idx + 1}</span> ${esc(b.titulo)}</h2><table>${linhas}</table></section>`;
    }).join('');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Briefing ${esc(nomeCliente)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --brand:#0a74d0; --neon:#29c3ff; --txt:#1a1a2e; --muted:#6a6a8a; --linha:#e7e7f0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         color: var(--txt); font-size: 12.5px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pagina { max-width: 780px; margin: 0 auto; padding: 40px 44px 56px; }
  .capa { padding: 26px 28px; border-radius: 18px; color: #fff; margin-bottom: 30px;
          background: linear-gradient(135deg, #01071a 0%, #0a1535 55%, #008afc 140%); }
  .capa .marca { font-weight: 800; font-size: 26px; letter-spacing: -.02em; }
  .capa .marca span { color: #29c3ff; }
  .capa .etq { margin-top: 18px; font-size: 11px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; opacity: .85; }
  .capa h1 { margin: 4px 0 0; font-size: 30px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; }
  .capa .meta { margin-top: 12px; font-size: 12px; opacity: .9; }
  section { margin: 0 0 22px; break-inside: avoid; page-break-inside: avoid; }
  h2 { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; color: var(--brand);
       margin: 0 0 10px; padding-bottom: 8px; border-bottom: 2px solid var(--linha); }
  h2 .n { display: inline-grid; place-items: center; width: 26px; height: 26px; flex: 0 0 auto;
          background: linear-gradient(135deg, var(--brand), var(--neon)); color: #fff; border-radius: 50%; font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--linha); }
  th { width: 36%; font-weight: 600; color: var(--muted); }
  td { color: var(--txt); font-weight: 500; }
  .vazio { color: #b6bcc6; font-style: italic; font-weight: 400; }
  .rodape { margin-top: 28px; padding-top: 14px; border-top: 2px solid var(--linha);
            display: flex; justify-content: space-between; font-size: 10.5px; color: var(--muted); }
  .rodape b { color: var(--brand); font-weight: 700; }
  @page { margin: 12mm; }
  @media print { .pagina { padding: 0; max-width: none; } .capa { border-radius: 14px; } }
</style></head><body>
<div class="pagina">
  <header class="capa">
    <div class="marca">Colodel<span>.</span></div>
    <div class="etq">Briefing de projeto</div>
    <h1>${esc(nomeCliente)}</h1>
    <div class="meta">Gerado em ${esc(hoje)}</div>
  </header>
  ${blocos}
  <div class="rodape"><span><b>Colodel.</b></span><span>${esc(hoje)}</span></div>
</div>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Libere o pop-up pra exportar o PDF', 'erro'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // tempo para a fonte carregar antes de abrir a impressao
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* janela fechada */ } }, 500);
  };

  const voltar = () => {
    if (sujo && !window.confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
    onVoltar();
  };

  const feitos = preenchidos(chaves, dados);
  const pct = chaves.length ? Math.round((feitos / chaves.length) * 100) : 0;

  return (
    <div className="brf-form">
      <div className="brf-topo">
        <button className="brf-voltar" onClick={voltar} title="Voltar para a lista">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><path d="M15 18l-6-6 6-6" /></svg>
          Voltar
        </button>
        <input className="brf-cliente" ref={empresaRef} value={empresa} onChange={(e) => { setEmpresa(e.target.value); setSujo(true); }}
          placeholder="Nome do cliente" autoFocus={!id} aria-label="Nome do cliente" />
        <div className="brf-prog" title={`${feitos} de ${chaves.length} campos preenchidos`}>
          <div className="brf-prog-barra"><span style={{ width: `${pct}%` }} /></div>
          <small>{feitos} de {chaves.length}</small>
        </div>
        <button className="btn btn-ghost brf-pdf" onClick={exportarPdf} title="Exportar em PDF (Salvar como PDF na impressão)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6" /><path d="M9 18h6" /></svg>
          PDF
        </button>
        <button className="btn btn-primary brf-salvar" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {recuperado && (
        <div className="brf-recuperado">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          <span>Recuperamos um rascunho não salvo deste briefing. Confira o texto e clique em <b>Salvar</b> pra gravar de vez.</span>
          <button type="button" onClick={descartarRascunho}>Descartar rascunho</button>
        </div>
      )}

      {campos.map((b, idx) => (
        <section key={b.titulo} className="brf-bloco">
          <header className="brf-bloco-topo">
            <h4><span className="brf-num">{idx + 1}</span>{b.titulo}</h4>
          </header>
          <div className="brf-grade">
            {b.itens.map((i) => (
              <div key={i.k} className={`brf-campo ${i.alto ? 'largo' : ''}`}>
                <label htmlFor={`brf-${i.k}`}>{i.r}</label>
                {i.alto
                  ? <textarea id={`brf-${i.k}`} value={dados[i.k] || ''} onChange={set(i.k)} rows={2} placeholder={i.dica || ''} />
                  : <input id={`brf-${i.k}`} value={dados[i.k] || ''} onChange={set(i.k)} placeholder={i.dica || ''} />}
              </div>
            ))}
          </div>
        </section>
      ))}

      <Arquivos briefingId={id} criadoPor={briefing?.criado_por} garantirId={garantirId} />
    </div>
  );
}

export default function Briefings() {
  const { usuario, ehAdmin } = useAuth();
  const toast = useToast();
  const [campos, setCampos] = useState([]);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null); // { briefing } ou { briefing: null } = novo

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [rc, rl] = await Promise.all([API.get('/api/briefings/campos'), API.get('/api/briefings')]);
      setCampos(rc.campos || []);
      setLista(rl.briefings || []);
    } catch (e) { setErro(e.message); } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const abrir = async (b) => {
    try { setAberto({ briefing: (await API.get(`/api/briefings/${b.id}`)).briefing }); }
    catch (e) { toast(e.message, 'erro'); }
  };

  const excluir = async (b) => {
    if (!window.confirm(`Excluir o briefing de "${b.empresa}"? Isso não volta.`)) return;
    try { await API.del(`/api/briefings/${b.id}`); toast('Briefing excluído ✓', 'ok'); carregar(); }
    catch (e) { toast(e.message, 'erro'); }
  };

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return lista;
    return lista.filter((b) => `${b.empresa} ${b.cliente_nome || ''}`.toLowerCase().includes(termo));
  }, [lista, busca]);

  if (aberto) {
    return (
      <Formulario
        key={aberto.briefing?.id || 'novo'}
        campos={campos}
        briefing={aberto.briefing}
        onVoltar={() => { setAberto(null); carregar(); }}
        onSalvo={(b) => { setAberto({ briefing: b }); carregar(); }}
      />
    );
  }

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Erro ao carregar</b>{erro}</div>;

  return (
    <>
      <div className="prompt-topo">
        <div className="prompt-titulo">
          <h3>Briefing</h3>
          <div className="cli-busca prompt-busca">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente..." />
          </div>
        </div>
        <button className="btn btn-primary prompt-add" onClick={() => setAberto({ briefing: null })}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
          Novo briefing
        </button>
      </div>

      {!lista.length ? (
        <div className="prompt-vazio">
          <span className="prompt-vazio-glyph">☑</span>
          <b>Nenhum briefing ainda</b>
          <span>Crie um por cliente e vá preenchendo conforme as informações chegam.</span>
          <button className="btn btn-primary" onClick={() => setAberto({ briefing: null })} style={{ marginTop: 12 }}>+ Criar o primeiro</button>
        </div>
      ) : filtrados.length ? (
        <div className="prompt-grade">
          {filtrados.map((b) => {
            const pct = b.total ? Math.round((b.preenchidos / b.total) * 100) : 0;
            const podeExcluir = ehAdmin || b.criado_por === usuario?.id;
            return (
              <article key={b.id} className="prompt-card">
                <button type="button" className="prompt-card-corpo" onClick={() => abrir(b)} title="Abrir briefing">
                  <h4 title={b.empresa}>{b.empresa}</h4>
                  <div className="brf-prog">
                    <div className="brf-prog-barra"><span style={{ width: `${pct}%` }} /></div>
                    <small>{b.preenchidos}/{b.total} campos</small>
                  </div>
                  <small className="brf-meta">
                    Atualizado em {dataBR(b.atualizado_em)}{b.atualizado_por_nome ? ` por ${b.atualizado_por_nome}` : ''}
                  </small>
                </button>
                <div className="prompt-acoes">
                  <button className="prompt-acao" onClick={() => abrir(b)} title="Preencher">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                    Preencher
                  </button>
                  {podeExcluir && (
                    <button className="prompt-acao prompt-del" onClick={() => excluir(b)} title="Excluir" aria-label="Excluir briefing">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="vazio"><b>Nada encontrado</b>Nenhum briefing bate com "{busca}".</div>}
    </>
  );
}
