# PautaFlow Intelligence

**Central autônoma de pautas, demandas e produtividade** — aplicação local para Windows que monitora Outlook, Planner e Calendário (Microsoft 365), identifica demandas automaticamente, prioriza, resume e acompanha seu trabalho, com interface inspirada no *Liquid Glass*.

- 100% local: servidor Node.js em `127.0.0.1`, dados em **arquivos JSON** (sem banco de dados externo).
- Radar inteligente em segundo plano (funciona com a aba do navegador fechada).
- Motor determinístico para tudo que é essencial; IA (Ollama local ou provedor autorizado) apenas enriquece.
- Tokens Microsoft e chaves de API cifrados com **DPAPI** do Windows — nunca em texto puro.

---

## Sumário

1. [Requisitos](#requisitos)
2. [Instalação e execução](#instalação-e-execução)
3. [Conectar o Microsoft 365](#conectar-o-microsoft-365)
4. [Inteligência artificial (opcional)](#inteligência-artificial-opcional)
5. [Funcionalidades](#funcionalidades)
6. [Arquivos e pastas sinalizados](#arquivos-e-pastas-sinalizados)
7. [Versionamento automático](#versionamento-automático)
8. [Arquitetura](#arquitetura)
9. [Persistência JSON](#persistência-json)
10. [Automações](#automações)
11. [Segurança e privacidade](#segurança-e-privacidade)
12. [Scripts](#scripts)
13. [Testes](#testes)
14. [Solução de problemas](#solução-de-problemas)

---

## Requisitos

| Item | Versão |
| --- | --- |
| Windows | 10/11 |
| Node.js | 22.12+ (testado com 24.16) |
| npm | 10+ |
| Microsoft Edge | para os testes E2E (já vem no Windows) |

## Instalação e execução

**Jeito mais simples:** clique duas vezes em **`PautaFlow.exe`** (na pasta do projeto). Ele instala tudo na primeira vez, inicia o servidor em segundo plano (reinicia sozinho em caso de falha) e abre o painel no navegador. Se já estiver rodando, só abre o navegador. Para encerrar: `PautaFlow.exe --parar`. Para recriar o executável: `scripts\build-launcher.ps1` (usa o compilador C# que já vem no Windows).

Pela linha de comando:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1   # instala dependências e compila a interface
powershell -ExecutionPolicy Bypass -File scripts\start.ps1     # inicia e abre http://localhost:3000
```

- **Segundo plano (sem janela, com reinício automático em falhas):** `scripts\start-background.ps1`
- **Iniciar com o Windows:** em *Configurações → Inicialização com o Windows* (pede confirmação) ou `scripts\install-autostart.ps1`. Cria uma tarefa agendada de logon apenas para o seu usuário — sem serviço, sem administrador. Remover: `scripts\uninstall-autostart.ps1`.
- **Reiniciar / parar:** `scripts\restart.ps1`, `scripts\stop.ps1`.
- **Desenvolvimento:** `npm run dev` (API em `:3000` + Vite em `:5173` com recarga automática).

A porta e o diretório de dados são configuráveis no `.env` (veja `.env.example`). O servidor escuta apenas em `127.0.0.1`.

## Conectar o Microsoft 365

> Uma sessão do Outlook/Windows **não** concede acesso automático ao Microsoft Graph. O acesso oficial exige um *registro de aplicativo* no Microsoft Entra ID e o seu consentimento (às vezes o do administrador de TI). O PautaFlow não lê cookies, senhas ou tokens de outros aplicativos.

1. Acesse **portal.azure.com → Microsoft Entra ID → Registros de aplicativo → Novo registro**.
2. Nome: `PautaFlow (local)`; tipo de conta: *somente este diretório organizacional*.
3. **Autenticação → Adicionar plataforma → Aplicativos móveis e da área de trabalho**: Redirect URI `http://localhost`.
4. Em **Autenticação**, ative **Permitir fluxos de cliente público** (necessário para o login por código de dispositivo).
5. **Permissões de API → Microsoft Graph → Delegadas** (somente leitura): `User.Read`, `Mail.Read`, `Calendars.Read`, `Tasks.Read`. Se a organização exigir, peça à TI o *consentimento do administrador*.
6. Copie o **ID do aplicativo (cliente)** e o **ID do diretório (locatário)** para *Integrações* no PautaFlow e clique em **Entrar com o navegador** (ou **Usar código de dispositivo**).

Depois disso, o token é renovado automaticamente (refresh token cifrado com DPAPI em `data/secure/`). O PautaFlow **nunca altera** e-mails, eventos ou tarefas: as permissões são somente leitura e mudanças locais (ex.: arrastar prazos) ficam no PautaFlow.

### Sem acesso ao Entra ID? Use o Outlook deste computador

Se você não puder registrar o aplicativo (página do Entra bloqueada), ative **Integrações → Outlook deste computador**. O PautaFlow passa a ler, localmente e somente leitura, o **Outlook clássico** instalado (automação oficial do Office): Caixa de Entrada, e-mails sinalizados, itens enviados e calendário — sem token, sem registro de aplicativo e sem permissão da TI.

- Funciona com o Outlook clássico (não com o “novo Outlook”). Por padrão sincroniza apenas com o Outlook aberto; há uma opção para abri-lo em segundo plano.
- O Planner não tem leitura local: tarefas atribuídas a você chegam ao radar pelos **e-mails de notificação do Planner**. A sincronização completa do Planner (prazos, conclusões) exige o Microsoft 365 conectado.
- Quando o Microsoft 365 for conectado, ele passa a ser a fonte e o Outlook local fica em espera automaticamente.
- A primeira leitura cobre o período de busca (14 dias) e pode levar alguns minutos; as seguintes são incrementais. Nas sugestões, “Abrir no Outlook” abre o e-mail no Outlook do computador.

## Assistente Claude (opcional)

Em **Integrações → Claude (Anthropic)**: cole a chave da API (criada em console.anthropic.com, cobrança na conta da Anthropic; fica cifrada com DPAPI), autorize o envio dos dados consultados e salve. No painel do assistente (ícone ✦ no topo), escolha **Claude** e peça em linguagem natural, por exemplo:

- "O que tenho para hoje, entre reuniões e entregas?"
- "Crie uma pauta *Revisar release da feira* para sexta às 14h, prioridade alta, no projeto Feira."
- "Resuma os e-mails das últimas 24h que pedem ação." · "Aprove a sugestão do radar sobre o Quiz."

O Claude consulta pautas, e-mails sincronizados, agenda, sugestões e resumos, e — se "Permitir ações" estiver ligado — cria/atualiza pautas e decide sugestões. Ele **não exclui** nada nem envia e-mails. Modelo padrão: Claude Opus 5.5 (Sonnet 5.5 e Haiku 5.5 disponíveis). Sem chave/autorização, o assistente continua funcionando no modo **Local** (motor de regras).

## Inteligência artificial (opcional)

O sistema funciona integralmente sem IA. Em *Integrações → Inteligência*:

- **Ollama (local, recomendado para privacidade):** instale em [ollama.com](https://ollama.com), rode `ollama pull llama3.2` (ou outro modelo) e selecione-o. O PautaFlow detecta os modelos instalados — não presume que exista algum.
- **Provedor compatível com OpenAI** (Azure OpenAI, LM Studio etc.): URL base + modelo + chave (cifrada com DPAPI). Provedores externos exigem autorização explícita, pois o conteúdo dos e-mails sai do computador.

A IA enriquece: interpretação de e-mails no radar, narrativa dos resumos e perguntas abertas no assistente. Prioridades, prazos, atrasos, métricas e resumos estruturados são sempre determinísticos.

## Funcionalidades

| Área | O que faz |
| --- | --- |
| **Dashboard** | Saudação dinâmica, 8 indicadores com tendência observada, “Minha atenção hoje” com próxima ação recomendada, *Insights do PautaFlow*, resumo do dia, gráficos de distribuição e próximos compromissos. |
| **Radar Inteligente** | Sincronização incremental (delta) do Outlook (caixa de entrada, pastas escolhidas, itens enviados), Planner e Calendário; detecção de solicitações, aprovações e compromissos assumidos; extração de prazos em português (“até sexta”, “15/11”, “fim do mês”, “em 5 dias úteis”…); solicitante, categoria e projeto; deduplicação Outlook × Planner com referências cruzadas; cards com justificativa, evidência e link da fonte; ações **Aprovar, Editar, Ignorar, Adiar, Vincular**. Nada vira pauta sem sua aprovação. |
| **Pautas** | Kanban (arrastar entre status), Lista virtualizada, Calendário, Timeline e Matriz de prioridades — todas sobre os mesmos dados. Checklist, subtarefas, comentários, links, arquivos, dependências, fontes e histórico completo. |
| **Prioridades** | Score 0–100 transparente (prazo 35, urgência 15, impacto 15, dependências 10, risco de atraso 15, estado 5, carga 5, bloqueio −10, ajuste manual ±30) com justificativa e fatores. Recalcula ao criar/alterar/concluir e periodicamente. Ordem manual nunca é sobrescrita sem você aceitar a recomendação. |
| **Minha Semana / Calendário** | Visões dia/semana/mês com pautas, reuniões do Outlook e tarefas do Planner; carga vs. capacidade; arraste para reorganizar prazos (somente local). |
| **Analytics** | Métricas observadas × estimativas (rotuladas), comparação com o período anterior, séries diária/semanal/mensal, categorias, origens, tempo médio por categoria, projetos mais ativos, funil de sugestões e heatmap de produtividade. Exporta JSON, CSV e PDF (impressão). |
| **Resumos** | Diário (início do expediente), semanal (segunda-feira) e mensal, armazenados com histórico. |
| **Assistente** | Perguntas como “Quais são minhas prioridades hoje?” ou “Tenho alguma entrega atrasada?” respondidas com dados locais, com atalhos para abrir as pautas. |
| **Notificações** | No painel e, opcionalmente, nativas do Windows (com horário de silêncio e limite por hora): sugestões, críticas, prazos, atrasos, aprovações, conflitos de agenda, esquecimentos, erros de integração. |
| **Automações** | Status, última/próxima execução, itens processados, erros, histórico e “Executar agora” para cada serviço; saúde do sistema; backups e restauração. |

## Arquivos e pastas sinalizados

Em **Arquivos** (ou dentro de uma pauta/projeto) clique em **Selecionar arquivo** ou **Selecionar pasta**: o seletor nativo do Windows abre no computador e o item fica sinalizado com:

- **Abrir** (pasta no Explorer, arquivo no aplicativo padrão) e **Mostrar na pasta**;
- **Link web** automático quando o item está numa pasta sincronizada do **OneDrive/SharePoint** (o PautaFlow lê, somente leitura, o mapeamento local→URL do cliente de sincronização);
- indicação de link quebrado quando o arquivo foi movido/excluído.

Os arquivos são apenas referenciados — nunca copiados, movidos ou apagados.

## Versionamento automático

Formato **X.Y.Z**:

| Parte | Significado | Exemplo |
| --- | --- | --- |
| **X** | funções novas | `1.4.2 → 2.0.0` |
| **Y** | correções das funções atuais | `1.4.2 → 1.5.0` |
| **Z** | correções visuais | `1.4.2 → 1.4.3` |

A cada commit, o hook `.githooks/post-commit` (ativado automaticamente pelo `npm install` via `core.hooksPath`) lê a mensagem e atualiza a versão em todos os `package.json`, em `version-history.json` e no `CHANGELOG.md`, emendando no próprio commit (com o trailer `Version: X.Y.Z`):

| Mensagem | Resultado |
| --- | --- |
| `feat: …`, `feature: …`, `novo: …` ou `[feature]` | X |
| `fix: …`, `corrige …`, `perf: …`, `refactor: …` ou `[fix]` | Y |
| `style: …`, `ui: …`, `visual: …` ou `[visual]` | Z |
| `docs:`, `chore:`, `test:` ou `[skip-version]` | sem alteração |

Atualização manual: *Configurações → Versão* ou

```powershell
npm run version:bump -- feature "Radar de prazos"
npm run version:set -- 2.0.0 "Nova geração"
```

Se o commit já alterar a versão manualmente, o hook respeita a escolha.

## Arquitetura

```
apps/
  server/                 Fastify + TypeScript (executado com tsx)
    src/storage/          persistência JSON: escrita atômica, fila serializada, recuperação, backups
    src/intelligence/     prazos PT-BR, radar, deduplicação, prioridades, insights, provedores de IA
    src/integrations/     Microsoft Graph (MSAL + DPAPI): Outlook, Planner, Calendário
    src/automation/       agendador persistente e jobs
    src/analytics/        métricas e exportação
    src/modules/          pautas, radar, resumos, visões (dashboard, semana, calendário, assistente)
    src/system/           Windows: DPAPI, notificações, seletor de arquivos, Explorer, Agendador de Tarefas
    src/routes/           API HTTP + SSE (atualização em tempo real da interface)
  web/                    React 19 + Vite + Tailwind v4 + Radix + Motion + TanStack Query + Zustand + Recharts + dnd-kit
packages/shared/          schemas Zod e tipos compartilhados (contrato único)
scripts/                  instalação, execução, supervisor, autostart, backup, integridade, versionamento
data/  backups/  logs/    gerados em tempo de execução (ignorados pelo Git)
```

Os componentes de interface seguem o padrão *shadcn/ui* (componentes próprios sobre Radix UI + Tailwind, em `apps/web/src/components/ui`). Fonte: Inter (licença OFL).

## Persistência JSON

```
data/
  users.json  configuracoes.json  pautas.json  projetos.json  categorias.json
  sugestoes.json  notificacoes.json  arquivos.json  metricas.json
  automacoes.json  sincronizacao.json  integracoes.json
  historico/AAAA-MM.json   resumos/AAAA-MM.json      (particionados por mês)
  fontes/  outlook-mensagens.json  planner-tarefas.json  calendario-eventos.json
  fila/radar.json          (fila local de análise)
  secure/  msal-cache.dat  secrets.dat               (cifrados com DPAPI)
```

Cada gravação: validação Zod → arquivo temporário → `fsync` → cópia `.bak` da versão anterior → `rename` atômico (com novas tentativas para bloqueios do Windows) → releitura e conferência de hash. Gravações por arquivo passam por uma fila serializada e coalescente. Ao iniciar: limpeza de temporários órfãos; arquivos inválidos vão para quarentena (`.corrupt-*`) e são restaurados do `.bak` ou do backup mais recente. Um arquivo de trava impede duas instâncias no mesmo diretório.

Backups: diário automático (14 versões), antes de operações críticas, manual (*Automações*), restauração com cópia de segurança prévia e exportação completa em JSON.

## Automações

| Serviço | Padrão |
| --- | --- |
| Radar Outlook | 5 min |
| Radar Planner | 10 min |
| Calendário | 10 min |
| Análise inteligente | 5 min (e logo após cada sincronização) |
| Reavaliação de prioridades, prazos, esquecimentos e conflitos | 15 min |
| Resumo diário / semanal / mensal | 08:00 / segunda 08:15 / dia 1 |
| Backup / manutenção | 12:30 / 12:45 |

Todas as frequências são configuráveis. Execuções perdidas (computador desligado) são recuperadas ao iniciar; falhas consecutivas aplicam espera exponencial; o Graph é respeitado em caso de *throttling* (429/503 com `Retry-After`).

## Segurança e privacidade

- Servidor apenas em `127.0.0.1`; requisições com `Host`/`Origin` externos são recusadas (proteção contra DNS rebinding) e operações de escrita exigem o cabeçalho `X-PautaFlow` (proteção contra CSRF).
- Permissões Microsoft somente leitura; nenhuma escrita em Outlook/Planner/Calendário.
- Tokens e chaves cifrados com DPAPI (escopo do usuário Windows); logs com redação de campos sensíveis.
- Nenhum dado sai do computador, exceto para o Microsoft Graph (sua conta) e, se você autorizar, para um provedor de IA externo.

## Scripts

| Comando | Descrição |
| --- | --- |
| `scripts\install.ps1` | instala dependências, compila a interface, cria `.env` |
| `scripts\start.ps1` | inicia em primeiro plano e abre o navegador |
| `scripts\start-background.ps1` | supervisor sem janela com reinício automático |
| `scripts\restart.ps1` / `scripts\stop.ps1` | reinicia / encerra |
| `scripts\install-autostart.ps1` / `uninstall-autostart.ps1` | inicialização com o Windows |
| `npm run check` | verificação de integridade (somente leitura) |
| `npm run backup` | backup manual |
| `npm run version:show` / `version:bump` / `version:set` | versionamento |
| `npm run dev` | desenvolvimento |
| `npm run typecheck` | checagem de tipos de todo o projeto |

## Testes

```powershell
npm test            # unitários e de integração (Vitest)
npm run test:e2e    # ponta a ponta (Playwright com Microsoft Edge, dados temporários isolados)
```

Os testes de integração usam respostas simuladas do Microsoft Graph **apenas dentro dos testes**; a aplicação nunca exibe dados simulados.

## Solução de problemas

| Sintoma | Solução |
| --- | --- |
| “Outra instância do PautaFlow já está usando…” | já há um servidor rodando; use `scripts\stop.ps1` |
| AADSTS65001 / consentimento | a organização exige aprovação do administrador para as permissões |
| AADSTS50011 / redirect | adicione `http://localhost` (plataforma *Mobile and desktop*) no registro |
| Código de dispositivo recusado | ative “Permitir fluxos de cliente público” |
| Seletor de arquivos não aparece | ele pode abrir atrás do navegador — verifique a barra de tarefas |
| Arquivo de dados corrompido | o servidor recupera sozinho; veja `npm run check` e `logs/` |
