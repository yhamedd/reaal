import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import { DataProvider } from './data';
import { Loading } from './ui';
import { AppLayout } from './layout/AppLayout';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage, ForceChangePassword } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { InventoryPage } from './pages/Inventory';
import { UnitPage } from './pages/UnitProfile';
import { OwnersPage } from './pages/Owners';
import { OwnerPage } from './pages/OwnerProfile';
import { RequirementsPage } from './pages/Requirements';
import { RequirementPage } from './pages/RequirementProfile';
import { OffersPage, OfferDetailPage } from './pages/Offers';
import { OfferCreatorPage } from './pages/OfferCreator';
import { ImportsPage } from './pages/Imports';
import { TeamPage } from './pages/Team';
import { ActivityPage } from './pages/Activity';
import { SettingsPage } from './pages/Settings';
import { ProfilePage } from './pages/Profile';
import { NotFound, Forbidden } from './pages/Errors';

/** Old /requirements links (bookmarks, notifications) keep working. */
function LegacyRequestsRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/requirements/, '/requests') + search} replace />;
}

function Guard({ perm, children }: { perm?: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const perms = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
  if (perms.length && !perms.some(can)) return <Forbidden />;
  return <>{children}</>;
}

export function App() {
  const { me, loading, serverDown, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (serverDown) {
    return (
      <div className="auth-wrap">
        <div className="auth-card stack">
          <h1 style={{ fontSize: 18 }}>Can’t reach the server</h1>
          <p className="text-2">The web app loaded but the API isn’t responding. Make sure the server is running (<code>npm run dev</code> starts both), then try again.</p>
          <div><button className="btn primary" onClick={refresh}>Try again</button></div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to={`/login${location.pathname !== '/' ? `?next=${encodeURIComponent(location.pathname + location.search)}` : ''}`} replace />} />
      </Routes>
    );
  }
  if (me.must_change_password) return <ForceChangePassword />;

  return (
    <DataProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventory" element={<Guard perm="inventory.view"><InventoryPage /></Guard>} />
          <Route path="inventory/:id" element={<Guard perm="inventory.view"><UnitPage /></Guard>} />
          <Route path="owners" element={<Guard perm="owners.view"><OwnersPage /></Guard>} />
          <Route path="owners/:id" element={<Guard perm="owners.view"><OwnerPage /></Guard>} />
          <Route path="requests" element={<Guard perm="requirements.view"><RequirementsPage /></Guard>} />
          <Route path="requests/:id" element={<Guard perm="requirements.view"><RequirementPage /></Guard>} />
          <Route path="requirements/*" element={<LegacyRequestsRedirect />} />
          <Route path="offers" element={<Guard perm="offers.create"><OffersPage /></Guard>} />
          <Route path="offers/new" element={<Guard perm="offers.create"><OfferCreatorPage /></Guard>} />
          <Route path="offers/:id" element={<Guard perm="offers.create"><OfferDetailPage /></Guard>} />
          <Route path="imports" element={<Guard perm="imports.run"><ImportsPage /></Guard>} />
          <Route path="team" element={<Guard perm="users.manage"><TeamPage /></Guard>} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings/*" element={<Guard perm={['settings.manage', 'masterdata.manage', 'templates.manage', 'roles.manage']}><SettingsPage /></Guard>} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}
