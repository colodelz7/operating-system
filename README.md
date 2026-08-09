# 🗂️ Sistema Operacional - Colodel

Sistema interno de gestão de tarefas por setores, com quadro Kanban, clientes, histórico, calendário da equipe e controle de usuários.

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 5 |
| Backend | Node.js + Express |
| Storage | Memória (dev) · PostgreSQL (produção) |
| Bibliotecas | @dnd-kit · react-router-dom |
| Segurança | express-session · bcryptjs · express-rate-limit · zod |

## 📁 Estrutura

├── frontend/
│   ├── src/
│   │   ├── components/         # Sidebar, Topbar, Filtros, TarefaModal, etc.
│   │   ├── pages/               # Kanban, Clientes, Calendario, Usuarios, Historico
│   │   ├── context/             # AuthContext, AppContext, NotificacoesContext, etc.
│   │   ├── lib/                 # api.js, format.js, filtros.js, constants.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── backend/
    ├── server.js                # Servidor Express
    ├── config/                  # Variáveis de ambiente
    ├── routes/                  # auth, tarefas, clientes, setores, usuarios, anexos
    ├── data/                    # seedData.js (memória) · memoryRepo.js · pgRepo.js
    ├── db/                      # schema.sql, seed.sql, migracao.sql (PostgreSQL)
    ├── middleware/               # auth, upload, rateLimit, sessionStore
    ├── .env.example              # Variáveis de ambiente necessárias
    └── package.json

## 🚀 Rodando localmente

### ⚙️ Backend

Por padrão roda em memória, não precisa instalar banco de dados.

cd backend
npm install
cp .env.example .env
npm run dev

API em http://localhost:3000.

### 💻 Frontend

cd frontend
npm install
npm run dev

Acesse http://localhost:5173 (o Vite já faz proxy de /api para o backend).

**Login padrão:** admin / colodel2026

Demais usuários de exemplo: usuario02 até usuario11, mesma senha.

## 🗄️ Banco de dados (opcional)

Para usar PostgreSQL em vez de memória:

psql "$DATABASE_URL" -f backend/db/schema.sql
psql "$DATABASE_URL" -f backend/db/seed.sql

E preencher o DATABASE_URL no .env do backend.

## 📦 Build de produção

cd frontend
npm run build

O build fica em frontend/dist/, para ser servido no mesmo domínio que expõe /api.
