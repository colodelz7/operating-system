import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { API } from '../lib/api';
import CalendarioEquipe from './CalendarioEquipe';
import Chat from './Chat';
import Historico from './Historico';
import Briefings from './Briefings';
import Acessos from './Acessos';
import Prompts from './Prompts';

/* As telas novas montam de verdade, com a API trocada por um dublê que
   responde por URL. O objetivo e pegar tela que quebra ao abrir e conferir
   o que cada uma mostra e pede ao servidor. */

vi.mock('../lib/api', () => ({
  API: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

const toast = vi.fn();
const usuario = { id: 1, nome: 'Administrador', papel: 'admin', setor_id: 1, avatar_path: null };
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ usuario, ehAdmin: true, recarregarUsuario: vi.fn() }),
}));
vi.mock('../context/AppContext', () => ({
  useApp: () => ({ setores: [{ id: 1, nome: 'Atendimento' }, { id: 2, nome: 'Comercial' }], refresh: vi.fn(), setorAtivo: 1 }),
}));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../context/TarefaModalContext', () => ({ useTarefaModal: () => ({ abrirDetalhe: vi.fn() }) }));
vi.mock('../context/AgendaContext', () => ({ useAgenda: () => ({ eventosHoje: [], recarregar: vi.fn() }) }));
vi.mock('../context/ChatContext', () => ({ useChat: () => ({ naoLidas: 0, recarregar: vi.fn() }) }));

const hoje = new Date();
const p = (n) => String(n).padStart(2, '0');
const isoHoje = `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-${p(hoje.getDate())}`;

const respostas = {
  '/api/eventos': { eventos: [{ id: 7, titulo: 'Reunião de pauta', data: isoHoje, hora_inicio: '14:00', setor_id: null, criado_por: 2, participantes: [{ id: 1, nome: 'Administrador' }] }] },
  '/api/equipe': { equipe: [{ id: 1, nome: 'Administrador', setor_nome: 'Atendimento' }, { id: 2, nome: 'Morning', setor_nome: 'Criativo' }] },
  '/api/chat/conversas': { conversas: [{ id: 3, tipo: 'direta', membros: [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Morning' }], nao_lidas: 2, ultima_mensagem: { texto: 'Oi!', usuario_nome: 'Morning', criado_em: new Date().toISOString() } }] },
  '/api/chat/conversas/3/mensagens': { mensagens: [{ id: 10, conversa_id: 3, usuario_id: 2, usuario_nome: 'Morning', texto: 'Oi!', criado_em: new Date().toISOString() }], tem_mais: false },
  '/api/historico/opcoes': { clientes: ['Padaria'], responsaveis: ['Morning'], prioridades: ['alta'], tipos: ['login'], entidades: ['tarefa'], setores: [], total: 1 },
  '/api/historico': { historico: [{ id: 1, tipo: 'login', entidade: 'sessao', usuario_nome: 'Morning', detalhe: 'entrou', criado_em: new Date().toISOString() }], tem_mais: false, proximo: 1 },
  '/api/briefings/campos': { campos: [{ titulo: 'Empresa', itens: [{ k: 'nome_fantasia', r: 'Nome fantasia' }, { k: 'servicos', r: 'Serviços', alto: true }] }] },
  '/api/briefings': { briefings: [{ id: 4, empresa: 'Padaria Exemplo', preenchidos: 1, total: 2, atualizado_em: new Date().toISOString() }] },
  '/api/clientes': { clientes: [{ id: 9, empresa: 'Padaria Exemplo' }] },
  '/api/acessos': { acessos: [{ id: 5, servico: 'Hospedagem', login: 'cli@ex.com', tem_senha: true, cliente_nome: 'Padaria Exemplo', atualizado_em: new Date().toISOString() }] },
  '/api/prompts': { itens: [{ id: 6, titulo: 'Legenda de carrossel', conteudo: 'Escreva...', usuario_id: 2, autor_nome: 'Morning', atualizado_em: new Date().toISOString() }] },
};

function responderPorUrl(url) {
  const caminho = url.split('?')[0];
  if (caminho in respostas) return Promise.resolve(respostas[caminho]);
  return Promise.reject(Object.assign(new Error('rota nao simulada: ' + caminho), { status: 404 }));
}

const montar = (ui, rota = '/') => render(<MemoryRouter initialEntries={[rota]}>{ui}</MemoryRouter>);

describe('telas novas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.get.mockImplementation(responderPorUrl);
    API.post.mockResolvedValue({});
  });

  it('Calendario da Equipe mostra o evento do mes e abre o detalhe', async () => {
    const u = userEvent.setup();
    montar(<CalendarioEquipe />);
    const chip = await screen.findByRole('button', { name: /reunião de pauta/i });
    expect(API.get).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/eventos\?de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}$/));
    await u.click(chip);
    // admin pode editar qualquer evento: abre o formulario
    expect(await screen.findByRole('dialog', { name: /editar evento/i })).toBeInTheDocument();
  });

  it('Chat lista a conversa com contador e abre as mensagens', async () => {
    const u = userEvent.setup();
    montar(<Chat />);
    const item = await screen.findByRole('button', { name: /morning/i });
    expect(item).toHaveTextContent('2');
    await u.click(item);
    expect(await screen.findByText('Oi!', { selector: '.chat-msg p' })).toBeInTheDocument();
    await waitFor(() => expect(API.post).toHaveBeenCalledWith('/api/chat/conversas/3/lida', { ate_id: 10 }));
  });

  it('Historico manda o filtro rapido para o servidor', async () => {
    const u = userEvent.setup();
    montar(<Historico />);
    await screen.findByText(/entrou/);
    await u.selectOptions(screen.getByDisplayValue('Registros: todos'), 'falhas');
    await waitFor(() => expect(API.get).toHaveBeenCalledWith(expect.stringContaining('categoria=falhas')));
    expect(screen.getByRole('option', { name: 'Morning' })).toBeInTheDocument();
  });

  it('Briefing monta o formulario com as perguntas do servidor', async () => {
    const u = userEvent.setup();
    montar(<Briefings />);
    expect(await screen.findByText('Padaria Exemplo')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /novo briefing/i }));
    expect(screen.getByLabelText('Nome fantasia')).toBeInTheDocument();
    expect(screen.getByText('0 de 2')).toBeInTheDocument();
  });

  it('Cofre nao mostra a senha ate pedir', async () => {
    const u = userEvent.setup();
    API.post.mockResolvedValue({ senha: 'segredo-123' });
    montar(<Acessos />);
    await screen.findByText('Hospedagem');
    expect(screen.queryByText('segredo-123')).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Ver' }));
    expect(API.post).toHaveBeenCalledWith('/api/acessos/5/revelar');
    expect(await screen.findByText('segredo-123')).toBeInTheDocument();
  });

  it('Cofre desligado explica como ligar', async () => {
    API.get.mockImplementation((url) => (url.startsWith('/api/acessos')
      ? Promise.reject(Object.assign(new Error('desligado'), { status: 503, dados: { cofre_desligado: true } }))
      : responderPorUrl(url)));
    montar(<Acessos />);
    expect(await screen.findByText(/cofre desligado/i)).toBeInTheDocument();
  });

  it('Prompts lista os textos da equipe com o autor', async () => {
    montar(<Prompts />);
    expect(await screen.findByText('Legenda de carrossel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar prompt/i })).toBeInTheDocument();
  });
});
