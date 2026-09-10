import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssistenteColodelBot from './AssistenteColodelBot';
import { API } from '../lib/api';

/* O chat do ColodelBot conversa com /api/assistente. Aqui a API e trocada por
   um dublê: o que interessa e o comportamento da tela, principalmente o que
   ela mostra quando o servidor recusa uma acao. */

vi.mock('../lib/api', () => ({
  API: { get: vi.fn(), post: vi.fn() },
}));

const refresh = vi.fn();
const recarregarClientes = vi.fn();
const toast = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 1, nome: 'Administrador', papel: 'admin' } }),
}));
vi.mock('../context/AppContext', () => ({
  useApp: () => ({ refresh, recarregarClientes }),
}));
vi.mock('../context/ToastContext', () => ({
  useToast: () => toast,
}));

const abrir = async (usuario) => {
  render(<AssistenteColodelBot />);
  const botao = await screen.findByRole('button', { name: /abrir o colodelbot/i });
  await usuario.click(botao);
  return screen.getByRole('dialog', { name: /colodelbot/i });
};

describe('ColodelBot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.get.mockResolvedValue({ disponivel: true, modelo: 'teste' });
  });

  it('nao aparece quando o servidor esta sem assistente configurado', async () => {
    API.get.mockResolvedValue({ disponivel: false });
    render(<AssistenteColodelBot />);
    await waitFor(() => expect(API.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /abrir o colodelbot/i })).not.toBeInTheDocument();
  });

  it('abre a janela com a saudacao e o mascote', async () => {
    const usuario = userEvent.setup();
    const janela = await abrir(usuario);
    expect(janela).toBeInTheDocument();
    expect(screen.getByText(/sou o colodelbot/i)).toBeInTheDocument();
    expect(document.querySelector('.robo')).toBeInTheDocument();
  });

  it('envia a mensagem e mostra a resposta com a etiqueta da acao', async () => {
    const usuario = userEvent.setup();
    API.post.mockResolvedValue({
      resposta: 'Criei a demanda Landing page.',
      acoes: [{ ferramenta: 'criar_tarefa', args: {} }],
      falhas: [],
      mudou: true,
    });

    await abrir(usuario);
    await usuario.type(screen.getByLabelText(/mensagem para o colodelbot/i), 'crie uma demanda');
    await usuario.click(screen.getByRole('button', { name: /^enviar$/i }));

    expect(await screen.findByText(/criei a demanda landing page/i)).toBeInTheDocument();
    expect(screen.getByText(/demanda criada/i)).toBeInTheDocument();
    // acao mexeu em dados: as telas abertas precisam recarregar
    expect(refresh).toHaveBeenCalled();
  });

  it('mostra em vermelho o que a API recusou, mesmo com o texto do bot dizendo outra coisa', async () => {
    const usuario = userEvent.setup();
    API.post.mockResolvedValue({
      resposta: 'Tarefa excluída.',
      acoes: [],
      falhas: [{ ferramenta: 'excluir_tarefa', erro: 'Acesso restrito ao Atendimento' }],
      mudou: false,
    });

    await abrir(usuario);
    await usuario.type(screen.getByLabelText(/mensagem para o colodelbot/i), 'exclua a tarefa 1');
    await usuario.click(screen.getByRole('button', { name: /^enviar$/i }));

    const etiqueta = await screen.findByText(/demanda excluída/i);
    expect(etiqueta).toHaveClass('falha');
    // nada mudou: nao pode sair recarregando tela nem avisando sucesso
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('mostra o erro quando o assistente esta fora do ar', async () => {
    const usuario = userEvent.setup();
    API.post.mockRejectedValue(Object.assign(new Error('O modelo está sobrecarregado.'), { status: 503 }));

    await abrir(usuario);
    await usuario.type(screen.getByLabelText(/mensagem para o colodelbot/i), 'oi');
    await usuario.click(screen.getByRole('button', { name: /^enviar$/i }));

    expect(await screen.findByText(/sobrecarregado/i)).toBeInTheDocument();
  });

  it('guarda a conversa para ela sobreviver ao recarregar da pagina', async () => {
    const usuario = userEvent.setup();
    API.post.mockResolvedValue({ resposta: 'Oi!', acoes: [], falhas: [], mudou: false });

    await abrir(usuario);
    await usuario.type(screen.getByLabelText(/mensagem para o colodelbot/i), 'bom dia');
    await usuario.click(screen.getByRole('button', { name: /^enviar$/i }));
    await screen.findByText('Oi!');

    const guardado = JSON.parse(localStorage.getItem('colodelbot-conversa-1'));
    expect(guardado.some((m) => m.texto === 'bom dia')).toBe(true);
  });
});
