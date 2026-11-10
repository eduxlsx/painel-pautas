import { EventEmitter } from 'node:events';

export type Topic =
  | 'pautas'
  | 'projetos'
  | 'categorias'
  | 'sugestoes'
  | 'notificacoes'
  | 'automacoes'
  | 'integracoes'
  | 'config'
  | 'resumos'
  | 'bookmarks'
  | 'calendar'
  | 'all';

/** Barramento de eventos usado para empurrar atualizações à interface via SSE. */
export class EventBus extends EventEmitter {
  private pendingTopics = new Set<Topic>();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /** Agrupa mudanças em janelas de 250 ms para evitar rajadas de invalidação na UI. */
  changed(...topics: Topic[]) {
    for (const t of topics) this.pendingTopics.add(t);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      const list = [...this.pendingTopics];
      this.pendingTopics.clear();
      this.timer = null;
      this.emit('change', list);
    }, 250);
  }
}
