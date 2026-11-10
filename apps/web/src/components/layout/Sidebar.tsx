import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  CalendarRange,
  ListTodo,
  Radar,
  FolderKanban,
  CalendarDays,
  ArrowUpWideNarrow,
  BarChart3,
  FolderOpen,
  Workflow,
  PlugZap,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { useBootstrap, useRadarStatus } from '@/lib/queries';
import { Tip } from '@/components/ui';
import { Wordmark } from './Logo';

export const NAV: { to: string; label: string; icon: ReactNode; group?: string }[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard /> },
  { to: '/semana', label: 'Minha Semana', icon: <CalendarRange /> },
  { to: '/pautas', label: 'Pautas', icon: <ListTodo /> },
  { to: '/radar', label: 'Radar Inteligente', icon: <Radar /> },
  { to: '/projetos', label: 'Projetos', icon: <FolderKanban /> },
  { to: '/calendario', label: 'Calendário', icon: <CalendarDays /> },
  { to: '/prioridades', label: 'Prioridades', icon: <ArrowUpWideNarrow /> },
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 /> },
  { to: '/arquivos', label: 'Arquivos', icon: <FolderOpen /> },
  { to: '/automacoes', label: 'Automações', icon: <Workflow />, group: 'Sistema' },
  { to: '/integracoes', label: 'Integrações', icon: <PlugZap /> },
  { to: '/configuracoes', label: 'Configurações', icon: <Settings /> },
];

export function Sidebar({ online }: { online: boolean }) {
  const { sidebarCollapsed: collapsed, toggleSidebar } = useUi();
  const { pathname } = useLocation();
  const { data: radar } = useRadarStatus();
  const { data: boot } = useBootstrap();

  return (
    <motion.aside
      className="glass glass-strong pf-no-print relative z-30 m-3 mr-0 flex shrink-0 flex-col !rounded-[26px] py-4"
      animate={{ width: collapsed ? 76 : 252 }}
      transition={{ type: 'spring', stiffness: 380, damping: 38 }}
    >
      <div className={cn('mb-5 flex items-center', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <Wordmark collapsed={collapsed} />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-3">
        {NAV.map((item) => {
          const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
          const badge = item.to === '/radar' && radar?.pending ? radar.pending : null;
          const link = (
            <NavLink
              to={item.to}
              className={cn(
                'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0',
                active ? 'text-fg' : 'text-fg-2 hover:text-fg',
                collapsed && 'justify-center px-0',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-xl bg-surface-solid/80 shadow-[var(--pf-shadow)] dark:bg-white/[0.07]"
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                />
              )}
              {!active && <span className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:bg-sunken group-hover:opacity-100" />}
              <span className={cn('relative z-10 transition-transform duration-300 group-hover:scale-110', active && 'text-accent')}>{item.icon}</span>
              {!collapsed && <span className="relative z-10 truncate">{item.label}</span>}
              {badge !== null && (
                <span
                  className={cn(
                    'tabular relative z-10 grid h-5 min-w-5 place-items-center rounded-full bg-flow px-1.5 text-[10.5px] font-semibold text-white',
                    collapsed ? 'absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[9px]' : 'ml-auto',
                  )}
                >
                  {badge}
                </span>
              )}
            </NavLink>
          );
          return (
            <div key={item.to}>
              {item.group && <div className={cn('mb-1 mt-4 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-fg-3', collapsed && 'mx-auto h-px w-6 bg-line px-0 text-transparent')}>{collapsed ? '' : item.group}</div>}
              {collapsed ? (
                <Tip content={item.label} side="right">
                  {link}
                </Tip>
              ) : (
                link
              )}
            </div>
          );
        })}
      </nav>
      <div className={cn('mt-3 flex items-center gap-2 px-4 pt-3', collapsed ? 'flex-col' : 'justify-between')}>
        <Tip content={online ? 'Serviço local ativo — atualizações em tempo real' : 'Reconectando ao serviço local…'} side="right">
          <div className="flex items-center gap-2 text-[11px] text-fg-3">
            <span className={cn('relative size-2 rounded-full', online ? 'bg-success' : 'bg-warning')}>
              {online && <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />}
            </span>
            {!collapsed && <span className="tabular">v{boot?.app.version ?? '—'}</span>}
          </div>
        </Tip>
        <button onClick={toggleSidebar} className="grid size-8 place-items-center rounded-lg text-fg-3 transition hover:bg-sunken hover:text-fg [&_svg]:size-4" aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>
    </motion.aside>
  );
}
