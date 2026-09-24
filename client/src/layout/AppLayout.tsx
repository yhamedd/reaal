import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  UserCircle,
  Users,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Avatar, Dropdown, Popover, timeAgo } from '../ui';
import { GlobalSearch } from './GlobalSearch';
import { QuickCreateHost, useQuickCreate } from './QuickCreate';

function readCollapsed() {
  try {
    return localStorage.getItem('reaal.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { me, can, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('reaal.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true, end: true },
    { to: '/inventory', label: 'Inventory', icon: Building2, show: can('inventory.view') },
    { to: '/owners', label: 'Owners', icon: UsersRound, show: can('owners.view') },
    { to: '/requirements', label: 'Requirements', icon: ClipboardList, show: can('requirements.view') },
    { to: '/offers', label: 'Offers', icon: FileText, show: can('offers.create') },
    { to: '/imports', label: 'Imports', icon: FileSpreadsheet, show: can('imports.run') },
    { to: '/team', label: 'Team', icon: Users, show: can('users.manage') },
    { to: '/activity', label: 'Activity', icon: Activity, show: true },
    { to: '/settings', label: 'Settings', icon: Settings, show: ['settings.manage', 'masterdata.manage', 'templates.manage', 'roles.manage'].some(can) },
  ];

  return (
    <QuickCreateHost>
      <div className={`shell ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">{me!.config.company_name.charAt(0).toUpperCase()}</span>
            <span className="brand-name truncate">{me!.config.company_name}</span>
          </div>
          <nav className="nav" aria-label="Main">
            {nav
              .filter((n) => n.show)
              .map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}>
                  <n.icon size={17} />
                  <span className="nav-label">{n.label}</span>
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-foot desktop-only">
            <button className="btn ghost sm" style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start' }} onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              <span className="nav-label">Collapse</span>
            </button>
          </div>
        </aside>
        {mobileOpen && <div className="drawer-backdrop" style={{ zIndex: 65 }} onClick={() => setMobileOpen(false)} />}
        <div className="main">
          <header className="topbar">
            <button className="btn ghost icon mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <GlobalSearch />
            <div className="grow desktop-only" />
            <QuickCreateButton />
            <Notifications />
            <Dropdown className="btn ghost" align="right" label={<><Avatar name={me!.name} /><span className="desktop-only">{me!.name.split(' ')[0]}</span></>} title="Account">
              {(close) => (
                <div className="menu">
                  <div style={{ padding: '6px 10px 8px' }}>
                    <div style={{ fontWeight: 600 }}>{me!.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{me!.email} · {me!.role_name}</div>
                  </div>
                  <div className="sep" />
                  <NavLink to="/profile" onClick={close}><UserCircle size={15} /> Profile & password</NavLink>
                  {can('settings.manage') && <NavLink to="/settings" onClick={close}><Settings size={15} /> System settings</NavLink>}
                  <div className="sep" />
                  <button onClick={() => { close(); logout(); }}><LogOut size={15} /> Sign out</button>
                </div>
              )}
            </Dropdown>
          </header>
          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
    </QuickCreateHost>
  );
}

function QuickCreateButton() {
  const { can } = useAuth();
  const open = useQuickCreate();
  const navigate = useNavigate();
  const items = [
    { label: 'Add Owner', show: can('owners.create'), run: () => open('owner') },
    { label: 'Add Unit', show: can('inventory.create'), run: () => open('unit') },
    { label: 'Add Requirement', show: can('requirements.manage'), run: () => open('requirement') },
    { label: 'Create Offer', show: can('offers.create'), run: () => navigate('/offers/new') },
  ].filter((i) => i.show);
  if (!items.length) return null;
  return (
    <Dropdown className="btn primary" align="right" label={<><Plus size={16} /><span className="desktop-only">New</span></>} title="Quick create">
      {(close) => (
        <div className="menu">
          {items.map((i) => (
            <button key={i.label} onClick={() => { close(); i.run(); }}>
              <Plus size={14} /> {i.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

interface Notification {
  id: number;
  type: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

function Notifications() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .get<{ unread: number }>('/api/notifications/count')
        .then((r) => alive && setCount(r.unread))
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setItems(await api.get<Notification[]>('/api/notifications'));
  };
  const openItem = async (n: Notification) => {
    if (!n.read_at) {
      await api.post(`/api/notifications/${n.id}/read`);
      setCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };
  const readAll = async () => {
    await api.post('/api/notifications/read-all');
    setCount(0);
    setItems((all) => all.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  };

  return (
    <>
      <button ref={ref} className="btn ghost icon" style={{ position: 'relative' }} onClick={toggle} aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}>
        <Bell size={18} />
        {count > 0 && <span className="notif-dot">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} align="right" width={360}>
          <div className="panel-head">
            <h3>Notifications</h3>
            {count > 0 && <button className="btn ghost sm" onClick={readAll}>Mark all read</button>}
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {items.length === 0 && <div className="empty">You're all caught up.</div>}
            {items.map((n) => (
              <a key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)} role="button" tabIndex={0}>
                <div className="grow">
                  <div>{n.message}</div>
                  <div className="when">{timeAgo(n.created_at)}</div>
                </div>
              </a>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
