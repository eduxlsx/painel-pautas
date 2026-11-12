import { useState } from 'react';
import { motion } from 'motion/react';
import { BellRing, BrainCircuit, Database, Send } from 'lucide-react';
import type { Configuracoes } from '@pautaflow/shared';
import { Button, PageHeader, Skeleton, Switch } from '@/components/ui';
import { post, useConfig, useSaveConfig } from '@/lib/queries';
import { toast } from '@/stores/toast';
import { MicrosoftConnectPanel, MsStateChip, msState, useMicrosoftLive } from '@/components/settings/MicrosoftConnect';
import { MicrosoftSources } from '@/components/settings/MicrosoftSources';
import { AiSettingsPanel } from '@/components/settings/AiSettings';
import { OutlookLocalCard } from '@/components/settings/OutlookLocalCard';
import { ClaudeCard } from '@/components/settings/ClaudeCard';
import { Note, RowGroup, SectionCard, SettingRow, useDraft } from '@/components/settings/shared';

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
      <rect x="1" y="1" width="8.5" height="8.5" rx="1.5" fill="#f25022" />
      <rect x="10.5" y="1" width="8.5" height="8.5" rx="1.5" fill="#7fba00" />
      <rect x="1" y="10.5" width="8.5" height="8.5" rx="1.5" fill="#00a4ef" />
      <rect x="10.5" y="10.5" width="8.5" height="8.5" rx="1.5" fill="#ffb900" />
    </svg>
  );
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function Integracoes() {
  const ms = useMicrosoftLive();
  const state = msState(ms.data);
  const connected = state === 'connected';

  return (
    <div>
      <PageHeader eyebrow="Sistema" title="Integrações" subtitle="Conecte o Microsoft 365, escolha um provedor de IA opcional e ajuste as notificações do Windows." />
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
        <motion.div variants={item}>
          <SectionCard
            icon={<MicrosoftIcon />}
            title="Microsoft 365"
            description="Outlook, Calendário e Planner via Microsoft Graph — acesso somente leitura com a sua conta corporativa."
            action={ms.data ? <MsStateChip state={state} /> : <Skeleton className="h-6 w-28" />}
          >
            <MicrosoftConnectPanel />
          </SectionCard>
        </motion.div>

        <motion.div variants={item}>
          <OutlookLocalCard graphConnected={connected} />
        </motion.div>

        {connected && (
          <motion.div variants={item} initial="hidden" animate="show">
            <SectionCard icon={<Database />} title="Fontes de dados" description="Escolha o que o radar acompanha. Alterações valem a partir da próxima sincronização.">
              <MicrosoftSources connected />
            </SectionCard>
          </motion.div>
        )}

        <motion.div variants={item}>
          <ClaudeCard />
        </motion.div>

        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <motion.div variants={item}>
            <SectionCard icon={<BrainCircuit />} title="Inteligência (IA)" description="Opcional. Use um modelo local (Ollama) ou um endpoint compatível com OpenAI.">
              <AiSettingsPanel />
            </SectionCard>
          </motion.div>
          <motion.div variants={item}>
            <NativeNotificationsCard />
          </motion.div>
        </div>

        <motion.div variants={item}>
        </motion.div>
      </motion.div>
    </div>
  );
}

function NativeNotificationsCard() {
  const cfg = useConfig();
  if (!cfg.data) return <Skeleton className="h-64" />;
  return <NativeInner config={cfg.data} />;
}

function NativeInner({ config }: { config: Configuracoes }) {
  const draft = useDraft({ native: config.notifications.native });
  const save = useSaveConfig();
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      const r = await post<{ shown: boolean }>('/api/notifications/test-native');
      if (r.shown) toast.success('Notificação enviada — confira o canto da tela.');
      else toast.error('O Windows não exibiu a notificação. Verifique se as notificações estão ativas e se o modo Não incomodar está desligado.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <SectionCard
      icon={<BellRing />}
      title="Notificações do Windows"
      description="Alertas nativos para prazos, itens críticos e novas sugestões."
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() => void save.mutateAsync({ notifications: { native: draft.value.native } }).catch(() => undefined)}
      className="h-full"
    >
      <div className="space-y-4">
        <RowGroup>
          <SettingRow title="Notificações nativas" description="Respeitam o horário de silêncio e o limite por hora definidos em Configurações.">
            <Switch checked={draft.value.native} onCheckedChange={(v) => draft.set('native', v)} label="Notificações nativas" />
          </SettingRow>
        </RowGroup>
        <Button variant="secondary" size="sm" onClick={() => void test()} loading={testing}>
          {!testing && <Send />}
          Enviar notificação de teste
        </Button>
        <Note tone="info">O teste é enviado mesmo com as notificações nativas desligadas, para você verificar se o Windows as exibe.</Note>
      </div>
    </SectionCard>
  );
}
