# dsh version pins

ADR-adjacent record of the DeepSeek Harness (dsh) dependency versions the
plugin shell is built and type-checked against. Recorded here — not in
`docs/adr/` — per the ticket's "do not modify docs/adr/" rule. dsh is
pre-1.0 and fast-moving; these pins capture the exact resolution used to
validate the shell (ticket #7).

| Package | Pinned version | Role |
|---|---|---|
| `@deepseek-ai/cordis` | `^4.0.2` (resolved `4.0.2`) | Cordis context + `Context.tools` augmentation |
| `@deepseek-ai/dsh-tools` | `^0.0.1-rc.1` (resolved `0.0.1-rc.1`) | `defineTool` + `ParameterSchemaSpec` + tool registry |

Notes:
- These are listed as `dependencies` in `package.json` (the dsh runtime
  supplies them; the shell references them). Install succeeded via
  `npm install --registry=https://registry.npmmirror.com`.
- The plugin shell (`dsh/index.ts`) is type-checked separately from the core
  via `dsh/tsconfig.json` (`npm run typecheck:dsh`) so the core suite never
  depends on dsh.
- Full in-harness validation (local-profile install, `dsh plugin check`) is
  pending a dsh runtime environment ("待 dsh 环境联调").
