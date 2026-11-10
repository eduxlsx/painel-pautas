import { motion } from 'motion/react';
import { CalendarClock, CircleCheck, CirclePause, CirclePlay, Ellipsis, Paperclip, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import type { Projeto } from '@pautaflow/shared';
import { cn, dueLabel, fmtDate } from '@/lib/utils';
import { Avatar, Badge, Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip, type Tone } from '@/components/ui';
import { PROJECT_STATUS_LABEL } from './ProjectEditorDialog';
import type { ProjectStats } from './stats';

const STATUS_TONE: Record<Projeto['status'], Tone> = { active: 'success', paused: 'warning', done: 'accent' };

export function ProjectStatusBadge({ status }: { status: Projeto['status'] }) {
  return (
    <Badge tone={STATUS_TONE[status]} icon={status === 'active' ? <span className="size-1.5 rounded-full bg-current" /> : status === 'paused' ? <CirclePause /> : <CircleCheck />}>
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  );
}

function Ring({ value, color, size = 52 }: { value: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--pf-line-strong)" strokeWidth={5} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * value) / 100 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="tabular absolute text-[12px] font-semibold text-fg">{value}%</span>
    </div>
  );
}

export function ProjectCard({
  projeto: p,
  stats,
  files,
  onOpen,
  onEdit,
  onDelete,
  onStatus,
}: {
  projeto: Projeto;
  stats: ProjectStats | undefined;
  files: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (s: Projeto['status']) => void;
}) {
  const total = stats?.total ?? 0;
  const done = stats?.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const due = p.dueDate ? dueLabel(p.dueDate, p.status === 'done') : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen()}
      className={cn('glass glass-hover group relative flex h-full cursor-pointer flex-col overflow-hidden !rounded-[24px] p-5 outline-none', p.status === 'done' && 'opacity-80')}
    >
      {/* brilho na cor do projeto */}
      <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full opacity-[0.18] blur-3xl transition-opacity duration-500 group-hover:opacity-30" style={{ background: p.color }} />
      <div className="absolute inset-x-5 top-0 h-[3px] rounded-b-full" style={{ background: `linear-gradient(90deg, ${p.color}, color-mix(in srgb, ${p.color} 30%, transparent))` }} />

      <div className="relative flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[14px] text-[15px] font-semibold text-white"
          style={{ background: `linear-gradient(140deg, ${p.color}, color-mix(in srgb, ${p.color} 70%, #000))`, boxShadow: `0 10px 22px -10px ${p.color}` }}
        >
          {(p.name[0] ?? 'P').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-fg">{p.name}</h3>
          <div className="mt-1">
            <ProjectStatusBadge status={p.status} />
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="opacity-60 group-hover:opacity-100" aria-label="Ações do projeto">
                <Ellipsis />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Pencil />} onSelect={onEdit}>
                Editar
              </MenuItem>
              <MenuSeparator />
              {p.status !== 'active' && (
                <MenuItem icon={<CirclePlay />} onSelect={() => onStatus('active')}>
                  Marcar como ativo
                </MenuItem>
              )}
              {p.status !== 'paused' && (
                <MenuItem icon={<CirclePause />} onSelect={() => onStatus('paused')}>
                  Pausar projeto
                </MenuItem>
              )}
              {p.status !== 'done' && (
                <MenuItem icon={<CircleCheck />} onSelect={() => onStatus('done')}>
                  Concluir projeto
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
                Excluir projeto
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <p className={cn('relative mt-3 line-clamp-2 min-h-[2.6em] text-[13px] leading-relaxed', p.description ? 'text-fg-2' : 'text-fg-3')}>{p.description || 'Sem descrição.'}</p>

      <div className="relative mt-4 flex items-center gap-4">
        <Ring value={pct} color={p.color} />
        <div className="grid flex-1 grid-cols-3 gap-2">
          <div>
            <div className="tabular text-lg font-semibold leading-none tracking-[-0.03em] text-fg">{stats?.open ?? 0}</div>
            <div className="mt-1 text-[11px] text-fg-3">abertas</div>
          </div>
          <div>
            <div className={cn('tabular text-lg font-semibold leading-none tracking-[-0.03em]', (stats?.overdue ?? 0) > 0 ? 'text-critical' : 'text-fg')}>{stats?.overdue ?? 0}</div>
            <div className="mt-1 text-[11px] text-fg-3">atrasadas</div>
          </div>
          <div>
            <div className="tabular text-lg font-semibold leading-none tracking-[-0.03em] text-fg">
              {done}
              <span className="text-[12px] font-medium text-fg-3">/{total}</span>
            </div>
            <div className="mt-1 text-[11px] text-fg-3">concluídas</div>
          </div>
        </div>
      </div>

      <div className="relative mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        {due && (
          <Tip content={`Prazo do projeto: ${fmtDate(p.dueDate)}`}>
            <span>
              <Badge tone={due.tone === 'overdue' ? 'critical' : due.tone === 'today' ? 'high' : due.tone === 'soon' ? 'warning' : 'neutral'} icon={<CalendarClock />} className="capitalize">
                {due.text}
              </Badge>
            </span>
          </Tip>
        )}
        {(stats?.overdue ?? 0) > 0 && (
          <Badge tone="critical" icon={<TriangleAlert />}>
            {stats?.overdue} em atraso
          </Badge>
        )}
        {files > 0 && (
          <Badge icon={<Paperclip />}>
            <span className="tabular">{files}</span>
          </Badge>
        )}
        {p.keywords.length > 0 && (
          <Tip content={`Palavras-chave do radar: ${p.keywords.join(', ')}`}>
            <span className="max-w-[140px] truncate text-[11px] text-fg-3">#{p.keywords.slice(0, 2).join(' #')}{p.keywords.length > 2 ? ` +${p.keywords.length - 2}` : ''}</span>
          </Tip>
        )}
        {p.owner && (
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-fg-2">
            <Avatar name={p.owner} className="size-6 text-[9px]" />
            <span className="max-w-[110px] truncate">{p.owner}</span>
          </span>
        )}
      </div>
    </div>
  );
}
