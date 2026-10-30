import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useChat } from '../context/ChatContext';
import { formatarTamanho, iniciais } from '../lib/format';
import { EMOJIS } from '../lib/emojis';
import Avatar from '../components/Avatar';

/* ============================================================
   CHAT interno: grupos e conversa direta (visual do sistema
   original). Lista a esquerda, conversa no meio e, num grupo, o
   painel "Editar grupo" a direita. Mensagem nova chega na hora pelo
   aviso 'colodel:chat' (mesmo canal SSE das notificacoes).
   ============================================================ */

const EXIBIVEIS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const ACEITA_ANEXO = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx';
const horaBR = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const extDe = (nome) => (String(nome || '').split('.').pop() || 'ARQ').slice(0, 4).toUpperCase();

function rotuloDoDia(d) {
  const dia = new Date(d);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(dia, hoje)) return 'Hoje';
  if (mesmoDia(dia, ontem)) return 'Ontem';
  return dia.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: dia.getFullYear() === hoje.getFullYear() ? undefined : 'numeric' });
}

function nomeDaConversa(c, meuId) {
  if (c.tipo === 'grupo') return c.nome || 'Grupo';
  const outro = (c.membros || []).find((m) => m.id !== meuId);
  return outro ? outro.nome : 'Conversa';
}

/* Na conversa direta, a foto da outra pessoa; no grupo, as iniciais do nome. */
function FotoConversa({ conversa, usuarioId }) {
  if (conversa.tipo === 'direta') {
    const outro = (conversa.membros || []).find((m) => m.id !== usuarioId);
    return <Avatar pessoa={outro} className="chat-foto" />;
  }
  return <span className="chat-foto letras">{iniciais(conversa.nome)}</span>;
}

/* Emojis por categoria. Lista fixa no codigo: quem desenha e a fonte do sistema. */
function SeletorEmoji({ onEscolher }) {
  const [aberto, setAberto] = useState(false);
  const [grupo, setGrupo] = useState(EMOJIS[0].grupo);
  const caixa = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    const tecla = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto]);

  const atual = EMOJIS.find((g) => g.grupo === grupo) || EMOJIS[0];

  return (
    <div className="chat-emoji" ref={caixa}>
      <button type="button" className="chat-emoji-btn" onClick={() => setAberto((v) => !v)} title="Emojis" aria-label="Emojis">😊</button>
      {aberto && (
        <div className="chat-emoji-painel">
          <div className="chat-emoji-abas">
            {EMOJIS.map((g) => (
              <button key={g.grupo} type="button" title={g.grupo} className={g.grupo === grupo ? 'on' : ''} onClick={() => setGrupo(g.grupo)}>{g.capa}</button>
            ))}
          </div>
          <div className="chat-emoji-titulo">{atual.grupo}</div>
          <div className="chat-emoji-grade">
            {atual.itens.map((e, i) => (
              <button key={`${e}-${i}`} type="button" onClick={() => onEscolher(e)} title={e}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* Nova conversa: grupo (nome + gente) ou direta (uma pessoa). */
function ModalNova({ equipe, usuarioId, onFechar, onCriada }) {
  const toast = useToast();
  const [tipo, setTipo] = useState('grupo');
  const [nome, setNome] = useState('');
  const [sel, setSel] = useState([]);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);

  const termo = busca.trim().toLowerCase();
  const lista = equipe.filter((u) => u.id !== usuarioId && (!termo || u.nome.toLowerCase().includes(termo)));
  const alternar = (id) => {
    if (tipo === 'direta') { setSel([id]); return; }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const criar = async () => {
    if (tipo === 'grupo' && !nome.trim()) { toast('Dê um nome ao grupo', 'erro'); return; }
    if (!sel.length) { toast(tipo === 'direta' ? 'Escolha com quem conversar' : 'Escolha ao menos uma pessoa', 'erro'); return; }
    setSalvando(true);
    try {
      const corpo = tipo === 'direta' ? { tipo, usuario_id: sel[0] } : { tipo, nome: nome.trim(), membros: sel };
      const r = await API.post('/api/chat/conversas', corpo);
      onCriada(r.conversa);
    } catch (e) { toast(e.message, 'erro'); }
    finally { setSalvando(false); }
  };

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" role="dialog" aria-label="Nova conversa">
        <div className="modal-topo">
          <h3>Nova conversa</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button>
        </div>
        <div className="modal-corpo">
          <div className="chat-tipo">
            <button className={tipo === 'grupo' ? 'on' : ''} onClick={() => { setTipo('grupo'); setSel([]); }}>Grupo</button>
            <button className={tipo === 'direta' ? 'on' : ''} onClick={() => { setTipo('direta'); setSel([]); }}>Direta</button>
          </div>
          {tipo === 'grupo' && (
            <div className="campo"><label>Nome do grupo</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Pauta da semana" maxLength={80} autoFocus />
            </div>
          )}
          <div className="campo">
            <label>{tipo === 'grupo' ? `Participantes (${sel.length})` : 'Com quem'}</label>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa..." />
          </div>
          <div className="chat-pessoas">
            {lista.map((u) => (
              <button type="button" key={u.id} className={`chat-pessoa ${sel.includes(u.id) ? 'on' : ''}`} onClick={() => alternar(u.id)}>
                <Avatar pessoa={u} />
                <span>{u.nome}</span>
                <small>{u.setor_nome}</small>
              </button>
            ))}
            {!lista.length && <p className="chat-vazio-txt">Ninguém encontrado.</p>}
          </div>
        </div>
        <div className="modal-rodape">
          <button className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primary" onClick={criar} disabled={salvando}>
            {salvando ? 'Criando...' : tipo === 'grupo' ? 'Criar grupo' : 'Abrir conversa'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Painel lateral do grupo: nome, participantes, adicionar, sair e apagar. */
function PainelGrupo({ conversa, equipe, usuarioId, ehAdmin, onFechar, onMudou, onSaiu }) {
  const toast = useToast();
  const [nome, setNome] = useState(conversa.nome || '');
  const pode = ehAdmin || conversa.criado_por === usuarioId;
  const ids = (conversa.membros || []).map((m) => m.id);
  const paraAdicionar = equipe.filter((u) => !ids.includes(u.id));

  useEffect(() => { setNome(conversa.nome || ''); }, [conversa.id, conversa.nome]);

  const salvar = async (corpo, msg) => {
    try { await API.put(`/api/chat/conversas/${conversa.id}`, corpo); if (msg) toast(msg, 'ok'); onMudou(); }
    catch (e) { toast(e.message, 'erro'); }
  };
  const renomear = () => { if (nome.trim() && nome.trim() !== conversa.nome) salvar({ nome: nome.trim() }, 'Grupo renomeado ✓'); };
  const remover = (m) => {
    if (!window.confirm(`Tirar ${m.nome} do grupo?`)) return;
    salvar({ membros: ids.filter((x) => x !== m.id) });
  };
  const adicionar = (u) => salvar({ membros: [...ids, u.id] });

  const sair = async () => {
    if (!window.confirm(`Sair do grupo "${conversa.nome}"?`)) return;
    try { await API.post(`/api/chat/conversas/${conversa.id}/sair`); onSaiu(); }
    catch (e) { toast(e.message, 'erro'); }
  };
  const excluirGrupo = async () => {
    if (!window.confirm(`Apagar o grupo "${conversa.nome}" e todas as mensagens? Não dá para desfazer.`)) return;
    try { await API.del(`/api/chat/conversas/${conversa.id}`); onSaiu(); }
    catch (e) { toast(e.message, 'erro'); }
  };

  return (
    <aside className="chat-painel">
      <div className="chat-painel-topo">
        <h4>Editar grupo</h4>
        <button className="fechar" onClick={onFechar} aria-label="Fechar painel" style={{ background: 'none', border: 0, fontSize: 22, color: 'var(--muted)' }}>&times;</button>
      </div>

      <div className="chat-foto-edit">
        <span className="chat-foto gg letras">{iniciais(conversa.nome)}</span>
      </div>

      <div className="campo">
        <label>Nome do grupo</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={renomear} disabled={!pode}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} maxLength={80} />
      </div>

      <div className="chat-painel-sec">Participantes ({ids.length})</div>
      <div className="chat-membros">
        {(conversa.membros || []).map((m) => (
          <div key={m.id} className="chat-membro">
            <Avatar pessoa={m} />
            <span>{m.nome}{m.id === usuarioId ? ' (você)' : ''}</span>
            {pode && m.id !== usuarioId && <button type="button" onClick={() => remover(m)} title={`Tirar ${m.nome}`}>&times;</button>}
          </div>
        ))}
      </div>

      {pode && (
        <>
          <div className="chat-painel-sec">Adicionar ao grupo</div>
          <div className="chat-membros">
            {paraAdicionar.map((u) => (
              <button key={u.id} type="button" className="chat-membro add" onClick={() => adicionar(u)}>
                <Avatar pessoa={u} />
                <span>{u.nome}</span>
                <small>+</small>
              </button>
            ))}
            {!paraAdicionar.length && <p className="chat-vazio-txt">Todo mundo já está no grupo.</p>}
          </div>
        </>
      )}

      <button type="button" className="btn btn-ghost btn-sm" onClick={sair} style={{ marginTop: 14 }}>Sair do grupo</button>
      {pode && <button type="button" className="chat-excluir-grupo" onClick={excluirGrupo}>Apagar grupo</button>}
    </aside>
  );
}

export default function Chat() {
  const { usuario, ehAdmin } = useAuth();
  const toast = useToast();
  const { recarregar: recarregarResumo } = useChat();
  const [params, setParams] = useSearchParams();

  const [conversas, setConversas] = useState([]);
  const [equipe, setEquipe] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [ativaId, setAtivaId] = useState(() => Number(params.get('c')) || null);
  const [mensagens, setMensagens] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [texto, setTexto] = useState('');
  const [pendente, setPendente] = useState(null); // { arquivo, nome, tamanho, url }
  const [enviando, setEnviando] = useState(false);
  const [modalNova, setModalNova] = useState(false);
  const [painel, setPainel] = useState(false);
  const [busca, setBusca] = useState('');
  const fimRef = useRef(null);
  const inputArquivo = useRef(null);
  const caixaTexto = useRef(null);

  // setParams e o recarregar do menu mudam de identidade; nos efeitos entram
  // por ref, senao o efeito que mexe na URL ou recarrega a conversa roda em laco
  const ativaRef = useRef(ativaId);
  ativaRef.current = ativaId;
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const resumoRef = useRef(recarregarResumo);
  resumoRef.current = recarregarResumo;

  const ativa = conversas.find((c) => c.id === ativaId) || null;

  const carregarConversas = useCallback(async () => {
    try { setConversas((await API.get('/api/chat/conversas')).conversas || []); }
    catch (e) { toast(e.message, 'erro'); }
    finally { setCarregando(false); }
  }, [toast]);

  const marcarLida = useCallback(async (id, lista) => {
    const ultima = lista[lista.length - 1];
    if (!ultima) return;
    try {
      await API.post(`/api/chat/conversas/${id}/lida`, { ate_id: ultima.id });
      setConversas((cs) => cs.map((c) => (c.id === id ? { ...c, nao_lidas: 0 } : c)));
      resumoRef.current();
    } catch (_) { /* tenta de novo na proxima mensagem */ }
  }, []);

  const carregarMensagens = useCallback(async (id) => {
    try {
      const r = await API.get(`/api/chat/conversas/${id}/mensagens`);
      if (ativaRef.current !== id) return; // trocou de conversa no meio
      setMensagens(r.mensagens);
      setTemMais(r.tem_mais);
      marcarLida(id, r.mensagens);
    } catch (e) { toast(e.message, 'erro'); setAtivaId(null); }
  }, [marcarLida, toast]);

  useEffect(() => {
    carregarConversas();
    API.get('/api/equipe').then((r) => setEquipe(r.equipe || [])).catch(() => {});
  }, [carregarConversas]);

  useEffect(() => {
    // a conversa aberta fica na URL (?c=), para o link do push abrir direto nela
    setParamsRef.current((p) => {
      const n = new URLSearchParams(p);
      if (ativaId) n.set('c', String(ativaId)); else n.delete('c');
      return n;
    }, { replace: true });
    setMensagens([]);
    setTexto('');
    if (ativaId) carregarMensagens(ativaId);
  }, [ativaId, carregarMensagens]);

  // aviso em tempo real: atualiza a lista e, se for a conversa aberta, as mensagens
  useEffect(() => {
    const aoAviso = (e) => {
      carregarConversas();
      const id = e.detail && e.detail.conversa_id;
      if (id && id === ativaRef.current) carregarMensagens(id);
    };
    window.addEventListener('colodel:chat', aoAviso);
    return () => window.removeEventListener('colodel:chat', aoAviso);
  }, [carregarConversas, carregarMensagens]);

  const ultimaId = mensagens.length ? mensagens[mensagens.length - 1].id : 0;
  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [ultimaId]);

  // libera a previa da imagem pendente quando ela sai da tela
  useEffect(() => () => { if (pendente?.url) URL.revokeObjectURL(pendente.url); }, [pendente]);

  const carregarAntigas = async () => {
    if (!mensagens.length) return;
    try {
      const r = await API.get(`/api/chat/conversas/${ativaId}/mensagens?antes_de=${mensagens[0].id}`);
      setMensagens((l) => [...r.mensagens, ...l]);
      setTemMais(r.tem_mais);
    } catch (e) { toast(e.message, 'erro'); }
  };

  const prepararArquivo = (arquivo) => {
    if (!arquivo) return;
    if (arquivo.size > 25 * 1024 * 1024) { toast('O arquivo pode ter no máximo 25MB', 'erro'); return; }
    setPendente({
      arquivo, nome: arquivo.name, tamanho: arquivo.size,
      url: EXIBIVEIS.includes(arquivo.type) ? URL.createObjectURL(arquivo) : null,
    });
    caixaTexto.current?.focus();
  };

  // colar um print direto na caixa de texto vira anexo
  const aoColar = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.kind === 'file');
    if (!item) return;
    e.preventDefault();
    prepararArquivo(item.getAsFile());
  };

  const inserirEmoji = (emo) => {
    const el = caixaTexto.current;
    if (!el) { setTexto((t) => t + emo); return; }
    const ini = el.selectionStart ?? texto.length;
    const fim = el.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + emo + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + emo.length, ini + emo.length); });
  };

  const enviar = async (e) => {
    if (e) e.preventDefault();
    const t = texto.trim();
    if (!t && !pendente) return;
    setEnviando(true);
    try {
      let r;
      if (pendente) {
        const fd = new FormData();
        if (t) fd.append('texto', t);
        fd.append('arquivo', pendente.arquivo);
        r = await API.post(`/api/chat/conversas/${ativaId}/mensagens`, fd, true);
      } else {
        r = await API.post(`/api/chat/conversas/${ativaId}/mensagens`, { texto: t });
      }
      setTexto('');
      setPendente(null);
      setMensagens((l) => (l.some((m) => m.id === r.mensagem.id) ? l : [...l, r.mensagem]));
      carregarConversas();
    } catch (err) { toast(err.message, 'erro'); }
    finally { setEnviando(false); }
  };

  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? conversas.filter((c) => nomeDaConversa(c, usuario?.id).toLowerCase().includes(termo))
    : conversas;

  const previa = (c) => {
    const m = c.ultima_mensagem;
    if (!m) return 'Sem mensagens ainda';
    const autor = m.usuario_nome ? `${m.usuario_nome.split(' ')[0]}: ` : '';
    return autor + (m.texto || (m.anexo_nome_original ? 'Anexo' : ''));
  };

  return (
    <div className={`chat ${painel && ativa?.tipo === 'grupo' ? 'com-painel' : ''}`}>
      <section className="chat-lista">
        <div className="chat-lista-topo">
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa..." />
          <button className="btn btn-primary btn-sm" onClick={() => setModalNova(true)} title="Nova conversa" aria-label="Nova conversa">+</button>
        </div>
        <div className="chat-lista-itens">
          {carregando ? (
            <div className="carregando" style={{ padding: 20 }}><div className="spinner" />Carregando...</div>
          ) : !lista.length ? (
            <p className="chat-vazio-txt" style={{ padding: 16 }}>
              Nenhuma conversa ainda. Clique no + pra criar um grupo ou falar com alguém.
            </p>
          ) : lista.map((c) => (
            <button key={c.id} type="button" className={`chat-item ${c.id === ativaId ? 'on' : ''}`}
              onClick={() => { setAtivaId(c.id); setPainel(false); }}>
              <FotoConversa conversa={c} usuarioId={usuario?.id} />
              <span className="chat-item-txt">
                <b>{nomeDaConversa(c, usuario?.id)}</b>
                <small>{previa(c)}</small>
              </span>
              {c.nao_lidas > 0 && <span className="chat-badge">{c.nao_lidas}</span>}
            </button>
          ))}
        </div>
      </section>

      {!ativa ? (
        <section className="chat-conversa vazia">
          <p>Escolha uma conversa à esquerda ou crie uma nova no +.</p>
        </section>
      ) : (
        <section className="chat-conversa">
          <header className="chat-cabeca">
            <FotoConversa conversa={ativa} usuarioId={usuario?.id} />
            <div className="chat-cabeca-txt">
              <b>{nomeDaConversa(ativa, usuario?.id)}</b>
              <small>{ativa.tipo === 'grupo' ? (ativa.membros || []).map((m) => m.nome.split(' ')[0]).join(', ') : 'Conversa direta'}</small>
            </div>
            {ativa.tipo === 'grupo' && (
              <button className="btn btn-ghost btn-sm" onClick={() => setPainel((v) => !v)}>Editar grupo</button>
            )}
          </header>

          <div className="chat-msgs">
            {temMais && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center', marginBottom: 10 }} onClick={carregarAntigas}>
                Carregar mensagens anteriores
              </button>
            )}
            {mensagens.map((m, i) => {
              const anterior = mensagens[i - 1];
              const novoDia = !anterior || !mesmoDia(anterior.criado_em, m.criado_em);
              const meu = m.usuario_id === usuario?.id;
              const seguida = !novoDia && anterior && anterior.usuario_id === m.usuario_id;
              const imagem = m.anexo_arquivo && EXIBIVEIS.includes(m.anexo_mime);
              return (
                <div key={m.id} className="chat-linha">
                  {novoDia && <div className="chat-dia"><span>{rotuloDoDia(m.criado_em)}</span></div>}
                  <div className={`chat-msg ${meu ? 'meu' : ''} ${seguida ? 'seguida' : ''}`}>
                    {!meu && ativa.tipo === 'grupo' && !seguida && <span className="chat-autor">{m.usuario_nome || 'Alguém'}</span>}
                    {m.anexo_arquivo && !imagem && (
                      <a className="chat-arq" href={`/api/chat/anexos/${m.id}?baixar=1`} title="Baixar arquivo">
                        <span className="chat-arq-ext">{extDe(m.anexo_nome_original)}</span>
                        <span className="chat-arq-info">
                          <b>{m.anexo_nome_original || 'arquivo'}</b>
                          {m.anexo_tamanho ? <small>{formatarTamanho(m.anexo_tamanho)}</small> : null}
                        </span>
                      </a>
                    )}
                    {imagem && (
                      <div className="chat-img">
                        <a href={`/api/chat/anexos/${m.id}`} target="_blank" rel="noopener noreferrer" title="Abrir imagem">
                          <img src={`/api/chat/anexos/${m.id}`} alt={m.anexo_nome_original || 'imagem'} loading="lazy" />
                        </a>
                        <a className="chat-img-baixar" title="Baixar imagem" download href={`/api/chat/anexos/${m.id}?baixar=1`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M12 3v12" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></svg>
                        </a>
                      </div>
                    )}
                    <p>{m.texto}</p>
                    <time dateTime={m.criado_em}>{horaBR(m.criado_em)}</time>
                  </div>
                </div>
              );
            })}
            {!mensagens.length && <p className="chat-vazio-txt" style={{ padding: 20 }}>Nenhuma mensagem ainda. Comece você.</p>}
            <div ref={fimRef} />
          </div>

          <form className="chat-escrever" onSubmit={enviar}>
            {pendente && (
              <div className="chat-previa">
                {pendente.url
                  ? <img src={pendente.url} alt="Prévia da imagem" />
                  : <span className="chat-arq-ext">{extDe(pendente.nome)}</span>}
                <div className="chat-previa-info">
                  <b>{pendente.nome}</b>
                  <small>{formatarTamanho(pendente.tamanho)} · escreva uma legenda se quiser</small>
                </div>
                <button type="button" className="chat-previa-x" onClick={() => setPendente(null)} title="Descartar anexo">&times;</button>
              </div>
            )}
            <SeletorEmoji onEscolher={inserirEmoji} />
            <button type="button" className="chat-anexo-btn" title="Enviar imagem ou arquivo" aria-label="Anexar arquivo"
              onClick={() => inputArquivo.current?.click()} disabled={enviando}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M21.4 11.1l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>
            </button>
            <input ref={inputArquivo} type="file" accept={ACEITA_ANEXO} hidden
              onChange={(e) => { const f = (e.target.files || [])[0]; e.target.value = ''; prepararArquivo(f); }} />
            <textarea ref={caixaTexto} value={texto} onChange={(e) => setTexto(e.target.value)} rows={1} onPaste={aoColar}
              placeholder="Digite sua mensagem" maxLength={4000}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
            <button className="btn btn-primary" type="submit" disabled={(!texto.trim() && !pendente) || enviando}>
              {enviando ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </section>
      )}

      {ativa && painel && ativa.tipo === 'grupo' && (
        <PainelGrupo
          conversa={ativa} equipe={equipe} usuarioId={usuario?.id} ehAdmin={ehAdmin}
          onFechar={() => setPainel(false)}
          onMudou={carregarConversas}
          onSaiu={() => { setPainel(false); setAtivaId(null); carregarConversas(); }}
        />
      )}

      {modalNova && (
        <ModalNova
          equipe={equipe} usuarioId={usuario?.id}
          onFechar={() => setModalNova(false)}
          onCriada={(c) => { setModalNova(false); carregarConversas(); setAtivaId(c.id); }}
        />
      )}
    </div>
  );
}
