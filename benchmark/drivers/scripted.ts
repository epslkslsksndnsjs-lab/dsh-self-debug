// Deterministic, offline "fake" agent driver (T8, issue #9).
//
// Follows the same AgentDriver contract a real dsh session would, but makes
// its edits from a script rather than a model. It is the implementation that
// lets us verify the harness end-to-end with NO LLM and NO network:
//
//   - 'solve'  writes the task's canonical `solution` over the scaffold and
//              claims done. In the plugin arm it also calls self_debug on its
//              eligible turn, exercising the call-rate instrumentation.
//   - 'cheat'  edits the acceptance-test file so it trivially passes — this is
//              the exact behaviour the hash guard must catch and fail.
//   - 'idle'   makes no edits and never claims done (used by the dry-run
//              self-check to judge acceptance in isolation, no agent).
//
// The `solution` field is fixture data for THIS driver only; the real dsh
// model driver (T9) never reads it.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDriver, Arm, BenchmarkTask, DriverContext, DriverRoundResult } from '../types.ts';

export type ScriptedBehavior = 'solve' | 'cheat' | 'idle';

export interface ScriptedOptions {
  arm: Arm;
  behavior: ScriptedBehavior;
  /** Whether the plugin arm calls self_debug on its eligible turn. */
  callTool?: boolean;
}

export class ScriptedDriver implements AgentDriver {
  readonly name: string;
  readonly arm: Arm;
  readonly selfDebugAvailable: boolean;
  private readonly behavior: ScriptedBehavior;
  private readonly callTool: boolean;

  constructor(opts: ScriptedOptions) {
    this.arm = opts.arm;
    this.behavior = opts.behavior;
    // Plugin arm calls the tool by default; plain arm never can.
    this.callTool = opts.callTool ?? opts.arm === 'plugin';
    this.selfDebugAvailable = opts.arm === 'plugin';
    this.name = `scripted:${this.arm}:${this.behavior}`;
  }

  async runRound(ctx: DriverContext): Promise<DriverRoundResult> {
    switch (this.behavior) {
      case 'idle':
        // No edits, never claims done — used so the harness verdict path runs
        // against a task's own (passing or failing) scaffold with no agent.
        return { claimedDone: false };

      case 'cheat': {
        // Tamper with the acceptance-test file so it "passes" by definition.
        // The harness's hash guard must detect this and force a failure.
        const rel = ctx.task.acceptanceFiles[0];
        if (rel) {
          const full = join(ctx.workspace, rel);
          writeFileSync(full, '// acceptance file tampered by a cheating agent\n', 'utf8');
        }
        ctx.markEligibleTurn(!!ctx.callSelfDebug);
        return { claimedDone: true };
      }

      case 'solve': {
        // Surface the bug first (plugin arm only), then apply the canonical fix.
        if (ctx.callSelfDebug && this.callTool) {
          await ctx.callSelfDebug();
          ctx.markEligibleTurn(true);
        } else {
          ctx.markEligibleTurn(false);
        }
        for (const [rel, content] of Object.entries(ctx.task.solution)) {
          writeFileSync(join(ctx.workspace, rel), content, 'utf8');
        }
        return { claimedDone: true };
      }
    }
  }
}
