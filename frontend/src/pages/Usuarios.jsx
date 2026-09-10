import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import { iniciais } from '../lib/format';

/* ============================================================
   Gerenciamento de usuários (só admin/Atendimento).
   Criar, editar, excluir; setor, permissão e, no Criativo,
   quais colunas (tipos de tarefa) o membro enxerga.
   ============================================================ */

function ModalUsuario({ usuario, setores, criativoId, onClose, onSalvo }) {
  const toast = useToast();
  const { usuario: eu } = useAuth();
  const ed = !!usuario;

  const [form, setForm] = useState(() => ({
    nome: usuario?.nome || '',
    usuario: usuario?.usuario || '',
    senha: '',
    setor_id: usuario?.setor_id || (setores[0]?.id ?? ''),
    papel: usuario?.papel || 'membro',
    pode_clientes: !!usuario?.pode_clientes,
    ativo: usuario ? usuario.ativo !== false : true,
  }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const ehCriativo = Number(form.setor_id) === criativoId;
  const souEu = ed && eu?.id === usuario.id;

  const [colunas, setColunas] = useState([]);
  const [selecionadas, setSelecionadas] = useState(null); // Set(ids) | null enquanto carrega
  const [verSenha, setVerSenha] = useState(false);

  // Carrega as colunas do Criativo quando esse setor está selecionado.
  useEffect(() => {
    if (!ehCriativo || !criativoId) { setColunas([]); setSelecionadas(null); return; }
    let vivo = true;
    (async () => {
      try {
        const cols = (await API.get(`/api/setores/${criativoId}/colunas`)).colunas;
        if (!vivo) return;
        setColunas(cols);
        const salvas = usuario?.colunas_visiveis;
        // null/[] salvo = vê todas -> começa com tudo marcado
        const base = (Array.isArray(salvas) && salvas.length)
          ? new Set(salvas)
          : new Set(cols.map((c) => c.id));
        setSelecionadas(base);
      } catch (e) { if (vivo) toast(e.message, 'erro'); }
    })();
    return () => { vivo = false; };
  }, [ehCriativo, criativoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelecionadas((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function salvar() {
    if (!form.nome.trim()) { toast('Informe o nome', 'erro'); return; }
    if (!form.usuario.trim()) { toast('Informe o login', 'erro'); return; }
    if (!ed && form.senha.length < 6) { toast('A senha deve ter ao menos 6 caracteres', 'erro'); return; }

    const payload = {
      nome: form.nome.trim(),
      usuario: form.usuario.trim(),
      setor_id: Number(form.setor_id),
      papel: form.papel,
      pode_clientes: !!form.pode_clientes,
    };
    // so faz sentido ligar/desligar quem ja existe
    if (ed) payload.ativo = !!form.ativo;
    if (form.senha) payload.senha = form.senha;

    if (ehCriativo) {
      if (selecionadas && selecionadas.size === 0) {
        toast('Selecione ao menos uma coluna para o Criativo', 'erro'); return;
      }
      // tudo marcado = vê todas -> manda [] (backend guarda como "todas")
      const todas = colunas.length && selecionadas && selecionadas.size === colunas.length;
      payload.colunas_visiveis = todas ? [] : Array.from(selecionadas || []);
    } else {
      payload.colunas_visiveis = [];
    }

    try {
      if (ed) await API.put(`/api/usuarios/${usuario.id}`, payload);
      else await API.post('/api/usuarios', payload);
      toast(ed ? 'Usuário salvo ✓' : 'Usuário criado ✓', 'ok');
      onSalvo(); onClose();
    } catch (e) { toast(e.message, 'erro'); }
  }

  async function excluir() {
    if (!confirm(`Excluir o usuário "${usuario.nome}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await API.del(`/api/usuarios/${usuario.id}`);
      toast('Usuário excluído', 'ok'); onSalvo(); onClose();
    } catch (e) { toast(e.message, 'erro'); }
  }

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-topo">
          <h3>{ed ? 'Editar usuário' : 'Novo usuário'}</h3>
          <button className="fechar" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-corpo">
          <div className="grid-2">
            <div className="campo"><label>Nome</label>
              <input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex: Ana Souza" /></div>
            <div className="campo"><label>Login (usuário)</label>
              <input value={form.usuario} onChange={(e) => set('usuario', e.target.value.toLowerCase())}
                placeholder="ex: ana" autoCapitalize="none" spellCheck={false} /></div>
          </div>

          <div className="grid-2">
            <div className="campo"><label>Setor</label>
              <select value={form.setor_id} onChange={(e) => set('setor_id', e.target.value)}>
                {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select></div>
            <div className="campo"><label>Permissão</label>
              <select value={form.papel} onChange={(e) => set('papel', e.target.value)} disabled={souEu}>
                <option value="membro">Membro: vê só o próprio setor</option>
                <option value="admin">Admin: acesso total ao sistema</option>
              </select>
              <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                A permissão é independente do setor. Alguém do Atendimento pode ser apenas Membro.
              </small>
              {souEu && <small style={{ color: 'var(--muted)', fontSize: 12 }}>Você não pode alterar a própria permissão.</small>}
            </div>
          </div>

          <div className="campo">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }}
                checked={!!form.pode_clientes} onChange={(e) => set('pode_clientes', e.target.checked)} />
              Pode cadastrar e editar clientes
            </label>
            <small style={{ color: 'var(--muted)', fontSize: 12 }}>
              Admins e o setor Comercial já podem por padrão. Marque para liberar a esta pessoa.
            </small>
          </div>

          {ed && (
            <div className="campo">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: souEu ? 'default' : 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto' }} disabled={souEu}
                  checked={!!form.ativo} onChange={(e) => set('ativo', e.target.checked)} />
                Conta ativa
              </label>
              <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                Desmarcar tira o acesso na hora, inclusive de quem já está logado, sem apagar
                o histórico da pessoa.{souEu ? ' Você não pode desativar a própria conta.' : ''}
              </small>
            </div>
          )}

          <div className="campo">
            <label>{ed ? 'Nova senha (em branco = manter a atual)' : 'Senha'}</label>
            <div className="campo-senha">
              <input type={verSenha ? 'text' : 'password'} value={form.senha}
                onChange={(e) => set('senha', e.target.value)}
                placeholder={ed ? '••••••' : 'mínimo 6 caracteres'} autoComplete="new-password" />
              <button type="button" className="olho-senha" onClick={() => setVerSenha((v) => !v)}
                aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                title={verSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                {verSenha ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {ehCriativo && (
            <div className="campo">
              <label>Colunas que este membro vê no Criativo</label>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '2px 0 8px' }}>
                Marque os tipos de tarefa (design, edição, PDF etc.) que aparecem para esta pessoa.
                Com tudo marcado, ela vê o fluxo completo.
              </p>
              {selecionadas === null
                ? <div className="carregando" style={{ padding: 12 }}><div className="spinner" /></div>
                : (
                  <div className="chips">
                    {colunas.map((c) => (
                      <button type="button" key={c.id}
                        className={`chip ${selecionadas.has(c.id) ? 'on' : ''}`}
                        onClick={() => toggle(c.id)}>{c.nome}</button>
                    ))}
                  </div>
                )}
            </div>
          )}
        </div>
        <div className="modal-rodape">
          {ed && !souEu && <button className="btn btn-perigo" onClick={excluir}>Excluir</button>}
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}>{ed ? 'Salvar' : 'Criar usuário'}</button>
        </div>
      </div>
    </div>
  );
}

const linhaStyle = {
  display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
  padding: '12px 16px', border: '1px solid var(--linha)', borderRadius: 12,
  background: 'var(--surface, var(--surface-2))', color: 'var(--txt)', cursor: 'pointer',
};

export default function Usuarios() {
  const { setores } = useApp();
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState({ aberto: false, usuario: null });

  const criativoId = (setores.find((s) => s.slug === 'criativo') || {}).id;

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try { setUsuarios((await API.get('/api/usuarios')).usuarios); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const nomeSetor = (id) => (setores.find((s) => s.id === id) || {}).nome || '-';
  const resumoColunas = (u) => {
    if (u.setor_id !== criativoId) return null;
    if (!Array.isArray(u.colunas_visiveis) || !u.colunas_visiveis.length) return 'Vê todas as colunas';
    return `Vê ${u.colunas_visiveis.length} coluna(s)`;
  };

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Erro ao carregar</b>{erro}</div>;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>Usuários</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{usuarios.length} pessoa(s) na equipe</p>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
          onClick={() => setModal({ aberto: true, usuario: null })}>+ Novo usuário</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {usuarios.map((u) => {
          const cols = resumoColunas(u);
          return (
            <button key={u.id} onClick={() => setModal({ aberto: true, usuario: u })}
              style={u.ativo === false ? { ...linhaStyle, opacity: 0.55 } : linhaStyle}>
              <div className="avatar">{iniciais(u.nome)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{u.nome}</b>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>@{u.usuario}</span>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {cols && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{cols}</span>}
                <span style={{ fontSize: 13 }}>{nomeSetor(u.setor_id)}</span>
                <span className={`chip ${u.papel === 'admin' ? 'on' : ''}`}
                  style={{ pointerEvents: 'none', fontSize: 12, padding: '4px 10px' }}>
                  {u.papel === 'admin' ? 'Admin' : 'Membro'}
                </span>
                {u.ativo === false && (
                  <span className="chip" style={{
                    pointerEvents: 'none', fontSize: 12, padding: '4px 10px',
                    color: 'var(--st-atrasada)',
                    borderColor: 'color-mix(in srgb, var(--st-atrasada) 45%, transparent)',
                  }}>Inativo</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {modal.aberto && (
        <ModalUsuario usuario={modal.usuario} setores={setores} criativoId={criativoId}
          onClose={() => setModal({ aberto: false, usuario: null })} onSalvo={carregar} />
      )}
    </>
  );
}