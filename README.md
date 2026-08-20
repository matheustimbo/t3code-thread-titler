# t3code-thread-titler

Quando a primeira mensagem de uma thread nova no t3code (qualquer projeto)
referencia exatamente um card do ClickUp ou uma issue do GitHub, essa thread
é renomeada automaticamente pra o título do card/issue. O link pode estar em
qualquer posição da mensagem, com texto em volta.

Não modifica o t3code — é um cliente externo que fala com o WS-RPC que o
próprio app web usa (`orchestration.subscribeShell`,
`orchestration.subscribeThread`, `orchestration.dispatchCommand`), com um
bearer token emitido pelo próprio `t3 auth session issue`.

## Como funciona

1. Assina `orchestration.subscribeShell` — detecta threads novas em
   qualquer projeto.
2. Pra cada thread nova, assina `orchestration.subscribeThread` até chegar
   a primeira mensagem do usuário.
3. Se essa mensagem referenciar **exatamente um** card/issue (o link pode
   estar em qualquer posição, cercado de texto; o mesmo link repetido conta
   uma vez; dois cards distintos = não renomeia):
   - `https://app.clickup.com/t/<team_id>/<task_id>` → busca o título via
     API do ClickUp → `86ajkgub1 - Notificação Vimeo` (usa o `custom_id` da
     task quando o space define um, senão o id cru — o mesmo valor das
     branches `clickup-<id>`).
   - `https://github.com/<owner>/<repo>/issues/<n>` → busca o título via
     `gh issue view` (sessão do `gh` já autenticada na máquina) →
     `#172 - Mobile RN: criar navegação`.

   Se o nome do card já começa com o próprio id, o prefixo não é duplicado.
4. Dispara `thread.meta.update` com o título resolvido — isso sobrescreve
   incondicionalmente qualquer título que o auto-titler por LLM do t3code
   já tenha colocado.

Sem link, com dois ou mais cards distintos, ou com link de PR (só issue
conta), nada acontece — o auto-título normal do t3code segue.

## Configuração necessária

- **Token do t3code** (já emitido): `~/.t3/userdata/secrets/thread-titler.token`,
  criado com:
  ```
  t3 auth session issue --ttl 3650d --label thread-titler --token-only \
    > ~/.t3/userdata/secrets/thread-titler.token
  chmod 600 ~/.t3/userdata/secrets/thread-titler.token
  ```
  Pra revogar: `t3 auth session list` (acha o id da sessão com label
  `thread-titler`) e `t3 auth session revoke <session-id>`.

- **Token do ClickUp**: lido de `~/.config/clickup/token` (o mesmo arquivo
  que o ferramental do `/handbook` usa), então não há segunda cópia do
  segredo e rotacionar lá basta. `CLICKUP_API_TOKEN` no ambiente, se
  existir, tem precedência.

- **`gh` CLI**: precisa estar no PATH do serviço e autenticado como o
  mesmo usuário (`gh auth status`). O systemd `--user` já roda como você;
  se `gh` foi instalado num diretório fora do PATH padrão do systemd,
  ajuste `Environment=PATH=...` no `.service`.

## Rodar manualmente (antes de instalar como serviço)

```
npm install
npm start
```

Abra uma thread nova no t3code com uma mensagem que contenha
`https://app.clickup.com/t/<team_id>/<task_id>` ou
`https://github.com/<owner>/<repo>/issues/<n>` e veja o log e o título da
thread mudarem.

## Instalar como serviço

```
mkdir -p ~/.config/systemd/user
cp t3code-thread-titler.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now t3code-thread-titler
journalctl --user -u t3code-thread-titler -f
```

## Smoke test (rode depois de re-vendorizar)

```
npx tsx verify-thread.ts <threadId> --dry   # só resolve o título, não renomeia
npx tsx verify-thread.ts <threadId>         # caminho completo, renomeia
```

Existe porque a API do Effect/contracts vendorizado muda: um
`Effect.catchAll` renomeado (para `Effect.catch`/`catchCause` no Effect 4) já
quebrou o watcher de threads em silêncio, enquanto a conexão continuava
parecendo saudável no log. Pegue um `threadId` com:

```
sqlite3 "file:$HOME/.t3/userdata/state.sqlite?mode=ro" -readonly \
  "SELECT thread_id, title FROM projection_threads WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5;"
```

## Se parar de funcionar depois de um update do t3code

O `vendor/contracts/` é uma cópia de `packages/contracts` do
github.com/pingdotgg/t3code (não é publicado no npm). O t3code está em
canal nightly e pode mudar o formato do RPC. Se os logs começarem a mostrar
erro de parse/schema:

```
git clone --depth 1 https://github.com/pingdotgg/t3code /tmp/t3code-src
rsync -a --exclude='*.test.ts' /tmp/t3code-src/packages/contracts/src/ vendor/contracts/src/
systemctl --user restart t3code-thread-titler
npx tsx verify-thread.ts <threadId> --dry   # confirme que o caminho ainda funciona
```
