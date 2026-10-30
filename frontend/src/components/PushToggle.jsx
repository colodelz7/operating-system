import { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { suportaPush, ehIOS, estaInstalado, estaAtivo, ativarPush, desativarPush, pushLigadoNoServidor } from '../lib/push';

/* Liga/desliga o aviso no aparelho (celular ou computador), que chega mesmo
   com a aba fechada. No iPhone fora da tela de inicio, explica o caminho. */
export default function PushToggle() {
  const toast = useToast();
  const [disponivel, setDisponivel] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const iosSemInstalar = ehIOS() && !estaInstalado();

  useEffect(() => {
    let vivo = true;
    (async () => {
      const servidor = await pushLigadoNoServidor();
      if (!vivo) return;
      setDisponivel(servidor && (suportaPush() || iosSemInstalar));
      if (servidor) setAtivo(await estaAtivo());
    })();
    return () => { vivo = false; };
  }, [iosSemInstalar]);

  if (!disponivel) return null;

  if (iosSemInstalar) {
    return (
      <div className="push-dica">
        Para receber avisos no iPhone: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
        Abra o sistema pelo ícone e ative aqui.
      </div>
    );
  }

  async function alternar() {
    setOcupado(true);
    try {
      if (ativo) { await desativarPush(); setAtivo(false); toast('Avisos no aparelho desligados', 'ok'); }
      else { await ativarPush(); setAtivo(true); toast('Avisos no aparelho ligados ✓', 'ok'); }
    } catch (e) { toast(e.message, 'erro'); }
    finally { setOcupado(false); }
  }

  return (
    <button className={`push-toggle ${ativo ? 'on' : ''}`} onClick={alternar} disabled={ocupado}>
      <span className="push-chave" aria-hidden="true" />
      {ativo ? 'Avisos neste aparelho: ligados' : 'Receber avisos neste aparelho'}
    </button>
  );
}
