import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type SendableChannels,
  type User,
} from 'discord.js';
import { type HistoryEntry, type Notificacao, type PautaStatus, type PriorityLevel, type Resumo, isOpenStatus, PRIORITY_LABEL, STATUS_LABEL } from '@pautaflow/shared';
import type { AppContext } from '../../core/context';
import type { DiscordEnv } from '../../env';
import { addDays, dueToDate, startOfDay, startOfWeek, toLocalDateKey, extractDeadline } from '../../intelligence/dates';
import { effectiveOrder } from '../../intelligence/priority';
import { truncate, norm } from '../../intelligence/text';
import { askAssistant, dashboard } from '../../modules/views';
import { isOverdue } from '../../analytics/metrics';
import { COLOR, PRIORITY_EMOJI, pautaEmbed, pautaLine, shortId, suggestionEmbed, summaryEmbed, discordTime, type EmbedData } from './format';

type ChannelKey = keyof DiscordEnv['channels'];

export interface DiscordStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  botTag: string | null;
  guild: string | null;
  channels: { key: ChannelKey; id: string; name: string | null; ok: boolean }[];
  allowedUsers: number;
  lastError: string | null;
  startedAt: string | null;
}

const STATUS_CHOICES: { name: string; value: PautaStatus }[] = (['backlog', 'todo', 'in_progress', 'waiting', 'review', 'done', 'cancelled'] as PautaStatus[]).map((s) => ({ name: STATUS_LABEL[s], value: s }));
const PRIORITY_CHOICES = (['critical', 'high', 'medium', 'low'] as PriorityLevel[]).map((p) => ({ name: PRIORITY_LABEL[p], value: p }));

function buildCommands() {
  const pautaOpt = (o: import('discord.js').SlashCommandStringOption) => o.setName('pauta').setDescription('Pauta (digite para buscar)').setRequired(true).setAutocomplete(true);
  return [
    new SlashCommandBuilder()
      .setName('pautas')
      .setDescription('Lista suas pautas')
      .addStringOption((o) =>
        o
          .setName('filtro')
          .setDescription('Quais pautas listar')
          .addChoices(
            { name: 'Abertas (por prioridade)', value: 'abertas' },
            { name: 'Vencem hoje', value: 'hoje' },
            { name: 'Atrasadas', value: 'atrasadas' },
            { name: 'Desta semana', value: 'semana' },
            { name: 'Aguardando aprovação', value: 'aprovacao' },
            { name: 'Concluídas recentemente', value: 'concluidas' },
          ),
      ),
    new SlashCommandBuilder()
      .setName('pauta')
      .setDescription('Ver e gerenciar uma pauta')
      .addSubcommand((s) => s.setName('ver').setDescription('Detalhes de uma pauta').addStringOption(pautaOpt))
      .addSubcommand((s) =>
        s
          .setName('nova')
          .setDescription('Cria uma pauta')
          .addStringOption((o) => o.setName('titulo').setDescription('Título').setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName('prazo').setDescription('Ex.: 15/11, sexta, amanhã, 2026-11-20'))
          .addStringOption((o) => o.setName('prioridade').setDescription('Prioridade manual').addChoices(...PRIORITY_CHOICES))
          .addStringOption((o) => o.setName('projeto').setDescription('Projeto (digite para buscar)').setAutocomplete(true))
          .addStringOption((o) => o.setName('descricao').setDescription('Descrição').setMaxLength(1500)),
      )
      .addSubcommand((s) => s.setName('concluir').setDescription('Marca a pauta como concluída').addStringOption(pautaOpt))
      .addSubcommand((s) =>
        s
          .setName('status')
          .setDescription('Altera o status')
          .addStringOption(pautaOpt)
          .addStringOption((o) => o.setName('status').setDescription('Novo status').setRequired(true).addChoices(...STATUS_CHOICES)),
      )
      .addSubcommand((s) =>
        s
          .setName('prazo')
          .setDescription('Altera o prazo')
          .addStringOption(pautaOpt)
          .addStringOption((o) => o.setName('data').setDescription('Ex.: 20/11, sexta, "sem prazo"').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('prioridade')
          .setDescription('Define a prioridade manual')
          .addStringOption(pautaOpt)
          .addStringOption((o) => o.setName('nivel').setDescription('Prioridade').setRequired(true).addChoices(...PRIORITY_CHOICES, { name: 'Automática', value: 'auto' })),
      )
      .addSubcommand((s) =>
        s
          .setName('comentar')
          .setDescription('Adiciona um comentário')
          .addStringOption(pautaOpt)
          .addStringOption((o) => o.setName('texto').setDescription('Comentário').setRequired(true).setMaxLength(1500)),
      ),
    new SlashCommandBuilder().setName('prioridades').setDescription('Ordem recomendada do que fazer agora'),
    new SlashCommandBuilder().setName('radar').setDescription('Sugestões do radar aguardando sua decisão'),
    new SlashCommandBuilder()
      .setName('resumo')
      .setDescription('Gera e mostra um resumo')
      .addStringOption((o) => o.setName('tipo').setDescription('Período').addChoices({ name: 'Diário', value: 'daily' }, { name: 'Semanal', value: 'weekly' }, { name: 'Mensal', value: 'monthly' })),
    new SlashCommandBuilder()
      .setName('perguntar')
      .setDescription('Pergunte ao assistente do PautaFlow')
      .addStringOption((o) => o.setName('pergunta').setDescription('Ex.: Tenho alguma entrega atrasada?').setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder().setName('painel').setDescription('Atualiza o painel no canal #painel'),
  ];
}

/** Interpreta um prazo em linguagem natural (pt-BR) ou ISO. */
export function parseDueInput(text: string, now = new Date()): string | null | 'invalid' {
  const t = text.trim();
  if (/^(sem prazo|nenhum|remover|limpar|-)$/i.test(t)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const r = extractDeadline(`até ${t}`, now);
  return r ? r.date : 'invalid';
}

export class DiscordService {
  private client: Client | null = null;
  private guild: Guild | null = null;
  private channels = new Map<ChannelKey, SendableChannels>();
  private sendChain: Promise<unknown> = Promise.resolve();
  private panelTimer: NodeJS.Timeout | null = null;
  private panelInterval: NodeJS.Timeout | null = null;
  private lastPanelAt = 0;
  private lastError: string | null = null;
  private startedAt: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: [string, (...a: any[]) => void][] = [];

  constructor(
    private readonly app: AppContext,
    private readonly cfg: DiscordEnv,
  ) {}

  private get appUrl() {
    return `http://localhost:${this.app.env.port}`;
  }

  status(): DiscordStatus {
    return {
      configured: this.cfg.token !== '',
      enabled: this.cfg.enabled,
      connected: !!this.client?.isReady(),
      botTag: this.client?.user?.tag ?? null,
      guild: this.guild?.name ?? null,
      channels: (Object.keys(this.cfg.channels) as ChannelKey[]).map((key) => {
        const ch = this.channels.get(key);
        return { key, id: this.cfg.channels[key], name: ch && 'name' in ch ? (ch.name as string) : null, ok: !!ch };
      }),
      allowedUsers: this.cfg.allowedUserIds.length,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) {
      this.app.log.info('Discord: token não configurado — bot desativado (defina DISCORD_BOT_TOKEN no .env)');
      return;
    }
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client = client;
    client.once(Events.ClientReady, (c) => void this.onReady(c.user.id).catch((err) => this.fail(err, 'Falha ao preparar o bot')));
    client.on(Events.InteractionCreate, (i) => void this.onInteraction(i));
    client.on(Events.Error, (err) => this.fail(err, 'Erro no cliente do Discord'));
    try {
      await client.login(this.cfg.token);
    } catch (err) {
      this.fail(err, 'Não foi possível conectar ao Discord (verifique o DISCORD_BOT_TOKEN)');
      this.client = null;
    }
  }

  async stop(): Promise<void> {
    if (this.panelInterval) clearInterval(this.panelInterval);
    if (this.panelTimer) clearTimeout(this.panelTimer);
    for (const [ev, fn] of this.listeners) this.app.bus.off(ev, fn);
    this.listeners = [];
    await this.client?.destroy();
    this.client = null;
  }

  private fail(err: unknown, msg: string) {
    this.lastError = `${msg}: ${(err as Error)?.message ?? err}`;
    this.app.log.warn({ err: (err as Error)?.message }, msg);
    void this.app.db.integracoes
      .update((s) => {
        s.discord.lastError = this.lastError;
      })
      .catch(() => undefined);
  }

  private async onReady(appId: string) {
    const client = this.client!;
    for (const key of Object.keys(this.cfg.channels) as ChannelKey[]) {
      const id = this.cfg.channels[key];
      if (!id) continue;
      try {
        const ch = await client.channels.fetch(id);
        if (ch?.isSendable()) {
          this.channels.set(key, ch);
          if (!this.guild && 'guild' in ch && ch.guild) this.guild = ch.guild as Guild;
        } else this.app.log.warn({ key, id }, 'Discord: canal não encontrado ou sem permissão de envio');
      } catch (err) {
        this.app.log.warn({ key, id, err: (err as Error).message }, 'Discord: falha ao acessar canal');
      }
    }
    if (!this.guild) throw new Error('Nenhum canal configurado está acessível — convide o bot para o servidor e confira os IDs');
    const rest = new REST().setToken(this.cfg.token);
    await rest.put(Routes.applicationGuildCommands(appId, this.guild.id), { body: buildCommands().map((c) => c.toJSON()) });
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    await this.app.db.integracoes.update((s) => {
      s.discord.lastConnectedAt = this.startedAt;
      s.discord.lastError = null;
    });
    this.subscribe();
    this.log(`🟢 Bot conectado como **${client.user?.tag}** · PautaFlow v${(await this.app.version.info()).version}`);
    void this.refreshPanel(true);
    this.panelInterval = setInterval(() => void this.refreshPanel(), 10 * 60_000);
    this.app.log.info({ bot: client.user?.tag, guild: this.guild.name }, 'Discord conectado');
  }

  /* ------------------------------ Envio ------------------------------ */

  private send(key: ChannelKey, payload: { content?: string; embeds?: EmbedData[]; components?: ActionRowBuilder<ButtonBuilder>[] }) {
    const ch = this.channels.get(key);
    if (!ch) return;
    this.sendChain = this.sendChain
      .then((): Promise<unknown> => ch.send({ ...payload, allowedMentions: { parse: [] } }))
      .catch((err) => this.app.log.warn({ err: (err as Error).message, key }, 'Discord: falha ao enviar mensagem'));
  }

  private log(text: string) {
    this.send('logs', { content: truncate(text, 1900) });
  }

  private pautaButtons(id: string, status: PautaStatus) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (isOpenStatus(status)) {
      if (status !== 'in_progress') row.addComponents(new ButtonBuilder().setCustomId(`pf:p:start:${id}`).setLabel('Iniciar').setEmoji('⚙️').setStyle(ButtonStyle.Primary));
      if (status !== 'waiting') row.addComponents(new ButtonBuilder().setCustomId(`pf:p:wait:${id}`).setLabel('Aguardando').setEmoji('⏳').setStyle(ButtonStyle.Secondary));
      row.addComponents(new ButtonBuilder().setCustomId(`pf:p:tomorrow:${id}`).setLabel('Prazo +1 dia').setEmoji('📅').setStyle(ButtonStyle.Secondary));
      row.addComponents(new ButtonBuilder().setCustomId(`pf:p:done:${id}`).setLabel('Concluir').setEmoji('✅').setStyle(ButtonStyle.Success));
    } else {
      row.addComponents(new ButtonBuilder().setCustomId(`pf:p:reopen:${id}`).setLabel('Reabrir').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
    }
    return row;
  }

  private suggestionButtons(id: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`pf:s:approve:${id}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pf:s:snooze:${id}`).setLabel('Adiar 1 dia').setEmoji('💤').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pf:s:ignore:${id}`).setLabel('Ignorar').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
  }

  private lookups(projectId: string | null, categoryId: string | null) {
    return {
      project: projectId ? this.app.db.projetos.get(projectId)?.name ?? null : null,
      category: categoryId ? this.app.db.categorias.get(categoryId)?.name ?? null : null,
    };
  }

  /* ------------------------------ Feeds ------------------------------ */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private on(ev: string, fn: (...a: any[]) => void) {
    this.app.bus.on(ev, fn);
    this.listeners.push([ev, fn]);
  }

  private subscribe() {
    this.on('history', ((h: HistoryEntry) => this.onHistory(h)) as never);
    this.on('notification', ((n: Notificacao) => this.onNotification(n)) as never);
    this.on('summary', ((r: Resumo) => this.send('geral', { embeds: [summaryEmbed(r)] })) as never);
    this.on('job', ((j: { id: string; name: string; status: string; message: string; trigger: string }) => {
      if (j.status === 'error') this.log(`❌ **${j.name}** falhou: ${j.message}`);
      else if (j.status === 'success' && ['backup', 'maintenance', 'daily-summary', 'weekly-summary', 'monthly-summary'].includes(j.id)) this.log(`✅ ${j.name}: ${j.message}`);
    }) as never);
    this.on('change', ((topics: string[]) => {
      if (topics.some((t) => ['pautas', 'sugestoes', 'projetos', 'all'].includes(t))) this.schedulePanel();
    }) as never);
  }

  private onHistory(h: HistoryEntry) {
    const actor = h.actor === 'user' ? '' : ` _(via ${h.actor})_`;
    if (h.entity === 'pauta' && h.entityId) {
      const p = this.app.db.pautas.get(h.entityId);
      if (h.action === 'created' && p) {
        const lk = this.lookups(p.projectId, p.categoryId);
        this.send('pautas', { content: `🆕 Nova pauta${actor}`, embeds: [pautaEmbed(p, { ...lk, appUrl: this.appUrl })], components: [this.pautaButtons(p.id, p.status)] });
      } else if (h.action === 'completed' && p) {
        this.send('pautas', { content: `✅ **Concluída:** ${truncate(p.title, 150)} \`${shortId(p.id)}\`${actor}` });
      } else if (h.action === 'status_changed' && p) {
        this.send('pautas', { content: `🔄 ${truncate(h.summary, 200)} \`${shortId(p.id)}\`${actor}` });
      } else if (h.action === 'deleted') {
        this.send('pautas', { content: `🗑️ ${truncate(h.summary, 200)}${actor}` });
      }
    } else if (h.entity === 'sugestao' && h.action === 'suggested' && h.entityId) {
      const s = this.app.db.sugestoes.get(h.entityId);
      if (s) {
        const lk = this.lookups(s.projectId, s.categoryId);
        this.send('pautas', { content: '📡 **Nova sugestão do radar** — aprove para virar pauta', embeds: [suggestionEmbed(s, lk)], components: [this.suggestionButtons(s.id)] });
      }
    } else if (h.entity === 'integracao' || (h.entity === 'sistema' && ['restore', 'autostart', 'version'].includes(h.action))) {
      this.log(`ℹ️ ${h.summary}`);
    }
  }

  private onNotification(n: Notificacao) {
    const color = { critical: COLOR.critical, warning: COLOR.warning, success: COLOR.success, info: COLOR.info }[n.severity];
    const embed: EmbedData = { title: truncate(n.title, 250), description: n.body ? truncate(n.body, 1500) : undefined, color, timestamp: n.createdAt };
    if (['integration_error', 'system'].includes(n.type)) this.send('logs', { embeds: [embed] });
    else if (['deadline', 'overdue', 'critical', 'approval', 'forgotten', 'conflict'].includes(n.type)) {
      const m = n.link ? /\/pautas\?id=([\w-]+)/.exec(n.link) : null;
      const p = m ? this.app.db.pautas.get(m[1]!) : undefined;
      this.send('geral', { embeds: [embed], components: p ? [this.pautaButtons(p.id, p.status)] : [] });
    }
  }

  /* ------------------------------ Painel ao vivo ------------------------------ */

  private schedulePanel() {
    if (this.panelTimer) return;
    const wait = Math.max(15_000, 45_000 - (Date.now() - this.lastPanelAt));
    this.panelTimer = setTimeout(() => {
      this.panelTimer = null;
      void this.refreshPanel();
    }, wait);
  }

  async refreshPanel(force = false): Promise<void> {
    const ch = this.channels.get('painel');
    if (!ch || !this.client?.isReady()) return;
    if (!force && Date.now() - this.lastPanelAt < 15_000) return;
    this.lastPanelAt = Date.now();
    try {
      const d = await dashboard(this.app);
      const pautas = this.app.db.pautas.list();
      const top = effectiveOrder(pautas).slice(0, 6);
      const kpi = (k: string) => d.kpis.find((x) => x.key === k);
      const kpiLine = ['active', 'overdue', 'week', 'critical', 'suggestions', 'rate']
        .map((k) => kpi(k))
        .filter(Boolean)
        .map((x) => `**${x!.value}${x!.unit ?? ''}** ${x!.label.toLowerCase()}`)
        .join(' · ');
      const embeds: EmbedData[] = [
        {
          title: `📊 ${d.greeting.salutation}${d.greeting.name ? `, ${d.greeting.name}` : ''}`,
          description: `${d.greeting.dateLabel}\n${d.greeting.headline}\n\n${kpiLine}`,
          color: COLOR.brand,
          fields: [
            { name: '🎯 Minha atenção hoje', value: d.attention.length ? truncate(d.attention.map((a) => `${PRIORITY_EMOJI[a.pauta.manualPriority ?? a.pauta.recommendedPriority]} **${truncate(a.pauta.title, 60)}** \`${shortId(a.pauta.id)}\`\n↳ ${truncate(a.nextAction, 90)}`).join('\n'), 1020) : 'Nada urgente agora.' },
            { name: '📈 Prioridades recomendadas', value: top.length ? truncate(top.map((p, i) => `${i + 1}. ${truncate(p.title, 60)} — score ${p.priorityScore}${p.dueDate ? ` · ${discordTime(p.dueDate, 'R')}` : ''}`).join('\n'), 1020) : 'Sem pautas em aberto.' },
            { name: '💡 Insights', value: truncate(d.insights.map((i) => `• ${i.text}`).join('\n'), 1020) || '—' },
          ],
          footer: { text: 'Atualizado automaticamente pelo PautaFlow' },
          timestamp: new Date().toISOString(),
        },
      ];
      const components = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('pf:panel:refresh').setLabel('Atualizar').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('pf:panel:radar').setLabel('Ver radar').setEmoji('📡').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('pf:panel:overdue').setLabel('Atrasadas').setEmoji('⚠️').setStyle(ButtonStyle.Secondary),
        ),
      ];
      const stored = this.app.db.integracoes.get().discord.panelMessageId;
      if (stored) {
        try {
          const msg = await ch.messages.fetch(stored);
          await msg.edit({ embeds, components });
          return;
        } catch {
          /* mensagem apagada: cria outra */
        }
      }
      const msg = await ch.send({ embeds, components, allowedMentions: { parse: [] } });
      await msg.pin().catch(() => undefined);
      await this.app.db.integracoes.update((s) => {
        s.discord.panelMessageId = msg.id;
      });
    } catch (err) {
      this.app.log.warn({ err: (err as Error).message }, 'Discord: falha ao atualizar o painel');
    }
  }

  /* ------------------------------ Interações ------------------------------ */

  private allowed(user: User): boolean {
    if (this.cfg.allowedUserIds.length) return this.cfg.allowedUserIds.includes(user.id);
    return !!this.guild && this.guild.ownerId === user.id;
  }

  private async onInteraction(i: Interaction) {
    try {
      if (!this.guild || i.guildId !== this.guild.id) return;
      if (i.isAutocomplete()) return await this.autocomplete(i);
      if (!i.isChatInputCommand() && !i.isButton()) return;
      if (!this.allowed(i.user)) {
        await i.reply({ content: '🔒 Você não tem permissão para gerenciar estas pautas. (Configure DISCORD_ALLOWED_USER_IDS no .env do PautaFlow.)', flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.isChatInputCommand()) await this.command(i);
      else await this.button(i);
    } catch (err) {
      const msg = `⚠️ ${(err as Error).message}`;
      this.app.log.warn({ err: (err as Error).message }, 'Discord: falha ao processar interação');
      if (i.isRepliable()) {
        if (i.deferred || i.replied) await i.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        else await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }

  private async autocomplete(i: AutocompleteInteraction) {
    const focused = i.options.getFocused(true);
    const q = norm(String(focused.value));
    if (focused.name === 'projeto') {
      const items = this.app.db.projetos.filter((p) => p.status === 'active' && norm(p.name).includes(q)).slice(0, 25);
      await i.respond(items.map((p) => ({ name: truncate(p.name, 100), value: p.id })));
      return;
    }
    const sub = i.options.getSubcommand(false);
    const pool = this.app.db.pautas.filter((p) => (sub === 'ver' ? true : isOpenStatus(p.status) || sub === 'status'));
    const items = effectiveOrder(pool.filter((p) => isOpenStatus(p.status)))
      .concat(pool.filter((p) => !isOpenStatus(p.status)))
      .filter((p) => !q || norm(p.title).includes(q) || p.id.startsWith(q))
      .slice(0, 25);
    await i.respond(items.map((p) => ({ name: truncate(`${PRIORITY_EMOJI[p.manualPriority ?? p.recommendedPriority]} ${p.title}${p.dueDate ? ` · ${p.dueDate}` : ''}`, 100), value: p.id })));
  }

  private findPauta(ref: string) {
    const p = this.app.db.pautas.get(ref) ?? this.app.db.pautas.find((x) => x.id.startsWith(ref.toLowerCase()));
    if (!p) throw new Error('Pauta não encontrada. Use a busca da opção "pauta".');
    return p;
  }

  private audit(user: User, text: string) {
    this.log(`👤 **${user.username}** ${text}`);
  }

  private pautaReply(id: string, content?: string) {
    const p = this.app.db.pautas.get(id)!;
    const lk = this.lookups(p.projectId, p.categoryId);
    return { content, embeds: [pautaEmbed(p, { ...lk, appUrl: this.appUrl })], components: [this.pautaButtons(p.id, p.status)] };
  }

  private async command(i: ChatInputCommandInteraction) {
    const { pautas: svc, db } = this.app;
    switch (i.commandName) {
      case 'pautas': {
        const filtro = i.options.getString('filtro') ?? 'abertas';
        const now = new Date();
        const all = db.pautas.list();
        const open = effectiveOrder(all);
        const today = toLocalDateKey(now);
        const weekEnd = addDays(startOfWeek(now), 7);
        const list =
          filtro === 'hoje'
            ? open.filter((p) => p.dueDate?.slice(0, 10) === today)
            : filtro === 'atrasadas'
              ? open.filter((p) => isOverdue(p, now))
              : filtro === 'semana'
                ? open.filter((p) => p.dueDate && dueToDate(p.dueDate) >= startOfDay(now) && dueToDate(p.dueDate) < weekEnd)
                : filtro === 'aprovacao'
                  ? open.filter((p) => p.approvalPending || p.status === 'review')
                  : filtro === 'concluidas'
                    ? all.filter((p) => p.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
                    : open;
        const titles: Record<string, string> = { abertas: 'Pautas abertas', hoje: 'Vencem hoje', atrasadas: 'Atrasadas', semana: 'Entregas da semana', aprovacao: 'Aguardando aprovação', concluidas: 'Concluídas recentemente' };
        const shown = list.slice(0, 12);
        await i.reply({
          embeds: [
            {
              title: `📋 ${titles[filtro]} (${list.length})`,
              description: shown.length ? truncate(shown.map((p) => pautaLine(p, p.projectId ? db.projetos.get(p.projectId)?.name : null)).join('\n\n'), 4000) : 'Nenhuma pauta neste filtro.',
              color: COLOR.brand,
              footer: { text: list.length > shown.length ? `Mostrando ${shown.length} de ${list.length} · use /pauta ver para detalhes` : 'Use /pauta ver para detalhes e ações' },
            },
          ],
        });
        return;
      }
      case 'pauta': {
        const sub = i.options.getSubcommand();
        if (sub === 'nova') {
          const prazoTxt = i.options.getString('prazo');
          const due = prazoTxt ? parseDueInput(prazoTxt) : null;
          if (due === 'invalid') throw new Error(`Não entendi o prazo "${prazoTxt}". Use 15/11, sexta, amanhã ou AAAA-MM-DD.`);
          const prio = i.options.getString('prioridade') as PriorityLevel | null;
          const projectId = i.options.getString('projeto');
          const p = await svc.create(
            {
              title: i.options.getString('titulo', true),
              description: i.options.getString('descricao') ?? '',
              dueDate: due,
              manualPriority: prio,
              projectId: projectId && db.projetos.get(projectId) ? projectId : null,
            },
            { origin: 'manual', actor: 'user' },
          );
          this.audit(i.user, `criou a pauta "${p.title}" pelo Discord`);
          await i.reply(this.pautaReply(p.id, '🆕 Pauta criada.'));
          return;
        }
        const p = this.findPauta(i.options.getString('pauta', true));
        if (sub === 'ver') {
          await i.reply(this.pautaReply(p.id));
          return;
        }
        if (sub === 'concluir') await svc.update(p.id, { status: 'done' });
        else if (sub === 'status') await svc.update(p.id, { status: i.options.getString('status', true) as PautaStatus });
        else if (sub === 'prazo') {
          const due = parseDueInput(i.options.getString('data', true));
          if (due === 'invalid') throw new Error('Não entendi a data. Use 15/11, sexta, amanhã, AAAA-MM-DD ou "sem prazo".');
          await svc.update(p.id, { dueDate: due });
        } else if (sub === 'prioridade') {
          const n = i.options.getString('nivel', true);
          await svc.update(p.id, { manualPriority: n === 'auto' ? null : (n as PriorityLevel) });
        } else if (sub === 'comentar') {
          const fresh = db.pautas.get(p.id)!;
          await svc.update(p.id, { comments: [...fresh.comments, { id: crypto.randomUUID(), text: i.options.getString('texto', true), createdAt: new Date().toISOString(), author: `${i.user.username} (Discord)` }] });
        }
        this.audit(i.user, `executou /pauta ${sub} em "${p.title}"`);
        await i.reply(this.pautaReply(p.id, '✔️ Pauta atualizada.'));
        return;
      }
      case 'prioridades': {
        const top = effectiveOrder(db.pautas.list()).slice(0, 10);
        await i.reply({
          embeds: [
            {
              title: '📈 Prioridades recomendadas',
              description: top.length ? truncate(top.map((p, n) => `**${n + 1}.** ${pautaLine(p, p.projectId ? db.projetos.get(p.projectId)?.name : null)}\n_${truncate(p.priorityJustification, 160)}_`).join('\n\n'), 4000) : 'Sem pautas em aberto.',
              color: COLOR.brand,
              footer: { text: 'Score 0–100: recomendação operacional, não previsão estatística' },
            },
          ],
        });
        return;
      }
      case 'radar': {
        const pending = db.sugestoes.filter((s) => s.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!pending.length) {
          await i.reply({ content: '📡 Nenhuma sugestão pendente no radar.' });
          return;
        }
        await i.reply({ content: `📡 **${pending.length}** sugestão(ões) aguardando decisão${pending.length > 5 ? ' — mostrando as 5 mais recentes' : ''}.` });
        for (const s of pending.slice(0, 5)) {
          const lk = this.lookups(s.projectId, s.categoryId);
          await i.followUp({ embeds: [suggestionEmbed(s, lk)], components: [this.suggestionButtons(s.id)] });
        }
        return;
      }
      case 'resumo': {
        await i.deferReply();
        const r = await this.app.summaries.generate((i.options.getString('tipo') ?? 'daily') as Resumo['type']);
        await i.editReply({ embeds: [summaryEmbed(r)] });
        return;
      }
      case 'perguntar': {
        await i.deferReply();
        const q = i.options.getString('pergunta', true);
        const a = await askAssistant(this.app, q);
        await i.editReply({
          embeds: [
            {
              title: `💬 ${truncate(q, 240)}`,
              description: truncate(a.answer, 4000),
              color: COLOR.brand,
              footer: { text: a.source === 'rules' ? 'Respondido com dados locais (motor de regras)' : `Respondido por ${a.source}` },
            },
          ],
        });
        return;
      }
      case 'painel': {
        await i.reply({ content: '🔄 Atualizando o painel…', flags: MessageFlags.Ephemeral });
        await this.refreshPanel(true);
        return;
      }
    }
  }

  private async button(i: ButtonInteraction) {
    const [, kind, action, id] = i.customId.split(':');
    if (kind === 'panel') {
      if (action === 'refresh') {
        await i.deferUpdate();
        await this.refreshPanel(true);
      } else if (action === 'radar') {
        const pending = this.app.db.sugestoes.filter((s) => s.status === 'pending').length;
        await i.reply({ content: pending ? `📡 ${pending} sugestão(ões) pendente(s). Use **/radar** para aprovar ou ignorar.` : '📡 Nenhuma sugestão pendente.', flags: MessageFlags.Ephemeral });
      } else if (action === 'overdue') {
        const now = new Date();
        const list = effectiveOrder(this.app.db.pautas.list()).filter((p) => isOverdue(p, now));
        await i.reply({ content: list.length ? truncate(list.map((p) => pautaLine(p)).join('\n\n'), 1900) : '✅ Nenhuma pauta atrasada.', flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (!id) return;
    if (kind === 'p') {
      const p = this.findPauta(id);
      const svc = this.app.pautas;
      if (action === 'done') await svc.update(id, { status: 'done' });
      else if (action === 'start') await svc.update(id, { status: 'in_progress' });
      else if (action === 'wait') await svc.update(id, { status: 'waiting' });
      else if (action === 'reopen') await svc.update(id, { status: 'todo' });
      else if (action === 'tomorrow') {
        const base = p.dueDate && dueToDate(p.dueDate) > new Date() ? dueToDate(p.dueDate) : new Date();
        await svc.update(id, { dueDate: toLocalDateKey(addDays(base, 1)) });
      }
      this.audit(i.user, `usou o botão "${action}" em "${p.title}"`);
      await i.update(this.pautaReply(id));
      return;
    }
    if (kind === 's') {
      const s = this.app.db.sugestoes.get(id);
      if (!s) throw new Error('Sugestão não encontrada.');
      if (s.status !== 'pending' && s.status !== 'snoozed') {
        await i.update({ content: `Esta sugestão já foi processada (${s.status}).`, components: [] });
        return;
      }
      if (action === 'approve') {
        const p = await this.app.radar.approve(id);
        this.audit(i.user, `aprovou a sugestão "${s.title}"`);
        await i.update({ content: `✅ Aprovada por ${i.user.username} — pauta criada \`${shortId(p.id)}\``, components: [] });
      } else if (action === 'ignore') {
        await this.app.radar.ignore(id);
        this.audit(i.user, `ignorou a sugestão "${s.title}"`);
        await i.update({ content: `🗑️ Ignorada por ${i.user.username}`, components: [] });
      } else if (action === 'snooze') {
        const until = addDays(startOfDay(new Date()), 1);
        until.setHours(8);
        await this.app.radar.snooze(id, until.toISOString());
        this.audit(i.user, `adiou a sugestão "${s.title}"`);
        await i.update({ content: `💤 Adiada até ${discordTime(until, 'f')}`, components: [] });
      }
    }
  }
}
