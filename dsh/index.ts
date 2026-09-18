/**
 * dsh (DeepSeek Harness) plugin shell for dsh-self-debug.
 *
 * Thin adapter only: registers the `self_debug` tool with the harness tool
 * registry and delegates to the dependency-free core in ../src/self-debug.ts.
 * Per ADR-0001 (decision 6) the dsh plugin is the ONLY component that touches
 * dsh APIs; the core stays portable.
 *
 * Status: pending dsh-runtime integration. Depends on @deepseek-ai/dsh-tools
 * and @deepseek-ai/cordis (pre-1.0, fast-moving). Type-checked separately from
 * the core via dsh/tsconfig.json so the core test suite never depends on dsh.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools';
import { selfDebug } from '../src/self-debug.ts';

export const name = 'dsh-self-debug';
export const inject = ['tools'];

// Verbatim, owner-approved tool description (docs/tool-description.md, approved
// by owner 2026-09-18). The tool description is the sole model-guidance channel
// per ADR-0001 (§Model guidance) — do not edit the wording.
const SELF_DEBUG_DESCRIPTION = `self_debug — Verify your own code changes before claiming progress.

Call this tool when you have just created or modified code and are about to (a) run tests or (b) report a coding step or task as complete or working. It detects the project type (node / python / go) from marker files, runs the project's verification pipeline (lint, tests, build), and returns a pure-text report. Every failed command comes with a structured diagnosis: a failure class (build_error, assertion_failure, timeout, environment_error, permission_error, or unknown) and a fixed next-step investigation hint, plus per-command durations showing where time went.

A failing report is a NORMAL result, not an error: read the diagnosis, fix the code, and call again. Do not state that a coding change works, passes, or is done unless a self_debug report shows all checks passed.

Parameters:
- directory (optional, string): project root to verify. Defaults to the current workspace root.

The report is capped (~60 lines / 4 KB). When output is truncated, the full log path is included — read it only if the diagnosis is not enough. If the project type cannot be identified, the report says so honestly; do not guess verification commands.`;

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'self_debug',
      description: SELF_DEBUG_DESCRIPTION,
      // dsh ParameterSchemaSpec form (NOT zod): one optional `directory`.
      parameters: {
        directory: {
          type: 'string',
          required: false,
          description: 'project root to verify. Defaults to the current workspace root.',
        },
      // dsh checks `required === true` at runtime, so `required: false` is a
      // valid optional-param form; the cast preserves the exact owner-specified
      // shape while satisfying the harness schema type.
      } as unknown as ParameterSchemaSpec,
      output: {
        schema: { type: 'string' },
        // Pure Native/model rendering: hand the report text straight back.
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      // Delegate to the core; it returns the deterministic pure-text report.
      execute: async (args) => {
        return await selfDebug({ directory: args.directory as string | undefined });
      },
    }),
  );
}
