import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import './styles/tokens.css';
import './styles/style.css';

import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { NotificacoesProvider } from './context/NotificacoesContext';
import { TarefaModalProvider } from './context/TarefaModalContext';

import App from './App';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import VisaoGeral from './pages/VisaoGeral';
import Kanban from './pages/Kanban';
import Calendario from './pages/Calendario';
import Clientes from './pages/Clientes';
import CalendarioEquipe from './pages/CalendarioEquipe';
import DatasComemorativas from './pages/DatasComemorativas';
import Historico from './pages/Historico';
import Usuarios from './pages/Usuarios';

// destino padrao: admin -> visao geral; membro -> kanban
function IndexRedirect() {
  const { ehAdmin } = useAuth();
  return <Navigate to={ehAdmin ? '/visao' : '/kanban'} replace />;
}

// guarda de permissao por view
function Guard({ permitido, children }) {
  return permitido ? children : <Navigate to="/" replace />;
}

function DatasGuard() {
  const { ehAdmin, ehCriativo } = useAuth();
  return <Guard permitido={ehAdmin || ehCriativo}><DatasComemorativas /></Guard>;
}
function HistoricoGuard() {
  const { ehAdmin } = useAuth();
  return <Guard permitido={ehAdmin}><Historico /></Guard>;
}
function UsuariosGuard() {
  const { ehAdmin } = useAuth();
  return <Guard permitido={ehAdmin}><Usuarios /></Guard>;
}

function Raiz() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppProvider>
          <NotificacoesProvider>
            <TarefaModalProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/" element={<ProtectedRoute><App /></ProtectedRoute>}>
                    <Route index element={<IndexRedirect />} />
                    <Route path="visao" element={<VisaoGeral />} />
                    <Route path="kanban" element={<Kanban />} />
                    <Route path="calendario" element={<Calendario />} />
                    <Route path="clientes" element={<Clientes />} />
                    <Route path="calendario-equipe" element={<CalendarioEquipe />} />
                    <Route path="datas" element={<DatasGuard />} />
                    <Route path="historico" element={<HistoricoGuard />} />
                    <Route path="usuarios" element={<UsuariosGuard />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </TarefaModalProvider>
          </NotificacoesProvider>
        </AppProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Raiz />
  </React.StrictMode>,
);