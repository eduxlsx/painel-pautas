import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { MeetingAlerts } from '@/components/layout/MeetingAlerts';
import { PautaDetailSheet } from '@/components/pauta/PautaDetailSheet';
import { PautaEditorDialog } from '@/components/pauta/PautaEditorDialog';
import { AssistantPanel } from '@/components/assistant/AssistantPanel';
import { Skeleton, Toaster } from '@/components/ui';
import { connectLiveUpdates } from '@/lib/api';
import { useBootstrap } from '@/lib/queries';
import { applyTheme, useUi, watchSystemTheme, type ThemePref } from '@/stores/ui';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Semana = lazy(() => import('@/pages/Semana'));
const Pautas = lazy(() => import('@/pages/Pautas'));
const Radar = lazy(() => import('@/pages/Radar'));
const Projetos = lazy(() => import('@/pages/Projetos'));
const Calendario = lazy(() => import('@/pages/Calendario'));
const Prioridades = lazy(() => import('@/pages/Prioridades'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Arquivos = lazy(() => import('@/pages/Arquivos'));
const Automacoes = lazy(() => import('@/pages/Automacoes'));
const Integracoes = lazy(() => import('@/pages/Integracoes'));
const Configuracoes = lazy(() => import('@/pages/Configuracoes'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

function Shell() {
  const location = useLocation();
  const [online, setOnline] = useState(true);
  const { setCommand } = useUi();

  useEffect(() => connectLiveUpdates(setOnline), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommand(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommand]);

  return (
    <div className="relative z-10 flex h-full">
      <Sidebar online={online} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="pf-print-full relative min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto max-w-[1480px]"
            >
              <ErrorBoundary resetKey={location.pathname} area={location.pathname}>
              <Suspense fallback={<PageFallback />}>
                <Routes location={location}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/semana" element={<Semana />} />
                  <Route path="/pautas" element={<Pautas />} />
                  <Route path="/radar" element={<Radar />} />
                  <Route path="/projetos" element={<Projetos />} />
                  <Route path="/calendario" element={<Calendario />} />
                  <Route path="/prioridades" element={<Prioridades />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/arquivos" element={<Arquivos />} />
                  <Route path="/automacoes" element={<Automacoes />} />
                  <Route path="/integracoes" element={<Integracoes />} />
                  <Route path="/configuracoes" element={<Configuracoes />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <ErrorBoundary area="detalhes da pauta">
        <PautaDetailSheet />
      </ErrorBoundary>
      <PautaEditorDialog />
      <AssistantPanel />
      <CommandPalette />
      <MeetingAlerts />
    </div>
  );
}

export default function App() {
  const { data, isLoading, isError, refetch } = useBootstrap();
  const location = useLocation();
  const navigate = useNavigate();
  const theme = (data?.config.theme ?? 'system') as ThemePref;

  useEffect(() => {
    if (data) applyTheme(theme);
    return watchSystemTheme(() => theme);
  }, [data, theme]);
  useEffect(() => {
    document.documentElement.classList.toggle('pf-solid', !!data?.config.reduceTransparency);
  }, [data?.config.reduceTransparency]);
  useEffect(() => {
    if (data && !data.config.onboardingCompleted && location.pathname !== '/onboarding') navigate('/onboarding', { replace: true });
  }, [data, location.pathname, navigate]);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipPrimitive.Provider>
        <div className="pf-aurora" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        {isError ? (
          <div className="relative z-10 grid h-full place-items-center p-6">
            <div className="glass max-w-md p-8 text-center">
              <h1 className="text-lg font-semibold">Serviço local indisponível</h1>
              <p className="mt-2 text-sm text-fg-2">Não foi possível falar com o servidor do PautaFlow em 127.0.0.1. Verifique se ele está em execução (scripts\start.ps1).</p>
              <button className="mt-5 text-sm font-medium text-accent" onClick={() => void refetch()}>
                Tentar novamente
              </button>
            </div>
          </div>
        ) : isLoading ? null : location.pathname === '/onboarding' ? (
          <Suspense fallback={null}>
            <Onboarding />
          </Suspense>
        ) : (
          <Shell />
        )}
        <Toaster />
      </TooltipPrimitive.Provider>
    </MotionConfig>
  );
}
