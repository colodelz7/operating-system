import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [estado, setEstado] = useState({ msg: '', tipo: '', show: false });
  const timer = useRef(null);

  const toast = useCallback((msg, tipo = '') => {
    setEstado({ msg, tipo, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setEstado((e) => ({ ...e, show: false })), 2600);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={`toast ${estado.tipo} ${estado.show ? 'show' : ''}`}>{estado.msg}</div>
    </ToastCtx.Provider>
  );
}
