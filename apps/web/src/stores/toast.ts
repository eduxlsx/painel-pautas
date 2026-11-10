import { create } from 'zustand';

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === 'error' ? 6500 : 3800);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (text: string, action?: Toast['action']) => useToasts.getState().push({ tone: 'success', text, action }),
  error: (text: string) => useToasts.getState().push({ tone: 'error', text }),
  info: (text: string, action?: Toast['action']) => useToasts.getState().push({ tone: 'info', text, action }),
};
