// Real dsh (DeepSeek Harness) agent driver — integration point for T9 (issue #9).
//
// This class pins the AgentDriver contract the real driver must satisfy and
// documents the integration point. It is intentionally NOT invoked in T8:
// DEEPSEEK_API_KEY is unavailable and the ticket forbids real agent runs. The
// real implementation (T9) shells out to `npx @deepseek-ai/dsh` running the
// Minimal profile (bash + file editor + self_debug tool), drives up to N=3
// in-session repair rounds, and — critically — routes every self_debug call
// through `ctx.callSelfDebug` and marks each "about to claim done" moment via
// `ctx.markEligibleTurn` so the harness can compute the call-rate. `runRound`
// here throws to make it impossible to accidentally run a real session.
//
// The driver is constructed per arm; the plugin arm advertises
// `selfDebugAvailable = true` (the tool is registered in the profile), while
// the plain arm does not register it (same repair budget, no tool).

import type { AgentDriver, Arm, DriverContext, DriverRoundResult } from '../types.ts';

export class DshDriver implements AgentDriver {
  readonly name = 'dsh';
  readonly arm: Arm;
  readonly selfDebugAvailable: boolean;

  constructor(arm: Arm) {
    this.arm = arm;
    this.selfDebugAvailable = arm === 'plugin';
  }

  async runRound(_ctx: DriverContext): Promise<DriverRoundResult> {
    throw new Error(
      'DshDriver.runRound is implemented in T9 (real dsh session). ' +
        'DEEPSEEK_API_KEY is not available in T8; use ScriptedDriver for offline verification.',
    );
  }
}
