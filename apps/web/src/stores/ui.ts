import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePref = 'system' | 'light' | 'dark';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Pauta aberta no painel lateral de detalhes (global). */
  pautaId: string | null;
  openPauta: (id: string | null) => void;
  /** Editor de pauta (criar = null + aberto). */
  editor: { open: boolean; pautaId: string | null; defaults?: Record<string, unknown> };
  openEditor: (pautaId?: string | null, defaults?: Record<string, unknown>) => void;
  closeEditor: () => void;
  assistantOpen: boolean;
  setAssistant: (open: boolean) => void;
  commandOpen: boolean;
  setCommand: (open: boolean) => void;
  pautasView: 'kanban' | 'lista' | 'calendario' | 'timeline' | 'matriz';
  setPautasView: (v: UiState['pautasView']) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      pautaId: null,
      openPauta: (id) => set({ pautaId: id }),
      editor: { open: false, pautaId: null },
      openEditor: (pautaId = null, defaults) => set({ editor: { open: true, pautaId, defaults } }),
      closeEditor: () => set((s) => ({ editor: { ...s.editor, open: false } })),
      assistantOpen: false,
      setAssistant: (assistantOpen) => set({ assistantOpen }),
      commandOpen: false,
      setCommand: (commandOpen) => set({ commandOpen }),
      pautasView: 'kanban',
      setPautasView: (pautasView) => set({ pautasView }),
    }),
    { name: 'pf-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, pautasView: s.pautasView }) },
  ),
);

/** Aplica o tema: "system" segue a aparência do Windows (prefers-color-scheme). */
export function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem('pf-theme', pref);
  } catch {
    /* armazenamento indisponível */
  }
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getPref() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
