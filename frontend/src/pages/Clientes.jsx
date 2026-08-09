import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import { iniciais } from '../lib/format';

const CAMPOS = ['empresa', 'razao_social', 'cnpj', 'nicho', 'tamanho', 'cep', 'endereco',
  'complemento', 'cidade', 'estado', 'contato', 'telefone', 'email', 'site', 'instagram'];

function CardCliente({ c, onAbrir }) {
  return (
    <article className="cliente-card" onClick={() => onAbrir(c.id)}>
      {c.logo_path
        ? <img className="logo-cli" src={`/api/clientes/${c.id}/logo`} alt="" />
        : <div className="logo-cli">{iniciais(c.empresa)}</div>}
      <h4>{c.empresa}</h4>
      <div className="nicho">{c.nicho || '—'}{c.tamanho ? ' · ' + c.tamanho : ''}</div>
      <div className="dados">
        {c.contato && <span>👤 {c.contato}</span>}
        {c.telefone && <span>📞 {c.telefone}</span>}
        {c.cidade && <span>📍 {c.cidade}{c.estado ? '/' + c.estado : ''}</span>}
      </div>
      {(c.servicos || []).length > 0 && (
        <div className="dados" style={{ marginTop: 6 }}>
          <span>🛠 {c.servicos.map((s) => s.nome).join(' · ')}</span>
        </div>
      )}
    </article>
  );
}

// Lista oficial de serviços da Colodel (aceita também texto livre)
const SERVICOS_SUGERIDOS = ['Fotografia', 'Mídias Sociais', 'Tráfego Pago', 'Sites/Lojas',
  'Manutenção', 'SEO', 'Branding', 'Google Meu Negócio'];

function ModalCliente({ cliente, podeGerir, onClose, onSalvo }) {
  const { ehAdmin } = useAuth();
  const toast = useToast();
  const ed = !!cliente;
  const logoRef = useRef(null);
  const [form, setForm] = useState(() => {
    const base = {}; CAMPOS.forEach((k) => { base[k] = cliente?.[k] || ''; }); return base;
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ---- serviços contratados (salvos na hora, independentes do botão Salvar) ----
  const [servicos, setServicos] = useState(cliente?.servicos || []);
  const [novoServ, setNovoServ] = useState('');

  async function addServico(nome) {
    const n = (nome || '').trim();
    if (!n) return;
    try {
      const r = await API.post(`/api/clientes/${cliente.id}/servicos`, { nome: n });
      setServicos((s) => [...s, r.servico].sort((a, b) => a.nome.localeCompare(b.nome)));
      setNovoServ('');
      onSalvo();
    } catch (e) { toast(e.message, 'erro'); }
  }
  async function delServico(sid) {
    try {
      await API.del(`/api/clientes/${cliente.id}/servicos/${sid}`);
      setServicos((s) => s.filter((x) => x.id !== sid));
      onSalvo();
    } catch (e) { toast(e.message, 'erro'); }
  }

  // ---- datas importantes do cliente (salvas na hora) ----
  const MM = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const [datas, setDatas] = useState(cliente?.datas || []);
  const [novaData, setNovaData] = useState('');
  const [novaDataNome, setNovaDataNome] = useState('');

  async function addData() {
    if (!novaData || !novaDataNome.trim()) { toast('Preencha a data e o nome', 'erro'); return; }
    try {
      const r = await API.post(`/api/clientes/${cliente.id}/datas`, { data: novaData, nome: novaDataNome.trim() });
      setDatas((d) => [...d, r.data].sort((a, b) => (a.mes - b.mes) || (a.dia - b.dia)));
      setNovaData(''); setNovaDataNome('');
    } catch (e) { toast(e.message, 'erro'); }
  }
  async function delData(did) {
    try {
      await API.del(`/api/clientes/${cliente.id}/datas/${did}`);
      setDatas((d) => d.filter((x) => x.id !== did));
    } catch (e) { toast(e.message, 'erro'); }
  }

  async function salvar() {
    if (!form.empresa.trim()) { toast('Informe o nome da empresa', 'erro'); return; }
    const fd = new FormData();
    CAMPOS.forEach((k) => fd.append(k, (form[k] || '').trim()));
    if (logoRef.current && logoRef.current.files[0]) fd.append('logo', logoRef.current.files[0]);
    try {
      if (ed) await API.put(`/api/clientes/${cliente.id}`, fd, true);
      else await API.post('/api/clientes', fd, true);
      toast(ed ? 'Cliente salvo' : 'Cliente cadastrado ✓', 'ok');
      onSalvo(); onClose();
    } catch (e) { toast(e.message, 'erro'); }
  }

  async function excluir() {
    if (!confirm(`Excluir o cliente "${cliente.empresa}"?`)) return;
    try { await API.del(`/api/clientes/${cliente.id}`); toast('Cliente excluído', 'ok'); onSalvo(); onClose(); }
    catch (e) { toast(e.message, 'erro'); }
  }

  const C = ({ k, label, ...rest }) => (
    <div className="campo" {...rest}><label>{label}</label>
      <input value={form[k]} onChange={(e) => set(k, e.target.value)} /></div>
  );

  return (
    <div className="modal-bg show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-topo">
          <h3>{ed ? 'Editar cliente' : 'Novo cliente'}</h3>
          <button className="fechar" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-corpo">
          {ed && (
            <div className="campo">
              <label>Serviços contratados</label>
              <div className="chips" style={{ marginBottom: 6 }}>
                {servicos.length ? servicos.map((s) => (
                  <span key={s.id} className="chip on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {s.nome}
                    {podeGerir && (
                      <button type="button" onClick={() => delServico(s.id)}
                        title={`Remover ${s.nome}`} aria-label={`Remover ${s.nome}`}
                        style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                    )}
                  </span>
                )) : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum serviço cadastrado.</span>}
              </div>
              {podeGerir && (
                <>
                  <div className="chips" style={{ marginBottom: 6 }}>
                    {SERVICOS_SUGERIDOS.filter((n) => !servicos.some((s) => s.nome.toLowerCase() === n.toLowerCase())).map((n) => (
                      <button type="button" key={n} className="chip" onClick={() => addServico(n)}>+ {n}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={novoServ} onChange={(e) => setNovoServ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addServico(novoServ); } }}
                      placeholder="Outro serviço... (Enter para adicionar)" />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addServico(novoServ)}>Adicionar</button>
                  </div>
                </>
              )}
            </div>
          )}
          {ed && (
            <div className="campo">
              <label>Datas importantes {datas.length ? `(${datas.length})` : ''}</label>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '2px 0 8px' }}>
                Aniversário da empresa, do dono, datas do nicho... aparecem na aba Datas Comemorativas (repetem todo ano).
              </p>
              <div className="chips" style={{ marginBottom: podeGerir ? 8 : 0 }}>
                {datas.length ? datas.map((d) => (
                  <span key={d.id} className="chip on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {String(d.dia).padStart(2, '0')}/{String(d.mes).padStart(2, '0')} · {d.nome}
                    {podeGerir && (
                      <button type="button" onClick={() => delData(d.id)} title="Remover"
                        style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                    )}
                  </span>
                )) : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma data cadastrada.</span>}
              </div>
              {podeGerir && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} style={{ width: 'auto' }} />
                  <input value={novaDataNome} onChange={(e) => setNovaDataNome(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addData(); } }}
                    placeholder="Nome (ex: Aniversário da empresa)" style={{ flex: 1, minWidth: 180 }} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addData}>Adicionar data</button>
                </div>
              )}
            </div>
          )}
          {!ed && podeGerir && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              Serviços e datas importantes podem ser adicionados após cadastrar o cliente.
            </p>
          )}
          <fieldset disabled={!podeGerir} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="grid-2">
            <div className="campo"><label>Empresa (nome fantasia)</label><input value={form.empresa} onChange={(e) => set('empresa', e.target.value)} placeholder="Ex: Cliente Exemplo" /></div>
            <div className="campo"><label>Razão social</label><input value={form.razao_social} onChange={(e) => set('razao_social', e.target.value)} /></div>
          </div>
          <div className="grid-3">
            <div className="campo"><label>CNPJ</label><input value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" /></div>
            <div className="campo"><label>Nicho</label><input value={form.nicho} onChange={(e) => set('nicho', e.target.value)} placeholder="Moda, Saúde..." /></div>
            <div className="campo"><label>Tamanho</label>
              <select value={form.tamanho} onChange={(e) => set('tamanho', e.target.value)}>
                {['', 'Pequena', 'Média', 'Grande'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-3">
            <div className="campo"><label>CEP</label><input value={form.cep} onChange={(e) => set('cep', e.target.value)} /></div>
            <div className="campo" style={{ gridColumn: 'span 2' }}><label>Endereço</label><input value={form.endereco} onChange={(e) => set('endereco', e.target.value)} /></div>
          </div>
          <div className="grid-3">
            <div className="campo"><label>Complemento</label><input value={form.complemento} onChange={(e) => set('complemento', e.target.value)} /></div>
            <div className="campo"><label>Cidade</label><input value={form.cidade} onChange={(e) => set('cidade', e.target.value)} /></div>
            <div className="campo"><label>Estado</label><input value={form.estado} onChange={(e) => set('estado', e.target.value)} placeholder="PR" /></div>
          </div>
          <div className="grid-2">
            <div className="campo"><label>Contato</label><input value={form.contato} onChange={(e) => set('contato', e.target.value)} /></div>
            <div className="campo"><label>Telefone</label><input value={form.telefone} onChange={(e) => set('telefone', e.target.value)} /></div>
          </div>
          <div className="grid-3">
            <div className="campo"><label>E-mail</label><input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="campo"><label>Site</label><input value={form.site} onChange={(e) => set('site', e.target.value)} /></div>
            <div className="campo"><label>Instagram</label><input value={form.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@" /></div>
          </div>
          <div className="campo"><label>Logo (imagem, até 25MB)</label><input type="file" ref={logoRef} accept="image/*" /></div>
          </fieldset>
        </div>
        <div className="modal-rodape">
          {ed && ehAdmin && <button className="btn btn-perigo" onClick={excluir}>Excluir</button>}
          <button className="btn btn-ghost" onClick={onClose}>{podeGerir ? 'Cancelar' : 'Fechar'}</button>
          {podeGerir && <button className="btn btn-primary" onClick={salvar}>{ed ? 'Salvar' : 'Cadastrar'}</button>}
        </div>
      </div>
    </div>
  );
}

export default function Clientes() {
  const toast = useToast();
  const { ehAdmin, usuario } = useAuth();
  const { recarregarClientes } = useApp();
  // edicao de clientes: admin, setor Comercial ou permissao individual
  const podeGerir = ehAdmin || usuario?.setor_slug === 'comercial' || usuario?.pode_clientes;
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState({ aberto: false, cliente: null });

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try { setClientes((await API.get('/api/clientes')).clientes); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirDetalhe = async (id) => {
    try { const c = (await API.get(`/api/clientes/${id}`)).cliente; setModal({ aberto: true, cliente: c }); }
    catch (e) { toast(e.message, 'erro'); }
  };

  const aoSalvo = () => { carregar(); recarregarClientes(); };

  if (carregando) return <div className="carregando"><div className="spinner" />Carregando...</div>;
  if (erro) return <div className="vazio"><b>Erro ao carregar</b>{erro}</div>;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>Clientes</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{clientes.length} empresa(s) cadastrada(s)</p>
        </div>
        {podeGerir && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal({ aberto: true, cliente: null })}>+ Novo cliente</button>
        )}
      </div>

      {clientes.length ? (
        <div className="grid-clientes">
          {clientes.map((c) => <CardCliente key={c.id} c={c} onAbrir={abrirDetalhe} />)}
        </div>
      ) : <div className="vazio"><b>Nenhum cliente ainda</b>Cadastre a primeira empresa para começar.</div>}

      {modal.aberto && (
        <ModalCliente cliente={modal.cliente} podeGerir={podeGerir} onClose={() => setModal({ aberto: false, cliente: null })} onSalvo={aoSalvo} />
      )}
    </>
  );
}
