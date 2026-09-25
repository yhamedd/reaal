import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Drawer } from '../ui';
import { OwnerForm } from '../components/OwnerForm';
import { UnitForm } from '../components/UnitForm';
import { RequirementForm } from '../components/RequirementForm';

type Kind = 'owner' | 'unit' | 'requirement';
interface OpenOptions {
  ownerId?: number;
  ownerName?: string;
  onSaved?: (id: number) => void;
}

const Ctx = createContext<(kind: Kind, opts?: OpenOptions) => void>(() => undefined);

export function QuickCreateHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: Kind; opts: OpenOptions } | null>(null);
  const navigate = useNavigate();
  const open = useCallback((kind: Kind, opts: OpenOptions = {}) => setState({ kind, opts }), []);
  const close = () => setState(null);
  const saved = (path: string) => (id: number) => {
    const cb = state?.opts.onSaved;
    close();
    if (cb) cb(id);
    else navigate(`${path}/${id}`);
  };
  return (
    <Ctx.Provider value={open}>
      {children}
      {state?.kind === 'owner' && (
        <Drawer title="Add owner" onClose={close}>
          <OwnerForm onSaved={saved('/owners')} onCancel={close} />
        </Drawer>
      )}
      {state?.kind === 'unit' && (
        <Drawer title="Add unit" onClose={close} wide>
          <UnitForm initialOwner={state.opts.ownerId ? { id: state.opts.ownerId, name: state.opts.ownerName ?? '' } : undefined} onSaved={saved('/inventory')} onCancel={close} />
        </Drawer>
      )}
      {state?.kind === 'requirement' && (
        <Drawer title="Add request" onClose={close} wide>
          <RequirementForm onSaved={saved('/requests')} onCancel={close} />
        </Drawer>
      )}
    </Ctx.Provider>
  );
}

export const useQuickCreate = () => useContext(Ctx);
