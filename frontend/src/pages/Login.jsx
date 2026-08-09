import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { usuario, carregando, login } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [erroTipo, setErroTipo] = useState('erro'); // 'erro' | 'aviso' (bloqueio)
  const [enviando, setEnviando] = useState(false);
  // Anti-autofill: os campos nascem readOnly para o Chrome NAO preencher
  // sozinho as credenciais salvas/sincronizadas (conta Google compartilhada).
  // Ao clicar/focar, liberamos para digitar. Evita "abrir o URL e entrar como
  // o ultimo usuario" em outra maquina.
  const [bloqueado, setBloqueado] = useState(true);
  const liberar = () => setBloqueado(false);
  // O Chrome oferece as senhas salvas sempre que ve um <input type="password">
  // num formulario de login. Truque: no Chrome usamos type="text" com mascara
  // de bolinhas via CSS (-webkit-text-security), assim o gerenciador de senhas
  // NAO reconhece o campo como senha e para de sugerir/salvar. O olhinho ainda
  // alterna mostrar/ocultar. Sem suporte a mascara (Firefox/Safari), cai no
  // type="password" normal — mas o vazamento por conta compartilhada e do Chrome.
  const suportaMascara = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('-webkit-text-security', 'disc');
  const tipoSenha = suportaMascara ? 'text' : (verSenha ? 'text' : 'password');
  const classeSenha = suportaMascara && !verSenha ? 'senha-mascarada' : '';

  if (!carregando && usuario) return <Navigate to="/" replace />;

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await login(u.trim(), senha);
      nav('/', { replace: true });
    } catch (err) {
      setErro(err.message || 'Não foi possível entrar');
      // 429 = bloqueio por tentativas / limite -> mostra como aviso, nao erro
      setErroTipo(err.status === 429 ? 'aviso' : 'erro');
      setEnviando(false);
    }
  };

  return (
    <div className="login-wrap">
      <main className="login-card">
        <div className="login-brand">
          <div className="logo">Colodel<span className="dot" /></div>
        </div>
        <div className="login-eyebrow">Sistema Operacional interno</div>

        {erro && (
          <div className={erroTipo === 'aviso' ? 'form-aviso' : 'form-erro'} style={{ display: 'block' }}>
            {erroTipo === 'aviso' ? '🔒 ' : ''}{erro}
          </div>
        )}

        <form onSubmit={enviar} autoComplete="off">
          <div className="campo">
            <label htmlFor="usuario">Usuário</label>
            <input type="text" id="usuario" name="colodel-usuario" value={u}
              onChange={(e) => setU(e.target.value)} placeholder="Seu usuário" required
              autoComplete="off" readOnly={bloqueado} onFocus={liberar} onMouseDown={liberar} />
          </div>
          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <div className="campo-senha">
              <input type={tipoSenha} className={classeSenha} id="senha" name="colodel-senha" value={senha}
                onChange={(e) => setSenha(e.target.value)} placeholder="Sua senha" required
                autoComplete="off" readOnly={bloqueado} onFocus={liberar} onMouseDown={liberar} />
              <button type="button" className="olho-senha" onClick={() => setVerSenha((v) => !v)}
                aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                title={verSenha ? 'Ocultar senha' : 'Mostrar senha'} tabIndex={-1}>
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
          <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>{enviando ? 'Entrando...' : 'Entrar'}</button>
        </form>

        <div className="login-foot">Acesso restrito à equipe.</div>
      </main>
    </div>
  );
}
