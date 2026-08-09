/* Constantes compartilhadas (portadas do app.js/views antigos). */

// Coluna/tarefa conta como "conclusao" se o nome indica etapa final.
export const RE_CONCLUSAO = /aprovad|program|conclu[ií]|finaliz|feito|entregue|publicad/i;
export const RE_AFAZER = /pendente|a fazer|backlog|fila|to.?do/i;
export const RE_RETRABALHO = /retrabalho|revis|ajuste|reprov|corre[çc]/i;

export const PRIORIDADES = ['urgente', 'alta', 'normal', 'baixa'];

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Padrao da equipe: agenda combinada da equipe. Quem quiser troca pelo
// botao "Trocar calendario" (cada instalacao configura a sua).
export const GCAL_KEY = 'colodel-gcal-embed';
// Vazio por padrao: configure com o link de "Incorporar" do Google Calendar
// da sua equipe (botao "Trocar calendário" na tela do Calendário).
export const GCAL_DEFAULT = '';

// Datas comemorativas de marketing 2026 (curadoria). alta = grande valor comercial.
export const DATAS_2026 = [
  { d: '2026-01-01', nome: 'Confraternização Universal', alta: false },
  { d: '2026-01-09', nome: 'Dia do Fico', alta: false },
  { d: '2026-01-25', nome: 'Aniversário de São Paulo', alta: false },
  { d: '2026-02-14', nome: 'Dia de São Valentim (global)', alta: false },
  { d: '2026-02-16', nome: 'Segunda de Carnaval', alta: true },
  { d: '2026-02-17', nome: 'Terça de Carnaval', alta: true },
  { d: '2026-02-18', nome: 'Quarta-feira de Cinzas', alta: false },
  { d: '2026-03-08', nome: 'Dia Internacional da Mulher', alta: true },
  { d: '2026-03-15', nome: 'Dia do Consumidor', alta: true },
  { d: '2026-03-27', nome: 'Dia do Teatro', alta: false },
  { d: '2026-04-01', nome: 'Dia da Mentira', alta: false },
  { d: '2026-04-03', nome: 'Sexta-feira Santa', alta: false },
  { d: '2026-04-05', nome: 'Páscoa', alta: true },
  { d: '2026-04-19', nome: 'Dia dos Povos Indígenas', alta: false },
  { d: '2026-04-21', nome: 'Tiradentes', alta: false },
  { d: '2026-04-22', nome: 'Descobrimento do Brasil', alta: false },
  { d: '2026-05-01', nome: 'Dia do Trabalhador', alta: false },
  { d: '2026-05-10', nome: 'Dia das Mães', alta: true },
  { d: '2026-05-25', nome: 'Dia do Orgulho Nerd', alta: false },
  { d: '2026-06-04', nome: 'Corpus Christi', alta: false },
  { d: '2026-06-05', nome: 'Dia do Meio Ambiente', alta: false },
  { d: '2026-06-12', nome: 'Dia dos Namorados', alta: true },
  { d: '2026-06-24', nome: 'São João / Festa Junina', alta: true },
  { d: '2026-07-13', nome: 'Dia do Rock', alta: false },
  { d: '2026-07-20', nome: 'Dia do Amigo', alta: true },
  { d: '2026-07-26', nome: 'Dia dos Avós', alta: false },
  { d: '2026-08-09', nome: 'Dia dos Pais', alta: true },
  { d: '2026-08-11', nome: 'Dia do Estudante', alta: false },
  { d: '2026-08-25', nome: 'Dia do Feirante', alta: false },
  { d: '2026-09-07', nome: 'Independência do Brasil', alta: false },
  { d: '2026-09-15', nome: 'Dia do Cliente', alta: true },
  { d: '2026-09-21', nome: 'Dia da Árvore', alta: false },
  { d: '2026-09-27', nome: 'Dia do Turismo', alta: false },
  { d: '2026-10-12', nome: 'Dia das Crianças', alta: true },
  { d: '2026-10-15', nome: 'Dia do Professor', alta: true },
  { d: '2026-10-31', nome: 'Halloween / Dia das Bruxas', alta: true },
  { d: '2026-11-02', nome: 'Finados', alta: false },
  { d: '2026-11-15', nome: 'Proclamação da República', alta: false },
  { d: '2026-11-20', nome: 'Dia da Consciência Negra', alta: false },
  { d: '2026-11-27', nome: 'Black Friday', alta: true },
  { d: '2026-11-30', nome: 'Cyber Monday', alta: true },
  { d: '2026-12-24', nome: 'Véspera de Natal', alta: true },
  { d: '2026-12-25', nome: 'Natal', alta: true },
  { d: '2026-12-31', nome: 'Réveillon / Ano Novo', alta: true },
];
