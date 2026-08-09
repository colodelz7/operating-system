import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { usuario, carregando } = useAuth();
  if (carregando) {
    return <div className="carregando" style={{ minHeight: '100vh' }}><div className="spinner" />Carregando...</div>;
  }
  if (!usuario) return <Navigate to="/login" replace />;
  return children;
}
