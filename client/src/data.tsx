import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Developer { id: number; name: string; active: number; unit_count?: number }
export interface Project { id: number; name: string; developer_id: number | null; developer: string | null; location: string | null; active: number; unit_count?: number }
export interface Tag { id: number; name: string; color: string; usage?: number }
export interface DirectoryUser { id: number; name: string; email: string; status: string }

export interface Master {
  developers: Developer[];
  projects: Project[];
  values: Record<string, { id: number; value: string; active: number; sort: number }[]>;
  categories: { key: string; label: string }[];
  tags: Tag[];
  statuses: { unit: string[]; owner: string[]; requirement: string[] };
  priorities: string[];
  furnishing: string[];
  file_categories: string[];
}

interface DataState {
  master: Master | null;
  users: DirectoryUser[];
  reload: () => Promise<void>;
  values: (category: string) => string[];
  projectName: (id: number | null | undefined) => string;
  userName: (id: number | null | undefined) => string;
}

const DataContext = createContext<DataState>(null as any);

export function DataProvider({ children }: { children: ReactNode }) {
  const [master, setMaster] = useState<Master | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const reload = useCallback(async () => {
    const [m, u] = await Promise.all([api.get<Master>('/api/master'), api.get<DirectoryUser[]>('/api/users/directory')]);
    setMaster(m);
    setUsers(u);
  }, []);
  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const value = useMemo<DataState>(() => {
    const projects = new Map(master?.projects.map((p) => [p.id, p.name]));
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    return {
      master,
      users,
      reload,
      values: (category) => (master?.values[category] ?? []).filter((v) => v.active).map((v) => v.value),
      projectName: (id) => (id ? projects.get(id) ?? '' : ''),
      userName: (id) => (id ? userMap.get(id) ?? '' : ''),
    };
  }, [master, users, reload]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
