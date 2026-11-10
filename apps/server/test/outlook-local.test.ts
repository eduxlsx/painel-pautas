import { describe, expect, it } from 'vitest';
import { mapEvent, mapMail, type RawMail } from '../src/integrations/outlook-local/service';
import { analyzeMail, type RadarContext } from '../src/intelligence/radar';
import { MailMessage } from '../src/storage/internalSchemas';

const now = new Date(2026, 10, 10, 9, 0);
const raw = (o: Partial<RawMail>): RawMail => ({
  id: '00000000ABCDEF',
  folderId: 'inbox',
  folderName: 'Caixa de Entrada',
  subject: 'Assunto',
  fromName: 'Ana',
  fromEmail: 'Ana@Empresa.com',
  to: 'eu@empresa.com', // PowerShell 5 serializa array de 1 item como escalar
  cc: null,
  receivedAt: now.toISOString(),
  body: 'Corpo',
  importance: 2,
  flagged: true,
  flagDue: null,
  isRead: false,
  conversationId: 'C1',
  hasAttachments: false,
  categories: 'Azul; Importante',
  messageClass: 'IPM.Note',
  ...o,
});

describe('Outlook local — mapeamento', () => {
  it('normaliza e-mail lido via COM', () => {
    const m = mapMail(raw({}))!;
    expect(m.to).toEqual(['eu@empresa.com']);
    expect(m.fromEmail).toBe('ana@empresa.com');
    expect(m.importance).toBe('high');
    expect(m.categories).toEqual(['Azul', 'Importante']);
    expect(m.webLink).toContain('/api/integrations/outlook-local/open?id=');
    expect(m.isSent).toBe(false);
  });
  it('itens enviados e convites de reunião', () => {
    expect(mapMail(raw({ folderId: 'sentitems' }))!.isSent).toBe(true);
    expect(mapMail(raw({ messageClass: 'IPM.Schedule.Meeting.Request' }))!.meetingMessageType).toBe('request');
    expect(mapMail(raw({ receivedAt: null }))).toBeNull();
  });
  it('eventos: cancelados, dia inteiro e link do Teams', () => {
    const e = mapEvent({ id: 'E1|202611101000', subject: 'Reunião', start: '2026-11-10T13:00:00.000Z', end: '2026-11-10T14:00:00.000Z', allDay: false, location: '', organizer: 'Ana', busy: 2, meetingStatus: 1, responseStatus: 3, body: 'Entrar: https://teams.microsoft.com/l/meetup-join/abc123 ' })!;
    expect(e.showAs).toBe('busy');
    expect(e.onlineMeetingUrl).toContain('teams.microsoft.com');
    expect(mapEvent({ id: 'E2|1', subject: 'X', start: '2026-11-11', end: '2026-11-12', allDay: true, location: '', organizer: '', busy: 0, meetingStatus: 5, responseStatus: 0, body: '' })!.isCancelled).toBe(true);
  });
});

describe('Radar — notificações do Planner por e-mail', () => {
  const ctx: RadarContext = { now, myEmails: ['eu@empresa.com'], categories: [], projects: [], ignoreSenders: [] };
  const mail = (o: Partial<MailMessage>) =>
    MailMessage.parse({ id: 'p1', folderId: 'inbox', fromName: 'Microsoft Planner', fromEmail: 'noreply@planner.office365.com', receivedAt: now.toISOString(), syncedAt: now.toISOString(), ...o });

  it('atribuição vira demanda com título, plano e prazo', () => {
    const c = analyzeMail(mail({ subject: 'Maria Silva atribuiu "Revisar release Fenasucro" a você', bodyText: 'Maria Silva atribuiu uma tarefa a você no plano Comunicação\nData de conclusão: 13/11/2026' }), ctx)!;
    expect(c.title).toBe('Revisar release Fenasucro');
    expect(c.requester).toBe('Maria Silva');
    expect(c.dueDate).toBe('2026-11-13');
    expect(c.confidence).toBe(0.8);
    expect(c.signals[0]).toMatch(/Planner/);
  });
  it('outras notificações do Planner são ignoradas', () => {
    expect(analyzeMail(mail({ subject: 'Novo comentário na tarefa', bodyText: 'João comentou na tarefa.' }), ctx)).toBeNull();
    expect(analyzeMail(mail({ subject: 'Você tem tarefas atrasadas', bodyText: 'Tarefas atribuídas a você no plano Comunicação estão atrasadas.' }), ctx)).toBeNull();
  });
});

describe('Radar — falsos positivos observados em e-mails reais', () => {
  const ctx: RadarContext = { now, myEmails: ['eu@empresa.com'], categories: [], projects: [], ignoreSenders: [] };
  const mail = (o: Partial<MailMessage>) =>
    MailMessage.parse({ id: 'x', folderId: 'inbox', fromName: 'Ana', fromEmail: 'ana@empresa.com', to: ['eu@empresa.com'], receivedAt: now.toISOString(), syncedAt: now.toISOString(), ...o });

  it('chamado encerrado não é demanda', () => {
    expect(analyzeMail(mail({ subject: 'A solicitação RITM5039404 foi encerrada', bodyText: 'Por favor avalie o atendimento.' }), ctx)).toBeNull();
  });
  it('"de acordo com" não é pedido de aprovação', () => {
    const c = analyzeMail(mail({ subject: 'Levantamento', bodyText: 'Pode enviar o levantamento até sexta, de acordo com o modelo?' }), ctx)!;
    expect(c.kind).not.toBe('aprovacao');
  });
  it('em cópia: não vira aprovação e perde confiança', () => {
    const c = analyzeMail(mail({ to: ['outro@empresa.com'], cc: ['eu@empresa.com'], subject: 'Comunicado para aprovação', bodyText: 'Pode aprovar o comunicado?' }), ctx);
    expect(c === null || (c.kind !== 'aprovacao' && c.confidence < 0.45)).toBe(true);
  });
  it('aprovação direta continua reconhecida', () => {
    expect(analyzeMail(mail({ subject: 'Arte da campanha', bodyText: 'Você pode aprovar a arte até amanhã?' }), ctx)!.kind).toBe('aprovacao');
  });
});
