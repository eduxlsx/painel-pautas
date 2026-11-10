import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Activity, Bell, CalendarClock, FolderOpen, Hash, Palette, Power, Radar, Tags, Timer, UserRound } from 'lucide-react';
import { PageHeader, Skeleton } from '@/components/ui';
import { useBootstrap, useConfig } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  AparenciaSection,
  AtividadeSection,
  AutostartSection,
  CategoriasSection,
  DadosSection,
  ExpedienteSection,
  FrequenciasSection,
  NotificacoesSection,
  PerfilSection,
  RadarSection,
  VersaoSection,
} from '@/components/settings/sections';

const SECTIONS: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'perfil', label: 'Perfil', icon: <UserRound /> },
  { id: 'aparencia', label: 'Aparência', icon: <Palette /> },
  { id: 'expediente', label: 'Expediente', icon: <CalendarClock /> },
  { id: 'frequencias', label: 'Frequências', icon: <Timer /> },
  { id: 'radar', label: 'Radar', icon: <Radar /> },
  { id: 'notificacoes', label: 'Notificações', icon: <Bell /> },
  { id: 'categorias', label: 'Categorias', icon: <Tags /> },
  { id: 'inicializacao', label: 'Inicialização', icon: <Power /> },
  { id: 'versao', label: 'Versão', icon: <Hash /> },
  { id: 'dados', label: 'Dados', icon: <FolderOpen /> },
  { id: 'atividade', label: 'Atividade recente', icon: <Activity /> },
];

function useActiveSection(ids: string[], ready: boolean) {
  const [active, setActive] = useState(ids[0] ?? '');
  useEffect(() => {
    if (!ready) return;
    const visible = new Map<string, boolean>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [ids, ready]);
  return [active, setActive] as const;
}

const IDS = SECTIONS.map((s) => s.id);

export default function Configuracoes() {
  const boot = useBootstrap();
  const cfg = useConfig();
  const ready = !!boot.data && !!cfg.data;
  const [active, setActive] = useActiveSection(IDS, ready);

  const go = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <PageHeader eyebrow="Sistema" title="Configurações" subtitle="Personalize o PautaFlow. Cada seção é salva separadamente." />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Seções">
          <div className="glass sticky top-2 p-2">
            {SECTIONS.map((s) => {
              const on = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => go(s.id)}
                  className={cn('relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors [&_svg]:size-4', on ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
                >
                  {on && <motion.span layoutId="cfg-nav" className="absolute inset-0 rounded-xl bg-surface-strong shadow-[var(--pf-shadow)]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span className={cn('relative z-10', on && 'text-accent')}>{s.icon}</span>
                  <span className="relative z-10">{s.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          {!ready || !boot.data || !cfg.data ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)
          ) : (
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }} className="space-y-5">
              {[
                <PerfilSection key="perfil" id="perfil" profile={boot.data.profile} />,
                <AparenciaSection key="aparencia" id="aparencia" config={cfg.data} />,
                <ExpedienteSection key="expediente" id="expediente" config={cfg.data} />,
                <FrequenciasSection key="frequencias" id="frequencias" config={cfg.data} />,
                <RadarSection key="radar" id="radar" config={cfg.data} />,
                <NotificacoesSection key="notificacoes" id="notificacoes" config={cfg.data} />,
                <CategoriasSection key="categorias" id="categorias" />,
                <AutostartSection key="inicializacao" id="inicializacao" />,
                <VersaoSection key="versao" id="versao" />,
                <DadosSection key="dados" id="dados" app={boot.data.app} />,
                <AtividadeSection key="atividade" id="atividade" />,
              ].map((el) => (
                <motion.div key={el.key} variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } } }}>
                  {el}
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
