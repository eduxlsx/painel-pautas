import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Rocket } from 'lucide-react';
import type { BootstrapResponse } from '@pautaflow/shared';
import { Button, Skeleton } from '@/components/ui';
import { LogoMark } from '@/components/layout/Logo';
import { useConfig, useSaveConfig } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  AiStep,
  AnalysisStep,
  FirstSyncStep,
  LocalStep,
  MicrosoftStep,
  ProductivityStep,
  RadarStep,
  SourcesStep,
  TourStep,
  WelcomeStep,
  saveConfigSilently,
} from '@/components/onboarding/steps';
import type { RegisterSave } from '@/components/settings/MicrosoftSources';

const STEPS: { key: string; label: string; optional?: boolean }[] = [
  { key: 'welcome', label: 'Boas-vindas' },
  { key: 'local', label: 'Configuração local' },
  { key: 'microsoft', label: 'Conexão Microsoft', optional: true },
  { key: 'sources', label: 'Fontes', optional: true },
  { key: 'radar', label: 'Radar', optional: true },
  { key: 'ai', label: 'Inteligência', optional: true },
  { key: 'productivity', label: 'Produtividade', optional: true },
  { key: 'sync', label: 'Primeira sincronização', optional: true },
  { key: 'analysis', label: 'Análise inicial' },
  { key: 'tour', label: 'Seu painel' },
];
const LAST = STEPS.length - 1;

const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48, filter: 'blur(10px)', scale: 0.985 }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)', scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -36, filter: 'blur(8px)', scale: 0.99 }),
};

export default function Onboarding() {
  const cfg = useConfig();
  if (!cfg.data) {
    return (
      <div className="relative z-10 grid h-full place-items-center p-6">
        <Skeleton className="h-[520px] w-full max-w-[720px] !rounded-[32px]" />
      </div>
    );
  }
  return <Wizard initialStep={Math.min(Math.max(0, Math.round(cfg.data.onboardingStep)), LAST)} />;
}

function Wizard({ initialStep }: { initialStep: number }) {
  const navigate = useNavigate();
  const save = useSaveConfig();
  const [step, setStep] = useState(initialStep);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const registerSave = useCallback<RegisterSave>((fn) => {
    saveRef.current = fn;
  }, []);

  const goTo = (next: number) => {
    const n = Math.min(Math.max(0, next), LAST);
    setDir(n >= step ? 1 : -1);
    saveRef.current = null;
    setStep(n);
    void saveConfigSilently({ onboardingStep: n }).catch(() => undefined);
    document.getElementById('pf-onboarding-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (saveRef.current) await saveRef.current();
    } catch {
      setBusy(false);
      return; // a etapa já exibiu o motivo
    }
    if (step === LAST) {
      try {
        const cfg = await save.mutateAsync({ onboardingCompleted: true, onboardingStep: LAST });
        queryClient.setQueryData<BootstrapResponse>(['bootstrap'], (old) => (old ? { ...old, config: cfg } : old));
        navigate('/', { replace: true });
      } catch {
        /* toast já exibido */
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    goTo(step + 1);
  };

  const meta = STEPS[step];
  let body: ReactNode = null;
  switch (meta?.key) {
    case 'welcome':
      body = <WelcomeStep />;
      break;
    case 'local':
      body = <LocalStep registerSave={registerSave} />;
      break;
    case 'microsoft':
      body = <MicrosoftStep />;
      break;
    case 'sources':
      body = <SourcesStep registerSave={registerSave} />;
      break;
    case 'radar':
      body = <RadarStep registerSave={registerSave} />;
      break;
    case 'ai':
      body = <AiStep registerSave={registerSave} />;
      break;
    case 'productivity':
      body = <ProductivityStep registerSave={registerSave} />;
      break;
    case 'sync':
      body = <FirstSyncStep startedAt={syncStartedAt} onStart={setSyncStartedAt} />;
      break;
    case 'analysis':
      body = <AnalysisStep />;
      break;
    case 'tour':
      body = <TourStep />;
      break;
  }

  return (
    <div id="pf-onboarding-scroll" className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 py-8 sm:py-12">
        {/* Topo: marca + progresso */}
        <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <LogoMark className="size-10" />
              <div className="leading-none">
                <div className="text-[15px] font-semibold tracking-[-0.02em] text-fg">PautaFlow</div>
                <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-[0.18em] text-gradient">Intelligence</div>
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-xs font-medium text-fg-3">
                Etapa {step + 1} de {STEPS.length}
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={meta?.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className="text-[13px] font-semibold text-fg">
                  {meta?.label}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <div className="mt-5 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Progresso da configuração">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => i < step && goTo(i)}
                disabled={i >= step}
                title={s.label}
                aria-label={`Ir para ${s.label}`}
                className={cn('relative h-1.5 flex-1 overflow-hidden rounded-full bg-line-strong transition-opacity', i < step ? 'cursor-pointer hover:opacity-80' : 'cursor-default')}
              >
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full bg-flow"
                  initial={false}
                  animate={{ width: i < step ? '100%' : i === step ? '50%' : '0%' }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              </button>
            ))}
          </div>
        </motion.header>

        {/* Cartão principal */}
        <motion.main
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="glass glass-strong relative flex-1 overflow-hidden !rounded-[32px]"
        >
          <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-accent/15 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-28 -left-20 size-64 rounded-full bg-accent-2/10 blur-3xl" aria-hidden />
          <div className="relative px-6 py-8 sm:px-10 sm:py-10">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div key={meta?.key} custom={dir} variants={variants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}>
                {body}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.main>

        {/* Navegação */}
        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-5 flex items-center gap-2">
          <AnimatePresence>
            {step > 0 && (
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}>
                <Button variant="ghost" onClick={() => goTo(step - 1)} disabled={busy}>
                  <ArrowLeft /> Voltar
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex-1" />
          {meta?.optional && (
            <Button variant="ghost" onClick={() => goTo(step + 1)} disabled={busy}>
              Pular
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={() => void next()} loading={busy} className="min-w-[160px]">
            {step === 0 ? 'Começar' : step === LAST ? 'Abrir meu painel' : 'Continuar'}
            {!busy && (step === LAST ? <Rocket /> : <ArrowRight />)}
          </Button>
        </motion.footer>
        <p className="mt-4 text-center text-[11.5px] text-fg-3">Tudo pode ser alterado depois em Configurações e Integrações.</p>
      </div>
    </div>
  );
}
