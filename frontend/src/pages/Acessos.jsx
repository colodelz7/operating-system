import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { copiarTexto, formatarQuando } from '../lib/format';

/* ============================================================
   COFRE DE ACESSOS (so admin)
   A senha nunca vem na lista: e preciso clicar em "Ver" para cada
   uma, e cada senha aberta fica registrada no Historico. Depois de
   30 segundos ela volta a ficar escondida sozinha.
   ============================================================ */

const OCULTAR_EM_MS = 30000;

function CampoSenhaCofre({ acesso }) {
  const toast = useToast();
  const [senha, setSenha] = useState(null);
  const [abrindo, setAbrindo] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function revelar() {
    setAbrindo(true);
    try {
      const r = await API.post(`/api/acessos/${acesso.id}/revelar`);
      setSenha(r.senha);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSenha(null), OCULTAR_EM_MS);
    } catch (e) { toast(e.message, 'erro'); }
    finally { setAbrindo(false); }
  }

  async function copiar() {
    const ok = await copiarTexto(senha);
    toast(ok ? 'Senha copiada ✓' : 'Não consegui copiar', ok ? 'ok' : 'erro');
  }

  if (!acesso.tem_senha) return <span className="ac-vazio">sem senha</span>;
  return (
    <span className="ac-senha">
      <code>{senha === null ? '••••••••' : senha}</code>
      {senha === null
        ? <button className="btn btn-ghost btn-sm" onClick={revelar} disabled={abrindo}>{abrindo ? '...' : 'Ver'}</button>
        : (
          <>
            <button className="btn btn-primary btn-sm" onClick={copiar}>Copiar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSenha(null)}>Ocultar</button>
          </>
        )}
    </span>
  );
}

function ModalAcesso({ acesso, clientes, onFechar, onSalvo }) {
  const toast = useToast();
  const ed = !!acesso;
  const [f, setF] = useState({
    servico: acesso?.servico || '', cliente_id: acesso?.cliente_id ? String(acesso.cliente_id) : '',
    url: acesso?.url || '', login: acesso?.login || '', senha: '', observacoes: acesso?.observacoes || '',
  });
  const [apagarSenha, setApagarSenha] = useState(false);
  const [verDigitada, setVerDigitada] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function salvar() {
    if (!f.servico.trim()) { toast('Informe o serviço', 'erro'); return; }
    setSalvando(true);
    const corpo = { servico: f.servico, cliente_id: f.cliente_id ? Number(f.cliente_id) : null,
                    url: f.url, login: f.login, observacoes: f.observacoes };
    // na edicao, senha em branco = manter a atual
    if (!ed || f.senha) corpo.senha = f.senha;
    if (ed && apagarSenha) corpo.senha = '';
    try {
      if (ed) await API.put(`/api/acessos/${acesso.id}`, corpo);
      else await API.post('/api/acessos', corpo);
      toast('Acesso salvo ✓', 'ok');
      onSalvo();
    } catch (e) { toast(e.message, 'erro'); }
    finally { setSalvando(false); }
  }

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" role="dialog" aria-label={ed ? 'Editar acesso' : 'Novo acesso'}>
        <div className="modal-topo">
          <h3>{ed ? 'Editar acesso' : 'Novo acesso'}</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">&times;</button>
        </div>
        {/* autocomplete desligado: o gerenciador de senhas do navegador nao
            deve oferecer salvar a senha do cliente na conta de quem digita */}
        <form className="modal-corpo" autoComplete="off" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
          <div className="grid-2">
            <div className="campo"><label>Serviço</label>
              <input value={f.servico} onChange={(e) => set('servico', e.target.value)} placeholder="Hospedagem, Instagram, WordPress..." autoFocus />
            </div>
            <div className="campo"><label>Cliente</label>
              <select value={f.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                <option value="">Interno (sem cliente)</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.empresa}</option>)}
              </select>
            </div>
          </div>
          <div className="campo"><label>Endereço de acesso</label>
            <input value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://painel.exemplo.com" />
          </div>
          <div className="grid-2">
            <div className="campo"><label>Login</label>
              <input value={f.login} onChange={(e) => set('login', e.target.value)} autoComplete="off" />
            </div>
            <div className="campo campo-senha"><label>{ed ? 'Nova senha (em branco mantém a atual)' : 'Senha'}</label>
              <input
                className={verDigitada ? '' : 'senha-mascarada'} value={f.senha}
                onChange={(e) => set('senha', e.target.value)} autoComplete="off" disabled={apagarSenha}
              />
              <button type="button" className="olho-senha" onClick={() => setVerDigitada((v) => !v)} aria-label="Mostrar ou ocultar a senha digitada">👁</button>
            </div>
          </div>
          {ed && acesso.tem_senha && (
            <label className="ac-apagar"><input type="checkbox" checked={apagarSenha} onChange={(e) => setApagarSenha(e.target.checked)} /> Apagar a senha guardada</label>
          )}
          <div className="campo"><label>Observações</label>
            <textarea value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} placeholder="Autenticação em dois fatores, quem tem o celular, etc." />
          </div>
          <button type="submit" hidden />
        </form>
        <div className="modal-rodape">
          <button className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Acessos() {
  const toast = useToast();
  const [acessos, setAcessos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState(null);

  const carregar = useCallback(async () => {
    try { setAcessos((await API.get('/api/acessos')).acessos || []); setErro(null); }
    catch (e) { setErro(e); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => {
    carregar();
    API.get('/api/clientes').then((r) => setClientes(r.clientes || [])).catch(() => {});
  }, [carregar]);

  async function excluir(a) {
    if (!window.confirm(`Excluir o acesso "${a.servico}"${a.cliente_nome ? ' de ' + a.cliente_nome : ''}?`)) return;
    try { await API.del(`/api/acessos/${a.id}`); toast('Acesso excluído', 'ok'); carregar(); }
    catch (e) { toast(e.message, 'erro'); }
  }
  async function copiarLogin(a) {
    const ok = await copiarTexto(a.login);
    toast(ok ? 'Login copiado ✓' : 'Não consegui copiar', ok ? 'ok' : 'erro');
  }

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro && erro.dados && erro.dados.cofre_desligado) {
    return (
      <div className="vazio">
        <b>Cofre desligado</b>
        Para ligar, o responsável pelo servidor precisa definir COFRE_CHAVE no arquivo .env do backend
        (32 bytes em base64) e reiniciar a API. As senhas ficam cifradas com essa chave.
      </div>
    );
  }
  if (erro) return <div className="vazio"><b>Não foi possível carregar</b>{erro.message}</div>;

  const termo = busca.trim().toLowerCase();
  const visiveis = acessos.filter((a) => !termo || [a.servico, a.cliente_nome, a.login, a.url, a.observacoes]
    .some((x) => String(x || '').toLowerCase().includes(termo)));
  const grupos = {};
  visiveis.forEach((a) => { const g = a.cliente_nome || 'Interno'; (grupos[g] = grupos[g] || []).push(a); });

  return (
    <>
      <div className="prompt-topo">
        <div className="prompt-titulo">
          <h3>Cofre de acessos</h3>
          <small className="dica">Senhas cifradas no servidor. Cada senha aberta fica registrada no Histórico.</small>
          <div className="cli-busca prompt-busca">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" placeholder="Buscar cliente, serviço, login..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary prompt-add" onClick={() => setModal({})}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
          Novo acesso
        </button>
      </div>

      {Object.keys(grupos).sort((a, b) => a.localeCompare(b)).map((g) => (
        <section key={g} className="ac-grupo">
          <h4>{g}</h4>
          {grupos[g].map((a) => (
            <div key={a.id} className="ac-linha">
              <div className="ac-servico">
                <b>{a.servico}</b>
                {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer">{a.url.replace(/^https?:\/\//, '')}</a>}
              </div>
              <div className="ac-login">
                {a.login ? <button className="ac-copiar" onClick={() => copiarLogin(a)} title="Copiar login">{a.login}</button> : <span className="ac-vazio">sem login</span>}
              </div>
              <CampoSenhaCofre acesso={a} />
              <div className="ac-acoes">
                <small title={a.observacoes || ''}>{formatarQuando(a.atualizado_em)}</small>
                <button className="btn btn-ghost btn-sm" onClick={() => setModal({ acesso: a })}>Editar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => excluir(a)} aria-label="Excluir">✕</button>
              </div>
              {a.observacoes && <div className="ac-obs">{a.observacoes}</div>}
            </div>
          ))}
        </section>
      ))}
      {!visiveis.length && (
        <div className="vazio"><b>{termo ? 'Nada encontrado' : 'Cofre vazio'}</b>{termo ? 'Tente outra busca.' : 'Guarde o primeiro acesso em "+ Novo acesso".'}</div>
      )}

      {modal && (
        <ModalAcesso
          acesso={modal.acesso || null} clientes={clientes}
          onFechar={() => setModal(null)} onSalvo={() => { setModal(null); carregar(); }}
        />
      )}
    </>
  );
}
