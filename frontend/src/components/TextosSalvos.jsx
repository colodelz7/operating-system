import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { copiarTexto } from '../lib/format';

/* Biblioteca de textos com a mesma cara (a do sistema original) para dois usos:
   - Prompts: da equipe toda (todos veem; edita quem criou ou o admin);
   - Mensagens: pessoais (cada um ve so as suas).
   Quem decide a regra e o servidor; aqui so mostramos os botoes certos.

   rotulos: { titulo, singular, artigo ('o'|'a'), vazioGlyph, vazioTexto, buscar } */

function ModalTexto({ item, base, r, onFechar, onSalvo }) {
  const toast = useToast();
  const ed = !!item;
  const [f, setF] = useState({ titulo: item?.titulo || '', conteudo: item?.conteudo || '' });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const salvar = async () => {
    if (!f.titulo.trim()) { toast('Informe o título', 'erro'); return; }
    setSalvando(true);
    try {
      const corpo = { titulo: f.titulo.trim(), conteudo: f.conteudo };
      if (ed) await API.put(`${base}/${item.id}`, corpo);
      else await API.post(base, corpo);
      toast(ed ? `${r.Singular} salv${r.artigo} ✓` : `${r.Singular} criad${r.artigo} ✓`, 'ok');
      onSalvo(); onFechar();
    } catch (e) { toast(e.message, 'erro'); }
    finally { setSalvando(false); }
  };

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" role="dialog" aria-label={ed ? `Editar ${r.singular}` : `${r.nov} ${r.singular}`}>
        <div className="modal-topo">
          <h3>{ed ? `Editar ${r.singular}` : `${r.nov} ${r.singular}`}</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button>
        </div>
        <div className="modal-corpo">
          <div className="campo"><label>Título</label>
            <input value={f.titulo} onChange={set('titulo')} maxLength={150} autoFocus />
          </div>
          <div className="campo"><label>{r.Singular}</label>
            <textarea value={f.conteudo} onChange={set('conteudo')} rows={12} maxLength={20000} style={{ minHeight: 240 }} />
          </div>
        </div>
        <div className="modal-rodape">
          <button className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : (ed ? 'Salvar' : 'Criar')}</button>
        </div>
      </div>
    </div>
  );
}

function VerTexto({ item, r, podeEditar, onFechar, onEditar, onCopiar }) {
  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" role="dialog" aria-label={item.titulo}>
        <div className="modal-topo">
          <h3 title={item.titulo} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.titulo}</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button>
        </div>
        <div className="modal-corpo">
          <pre className="prompt-texto">{item.conteudo || 'Sem conteúdo.'}</pre>
        </div>
        <div className="modal-rodape">
          {podeEditar && <button className="btn btn-ghost" onClick={() => onEditar(item)}>✎ Editar</button>}
          <button className="btn btn-primary" onClick={() => onCopiar(item)}>Copiar {r.singular}</button>
        </div>
      </div>
    </div>
  );
}

export default function TextosSalvos({ base, pessoal, rotulos: r, mascote }) {
  const { usuario, ehAdmin } = useAuth();
  const toast = useToast();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState(null);
  const [ver, setVer] = useState(null);

  const carregar = useCallback(async () => {
    setErro('');
    try { setItens((await API.get(base)).itens || []); }
    catch (e) { setErro(e.message); } finally { setCarregando(false); }
  }, [base]);
  useEffect(() => { carregar(); }, [carregar]);

  const podeAlterar = (t) => pessoal || ehAdmin || t.usuario_id === usuario?.id;

  const copiar = async (t) => {
    const ok = await copiarTexto(t.conteudo || '');
    toast(ok ? `${r.Singular} copiad${r.artigo} ✓` : 'Não consegui copiar (permissão do navegador)', ok ? 'ok' : 'erro');
  };
  const excluir = async (t) => {
    if (!window.confirm(`Excluir ${r.artigo} ${r.singular} "${t.titulo}"?`)) return;
    try { await API.del(`${base}/${t.id}`); toast(`${r.Singular} excluíd${r.artigo} ✓`, 'ok'); carregar(); }
    catch (e) { toast(e.message, 'erro'); }
  };

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Erro ao carregar</b>{erro}</div>;

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? itens.filter((t) => `${t.titulo || ''} ${t.conteudo || ''}`.toLowerCase().includes(termo))
    : itens;

  return (
    <>
      <div className="prompt-topo">
        <div className="prompt-titulo">
          <h3>{r.titulo}</h3>
          <div className="cli-busca prompt-busca">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título ou texto..." />
          </div>
        </div>
        <button className="btn btn-primary prompt-add" onClick={() => setModal({ item: null })}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
          Adicionar {r.singular}
        </button>
      </div>

      {!itens.length ? (
        <div className="prompt-vazio">
          <span className="prompt-vazio-glyph">{r.vazioGlyph}</span>
          <b>Nenhum{r.artigo === 'a' ? 'a' : ''} {r.singular} ainda</b>
          <span>{r.vazioTexto}</span>
          <button className="btn btn-primary" onClick={() => setModal({ item: null })} style={{ marginTop: 12 }}>
            + Adicionar {r.artigo === 'a' ? 'a primeira' : 'o primeiro'}
          </button>
        </div>
      ) : filtrados.length ? (
        <div className="prompt-grade">
          {filtrados.map((t) => (
            <article key={t.id} className="prompt-card">
              {podeAlterar(t) && (
                <div className="prompt-mini">
                  <button className="prompt-mini-btn" onClick={() => setModal({ item: t })} title={`Editar ${r.singular}`} aria-label={`Editar ${r.singular}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                  </button>
                  <button className="prompt-mini-btn prompt-del" onClick={() => excluir(t)} title={`Excluir ${r.singular}`} aria-label={`Excluir ${r.singular}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                  </button>
                </div>
              )}
              <button type="button" className="prompt-card-corpo" onClick={() => setVer(t)} title={`Ver ${r.singular} completo`}>
                <h4 title={t.titulo}>{t.titulo}</h4>
                <pre className="prompt-prev">{t.conteudo || 'Sem conteúdo.'}</pre>
              </button>
              <div className="prompt-acoes">
                <button className="btn btn-primary prompt-copiar" onClick={() => copiar(t)} title={`Copiar ${r.singular}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                  Copiar {r.singular}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="vazio"><b>Nada encontrado</b>Nenhum{r.artigo === 'a' ? 'a' : ''} {r.singular} bate com "{busca}".</div>}

      {mascote && (
        // com 1 card so, o centro da grade fica livre: o mascote sobe pra altura do card
        <div className={`prompt-mascote ${filtrados.length === 1 ? 'alto' : ''}`}>
          <img src="/prompt-mascote.png" alt="" loading="lazy" />
        </div>
      )}

      {modal && <ModalTexto item={modal.item} base={base} r={r} onFechar={() => setModal(null)} onSalvo={carregar} />}
      {ver && (
        <VerTexto
          item={ver} r={r} podeEditar={podeAlterar(ver)}
          onFechar={() => setVer(null)} onEditar={(t) => { setVer(null); setModal({ item: t }); }} onCopiar={copiar}
        />
      )}
    </>
  );
}
