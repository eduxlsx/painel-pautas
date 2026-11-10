import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button, GlassCard } from '@/components/ui';

interface Props {
  children: ReactNode;
  /** Muda a cada navegação para limpar o erro ao trocar de tela. */
  resetKey?: string;
  area?: string;
}

interface State {
  error: Error | null;
}

/** Isola falhas de renderização: um dado inesperado mostra um aviso local em vez de apagar a tela inteira. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PautaFlow] Erro em ${this.props.area ?? 'tela'}:`, error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <GlassCard className="mx-auto mt-10 max-w-lg text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-warning/15 text-amber-600 dark:text-amber-300">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="text-lg font-semibold text-fg">Não foi possível exibir esta tela</h2>
        <p className="mt-1 text-sm text-fg-2">Algum dado chegou em um formato inesperado. Seus dados não foram alterados.</p>
        <p className="mt-3 break-words rounded-xl bg-sunken px-3 py-2 font-mono text-xs text-fg-3">{this.state.error.message}</p>
        <Button className="mt-5" variant="primary" onClick={() => this.setState({ error: null })}>
          <RotateCcw /> Tentar novamente
        </Button>
      </GlassCard>
    );
  }
}
