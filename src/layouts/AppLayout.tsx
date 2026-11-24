import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { BusinessTipsModal } from '../components/common/BusinessTipsModal.tsx';
import { LoadingState } from '../components/common/States.tsx';
import { DP_EASE } from '../components/motion/MotionPrimitives.tsx';
import { useUiStore } from '../stores/uiStore.ts';
import type { SessionUser } from '../types/erp.ts';
import { useSettingsQueries } from '../features/settings/hooks/useSettingsData.ts';
import { apiClient } from '../services/api/createApiClient.ts';
import { accessDecision } from '../features/quality/utils/permissions.ts';

export function AppLayout() {
  const location = useLocation();
  const token = useUiStore((s) => s.token);
  const setToken = useUiStore((s) => s.setToken);
  const currentUser = useUiStore((s) => s.currentUser);
  const setCurrentUser = useUiStore((s) => s.setCurrentUser);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const lastActivityRef = useRef<number>(0);
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, []);
  const { settingsQuery } = useSettingsQueries();

  // Garde d'acces generique : s'applique a tout ecran declare dans
  // ROUTE_PERMISSIONS, y compris ceux auxquels on accede par un lien direct.
  // Le serveur reste l'autorite (require_perm + 403 sur chaque ecriture).
  const access = accessDecision(currentUser, location.pathname);


  // Une session absente juste apres un rechargement est normale (le temps que
  // /api/auth/me reponde). On ne devine pas avec une minuterie : on retient un
  // echec explicite de verification, pour distinguer « en cours » de « serveur
  // muet ». L'etat est pose dans un callback de promesse, jamais en rendu.
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);

  /**
   * Hydratation de la session apres un rechargement (LOT 8).
   *
   * `token` est restaure depuis `sessionStorage`, mais `currentUser` ne l'etait
   * pas : la navigation et les gardes d'acces restaient donc sans information
   * de role jusqu'a une reconnexion manuelle. On revalide le jeton aupres du
   * serveur (source d'autorite) et on ne remplit l'etat qu'avec sa reponse.
   * Un 401 revoque la session : le jeton restaure n'est plus valide.
   */
  useEffect(() => {
    if (!token || currentUser) return;
    let cancelled = false;
    apiClient
      .getMe()
      .then((res: { user?: SessionUser | null }) => {
        if (!cancelled && res.user) setCurrentUser(res.user);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number } | null)?.status;
        if (status === 401) {
          // Jeton restaure mais revoque : retour a l'ecran de connexion.
          setToken(null);
          return;
        }
        // Serveur injoignable ou erreur inattendue : la session reste inconnue.
        setSessionCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, currentUser, setCurrentUser, setToken]);

  const inactivityTimeoutMinutes = settingsQuery.data?.settings.inactivity_timeout_minutes ?? 10;
  const inactivityTimeoutMs = inactivityTimeoutMinutes * 60 * 1000;

  useEffect(() => {
    if (!token) return;

    const updateLastActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener('mousemove', updateLastActivity);
    window.addEventListener('mousedown', updateLastActivity);
    window.addEventListener('keydown', updateLastActivity);
    window.addEventListener('touchstart', updateLastActivity);
    window.addEventListener('scroll', updateLastActivity);

    const checkInactivity = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= inactivityTimeoutMs) {
        setToken(null);
      }
    }, 1000);

    return () => {
      window.removeEventListener('mousemove', updateLastActivity);
      window.removeEventListener('mousedown', updateLastActivity);
      window.removeEventListener('keydown', updateLastActivity);
      window.removeEventListener('touchstart', updateLastActivity);
      window.removeEventListener('scroll', updateLastActivity);
      clearInterval(checkInactivity);
    };
  }, [token, setToken, inactivityTimeoutMs]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F5F7FB] dark:bg-[#0B1220] text-[#182230] dark:text-slate-100">
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        logoPath={settingsQuery.data?.settings.logo_path}
        companyName={settingsQuery.data?.settings.company_name}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: DP_EASE }}
            className="mx-auto max-w-[1400px]"
          >
            {access === 'unknown' ? (
              sessionCheckFailed ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-6 text-center">
                  <h2 className="font-display text-base font-semibold">Session indisponible</h2>
                  <p className="mt-2 text-sm text-[#667085] dark:text-[#94A3B8]">
                    Le serveur local n’a pas confirmé votre session. Vérifiez qu’il est démarré,
                    puis rechargez la page.
                  </p>
                </div>
              ) : (
                <LoadingState />
              )
            ) : access === 'deny' ? (
              <div className="mx-auto max-w-lg rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-6 text-center">
                <h2 className="font-display text-base font-semibold">Accès non autorisé</h2>
                <p className="mt-2 text-sm text-[#667085] dark:text-[#94A3B8]">
                  Votre rôle « {currentUser?.roleLabel} » ne dispose pas de la permission requise
                  pour cet écran. Demandez à un administrateur de vous l’accorder.
                </p>
              </div>
            ) : (
              <Outlet />
            )}
          </motion.div>
        </main>
      </div>
      <BusinessTipsModal />
    </div>
  );
}