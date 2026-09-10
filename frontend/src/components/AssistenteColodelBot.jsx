import { useState, useEffect, useRef, useCallback } from 'react';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import RoboColodel from './RoboColodel';

/* ColodelBot dentro do sistema.
   Botao flutuante que abre um chat. A conversa vai para /api/assistente: quem
   fala com o modelo e executa as acoes e o servidor, usando a sessao de quem
   esta logado. Ou seja, o bot faz exatamente o que essa pessoa poderia fazer
   pela tela, nem mais nem menos. */

const SAUDACAO = {
  autor: 'bot',
  texto: 'Oi! Sou o ColodelBot. Posso criar, editar, mover e consultar demandas, '
    + 'clientes e usuários por aqui. Por exemplo: "crie uma demanda no '
    + 'Desenvolvimento, título Landing page, entrega dia 20".',
};

// nomes das ferramentas em portugues, para a etiqueta embaixo do balao
const ROTULO_ACAO = {
  criar_tarefa: 'demanda criada',
  editar_tarefa: 'demanda editada',
  mover_tarefa: 'demanda movida',
  excluir_tarefa: 'demanda excluída',
  criar_cliente: 'cliente cadastrado',
  editar_cliente: 'cliente editado',
  excluir_cliente: 'cliente excluído',
  criar_usuario: 'usuário criado',
  editar_usuario: 'usuário editado',
  excluir_usuario: 'usuário excluído',
};

// enquanto o bot trabalha, mostramos o que ele esta fazendo
const ROTULO_PASSO = {
  listar_setores: 'conferindo os setores',
  listar_colunas: 'vendo as colunas do quadro',
  listar_pessoas_do_setor: 'procurando as pessoas do setor',
  listar_clientes: 'procurando o cliente',
  listar_tarefas: 'lendo as demandas',
  listar_comentarios: 'lendo os comentários',
  buscar_tarefa: 'abrindo a demanda',
  listar_usuarios: 'conferindo os usuários',
  consultar_historico: 'consultando o histórico',
  resumo_do_dia: 'montando o resumo do dia',
  criar_tarefa: 'criando a demanda',
  editar_tarefa: 'editando a demanda',
  mover_tarefa: 'movendo o card',
  comentar_tarefa: 'escrevendo o comentário',
  duplicar_tarefa: 'duplicando a demanda',
  excluir_tarefa: 'excluindo a demanda',
  criar_cliente: 'cadastrando o cliente',
  editar_cliente: 'editando o cliente',
  excluir_cliente: 'excluindo o cliente',
  criar_usuario: 'criando o usuário',
  editar_usuario: 'editando o usuário',
  excluir_usuario: 'excluindo o usuário',
};

// perguntas prontas, para quem nao sabe o que pedir
const ATALHOS = [
  { rot: '📋 Resumo do dia', texto: 'Me dê o resumo do dia' },
  { rot: '⏰ O que está atrasado', texto: 'O que está atrasado?' },
  { rot: '📅 Vence hoje', texto: 'O que vence hoje?' },
];

// a conversa fica no navegador de quem usa, separada por pessoa
const chaveMemoria = (id) => `colodelbot-conversa-${id}`;
const MAX_GUARDADAS = 40;

function lerConversa(id) {
  try {
    const bruto = localStorage.getItem(chaveMemoria(id));
    const lista = bruto ? JSON.parse(bruto) : null;
    return Array.isArray(lista) && lista.length ? lista : [SAUDACAO];
  } catch (_) { return [SAUDACAO]; }
}

function Icone({ nome, t = 20 }) {
  const traco = {
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const formas = {
    robo: <g {...traco}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 14h.01M15 14h.01M9 17.5h6" /><circle cx="12" cy="3" r="1" /></g>,
    enviar: <g {...traco}><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" /></g>,
    fechar: <g {...traco}><path d="M6 6l12 12M18 6L6 18" /></g>,
    limpar: <g {...traco}><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" /></g>,
  };
  return (
    <svg width={t} height={t} viewBox="0 0 24 24" aria-hidden="true">
      {formas[nome] || formas.robo}
    </svg>
  );
}

export default function AssistenteColodelBot() {
  const { usuario } = useAuth();
  const { refresh, recarregarClientes } = useApp();
  const toast = useToast();

  const [disponivel, setDisponivel] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState([SAUDACAO]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [comemorando, setComemorando] = useState(false);
  const [passo, setPasso] = useState('');

  const fimRef = useRef(null);
  const campoRef = useRef(null);
  const janelaRef = useRef(null);
  const botaoRef = useRef(null);

  // o botao so aparece se o servidor tiver o assistente configurado
  useEffect(() => {
    if (!usuario) { setDisponivel(false); return undefined; }
    let vivo = true;
    (async () => {
      try {
        const r = await API.get('/api/assistente/status');
        if (vivo) setDisponivel(!!r.disponivel);
      } catch (_) { if (vivo) setDisponivel(false); }
    })();
    return () => { vivo = false; };
  }, [usuario]);

  // retoma a conversa de quem entrou (e zera ao trocar de pessoa)
  useEffect(() => {
    setMensagens(usuario ? lerConversa(usuario.id) : [SAUDACAO]);
  }, [usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // guarda a conversa para ela sobreviver ao F5
  useEffect(() => {
    if (!usuario) return;
    try {
      localStorage.setItem(chaveMemoria(usuario.id), JSON.stringify(mensagens.slice(-MAX_GUARDADAS)));
    } catch (_) { /* navegador sem espaco ou em aba privada: segue sem guardar */ }
  }, [mensagens, usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // rola para a ultima mensagem e devolve o foco ao campo
  useEffect(() => {
    if (!aberto) return;
    fimRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    if (!pensando) campoRef.current?.focus();
  }, [aberto, mensagens, pensando]);

  // Esc fecha e o Tab circula dentro da janela (nao vaza para a pagina atras)
  useEffect(() => {
    if (!aberto) return undefined;
    const aoTeclar = (e) => {
      if (e.key === 'Escape') { setAberto(false); botaoRef.current?.focus(); return; }
      if (e.key !== 'Tab' || !janelaRef.current) return;
      const focaveis = janelaRef.current.querySelectorAll('button, textarea, a[href], input');
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  const enviar = useCallback(async () => {
    const frase = texto.trim();
    if (!frase || pensando) return;

    // o historico enviado é o que já estava na tela, sem a saudação fixa
    const historico = mensagens.filter((m) => m.texto !== SAUDACAO.texto).slice(-12)
      .map((m) => ({ autor: m.autor, texto: m.texto }));
    setMensagens((lista) => [...lista, { autor: 'usuario', texto: frase }]);
    setTexto('');
    setPensando(true);

    // balao vazio do bot: o texto vai sendo preenchido conforme chega
    setMensagens((lista) => [...lista, { autor: 'bot', texto: '', streaming: true }]);
    const escrever = (pedaco) => setMensagens((lista) => {
      const copia = lista.slice();
      const ultimo = copia[copia.length - 1];
      if (ultimo && ultimo.streaming) copia[copia.length - 1] = { ...ultimo, texto: ultimo.texto + pedaco };
      return copia;
    });
    const fechar = (dados, erro) => setMensagens((lista) => {
      const copia = lista.slice();
      const ultimo = copia[copia.length - 1];
      if (!ultimo || !ultimo.streaming) return lista;
      copia[copia.length - 1] = erro
        ? { autor: 'bot', erro: true, texto: erro }
        : {
          autor: 'bot',
          texto: dados.resposta || ultimo.texto || 'Certo.',
          acoes: dados.acoes || [],
          falhas: dados.falhas || [],
        };
      return copia;
    });

    const aplicarMudanca = (dados) => {
      if (!dados || !dados.mudou) return;
      refresh();
      if ((dados.acoes || []).some((a) => a.ferramenta.includes('cliente'))) recarregarClientes();
      toast('O ColodelBot atualizou o sistema ✓', 'ok');
      setComemorando(true);
      setTimeout(() => setComemorando(false), 2600);
    };

    try {
      const fim = await API.stream('/api/assistente/stream', { mensagem: frase, historico }, (tipo, dados) => {
        if (tipo === 'delta') { setPasso(''); escrever(dados.texto || ''); }
        else if (tipo === 'passo') setPasso(ROTULO_PASSO[dados.ferramenta] || 'trabalhando');
        else if (tipo === 'erro') fechar(null, dados.mensagem);
      });
      if (fim) { fechar(fim); aplicarMudanca(fim); }
    } catch (e) {
      // streaming indisponivel (proxy que segura o fluxo, por exemplo):
      // refaz o pedido pela rota normal, que responde de uma vez so
      try {
        const r = await API.post('/api/assistente', { mensagem: frase, historico });
        fechar(r);
        aplicarMudanca(r);
      } catch (e2) {
        fechar(null, e2.message || e.message);
      }
    } finally {
      setPensando(false);
      setPasso('');
    }
  }, [texto, pensando, mensagens, refresh, recarregarClientes, toast]);

  const aoTeclarNoCampo = (e) => {
    // Enter envia, Shift+Enter quebra linha
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  };

  const limpar = () => {
    setMensagens([SAUDACAO]);
    try { if (usuario) localStorage.removeItem(chaveMemoria(usuario.id)); } catch (_) { /* ignora */ }
  };

  if (!usuario || !disponivel) return null;

  // eslint-disable-next-line no-nested-ternary
  const estadoRobo = pensando ? 'pensando' : (comemorando ? 'feliz' : 'ocioso');

  return (
    <>
      {aberto && (
        <div className="bot-janela" role="dialog" aria-label="ColodelBot" aria-modal="false" ref={janelaRef}>
          <RoboColodel estado={estadoRobo} />

          <header className="bot-topo">
            <div className="bot-ident">
              <b>ColodelBot</b>
              <span>{pensando ? (passo ? passo + '...' : 'pensando...') : 'à disposição'}</span>
            </div>
            <button className="bot-acao" title="Limpar conversa" aria-label="Limpar conversa" onClick={limpar}>
              <Icone nome="limpar" t={16} />
            </button>
            <button className="bot-acao" title="Fechar" aria-label="Fechar"
              onClick={() => { setAberto(false); botaoRef.current?.focus(); }}>
              <Icone nome="fechar" t={16} />
            </button>
          </header>

          <div className="bot-conversa" role="log" aria-live="polite" aria-relevant="additions text">
            {mensagens.map((m, i) => (
              <div key={i} className={`bot-msg ${m.autor} ${m.erro ? 'erro' : ''}`}>
                {String(m.texto).split('\n').filter(Boolean).map((linha, j) => <p key={j}>{linha}</p>)}
                {!!((m.acoes && m.acoes.length) || (m.falhas && m.falhas.length)) && (
                  <div className="bot-acoes">
                    {(m.acoes || []).map((a, j) => (
                      <span key={`ok${j}`} className="bot-chip">✓ {ROTULO_ACAO[a.ferramenta] || a.ferramenta}</span>
                    ))}
                    {/* o que a API recusou aparece aqui, mesmo que o texto do bot diga outra coisa */}
                    {(m.falhas || []).map((f, j) => (
                      <span key={`x${j}`} className="bot-chip falha">✕ {ROTULO_ACAO[f.ferramenta] || f.ferramenta}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {pensando && !mensagens[mensagens.length - 1]?.texto && (
              <div className="bot-msg bot pensando">
                <span className="bot-ponto" /><span className="bot-ponto" /><span className="bot-ponto" />
                {passo && <span className="bot-passo">{passo}</span>}
              </div>
            )}
            <div ref={fimRef} />
          </div>

          {mensagens.length <= 1 && !pensando && (
            <div className="bot-atalhos">
              {ATALHOS.map((a) => (
                <button key={a.rot} type="button" className="bot-atalho"
                  onClick={() => { setTexto(a.texto); campoRef.current?.focus(); }}>
                  {a.rot}
                </button>
              ))}
            </div>
          )}

          <div className="bot-envio">
            <textarea
              ref={campoRef} rows={1} value={texto} placeholder="Peça alguma coisa..."
              onChange={(e) => setTexto(e.target.value)} onKeyDown={aoTeclarNoCampo}
              disabled={pensando} aria-label="Mensagem para o ColodelBot"
            />
            <button className="bot-enviar" onClick={enviar} disabled={pensando || !texto.trim()}
              title="Enviar" aria-label="Enviar">
              <Icone nome="enviar" t={18} />
            </button>
          </div>
        </div>
      )}

      <button type="button" ref={botaoRef} className={`bot-botao ${aberto ? 'aberto' : ''} ${pensando ? 'trabalhando' : ''}`}
        aria-expanded={aberto} aria-label="Abrir o ColodelBot" title="ColodelBot"
        onClick={() => setAberto((v) => !v)}>
        <Icone nome={aberto ? 'fechar' : 'robo'} t={24} />
      </button>
    </>
  );
}
