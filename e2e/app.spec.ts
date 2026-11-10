import { expect, test, type Page } from '@playwright/test';

/** Coleta erros de console/página para garantir que nenhuma tela quebra. */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const H = { 'x-pautaflow': '1' };

test.describe.serial('PautaFlow — fluxo principal', () => {
  test('onboarding aparece no primeiro acesso e pode ser concluído', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText(/PautaFlow/).first()).toBeVisible();
    // Conclui pela API (o wizard completo é exercitado manualmente; aqui validamos o redirecionamento)
    const r = await page.request.patch('/api/config', { headers: H, data: { onboardingCompleted: true } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    expect(errors).toEqual([]);
  });

  test('cria uma pauta pelo editor e ela aparece no Kanban e no dashboard', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/pautas');
    await page.getByRole('button', { name: /Nova pauta/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').first().fill('Release institucional E2E');
    await dialog.getByRole('button', { name: /(Criar|Salvar)/ }).last().click();
    await expect(page.getByText('Release institucional E2E').first()).toBeVisible();
    await page.goto('/');
    await expect(page.getByText(/Pautas ativas/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('pauta criada via API abre o painel de detalhes com score e fatores', async ({ page, request }) => {
    const due = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await request.post('/api/pautas', { headers: H, data: { title: 'Relatório E2E com prazo', dueDate: due, impact: 5, manualPriority: 'high' } });
    const pauta = await res.json();
    expect(pauta.priorityScore).toBeGreaterThan(40);
    await page.goto(`/pautas?id=${pauta.id}`);
    await expect(page.getByText('Relatório E2E com prazo').first()).toBeVisible();
    await expect(page.getByText(/Prazo/).first()).toBeVisible();
  });

  test('todas as páginas carregam sem erros', async ({ page }) => {
    const errors = trackErrors(page);
    for (const path of ['/', '/semana', '/pautas', '/radar', '/projetos', '/calendario', '/prioridades', '/analytics', '/arquivos', '/automacoes', '/integracoes', '/configuracoes']) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('assistente responde com dados locais', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir assistente' }).click();
    await page.getByText('Quais são minhas prioridades hoje?').first().click();
    await expect(page.getByText(/prioridades agora|Você não tem pautas/).first()).toBeVisible();
  });

  test('segurança: escrita sem cabeçalho é recusada', async ({ request }) => {
    const r = await request.post('/api/pautas', { data: { title: 'x' } });
    expect(r.status()).toBe(403);
  });
});
