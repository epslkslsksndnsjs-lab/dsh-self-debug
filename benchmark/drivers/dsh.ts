// Real dsh (DeepSeek Harness) agent driver — T9 integration point (issue #10).
//
// Shells out to `npx @deepseek-ai/dsh` running the dsh **Minimal** profile
// (bash + file editor; the self_debug tool is registered only for the plugin
// arm via the repo's plugin shell — dsh/index.ts + cordis.patch.yml, package
// "dsh-self-debug"). It drives the same in-session repair loop as the offline
// scripted driver, up to N=3 rounds, and lets the harness own the verdict path.
//
// Two realities shape this file:
//
//  1. DEEPSEEK_API_KEY is read from the environment at run time, NEVER
//     hardcoded. If it is missing the driver throws a clear, actionable error
//     ("set DEEPSEEK_API_KEY") — this is the only hard gate that stops a run.
//
//  2. The self_debug tool is called INSIDE the dsh session, so the harness
//     cannot intercept it through `ctx.callSelfDebug`. Instead we capture the
//     session transcript and parse it for self_debug invocations (call-rate
//     numerator) and "about to claim done" moments (eligible-turn / call-rate
//     denominator), marking each eligible turn via `ctx.markEligibleTurn`. The
//     parser is best-effort and unit-tested against fixture transcripts; the
//     exact dsh session-log grammar is unknowable offline (see parseTranscript
//     for the documented assumed format and its TODO).
//
// This driver is intentionally NOT exercised in T8 (no key, no network). It
// compiles under the standard typecheck and is unit-tested for (a) the missing
// key gate and (b) the transcript parser. The actual model runs happen later
// once DEEPSEEK_API_KEY is supplied.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDriver, Arm, DriverContext, DriverRoundResult } from '../types.ts';

/** Bundled Node toolchain dir (mirrors run.ts / test setup.ts). */
const DEFAULT_NODE_BIN = '/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-2/bin';
const NODE_BIN_DIR = process.env.DSH_NODE_BIN_DIR ?? DEFAULT_NODE_BIN;

/** dsh CLI launcher + profile (best-effort; see DSH_PLUGIN_ARGS TODO). */
const DSH_CLI_LAUNCHER = 'npx';
const DSH_PACKAGE = '@deepseek-ai/dsh';
const DSH_PROFILE = 'minimal';

// TODO(FLAG): The exact dsh CLI flag that enables this repo's plugin is NOT
// determinable offline — @deepseek-ai/dsh is not installed in node_modules and
// the task forbids running the CLI to discover it. The repo wires the plugin
// via cordis.patch.yml (package "dsh-self-debug", profile layer insert), so the
// most likely mechanism is a `--plugin` flag naming the package or its patch
// manifest. This is a BEST-SUPPORTED GUESS; replace DSH_PLUGIN_ARGS with the
// verified flag once the CLI is available (and update buildDshArgs if the flag
// shape differs). The plugin arm MUST NOT register self_debug when omitted.
const DSH_PLUGIN_ARGS: string[] = ['--plugin', 'dsh-self-debug']; // TODO(FLAG)

/** Hard per-round cap for one dsh session (killable). Generous; 10 min. */
export const PER_ROUND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Build the argv for the dsh CLI invocation for one repair round. The plugin
 * arm passes DSH_PLUGIN_ARGS so self_debug is registered; the plain arm does
 * not, keeping the fairness rule (same repair budget, no tool).
 */
export function buildDshArgs(ctx: DriverContext, prompt: string): string[] {
  const args = [DSH_PACKAGE, 'run', '--profile', DSH_PROFILE, '--prompt', prompt, '--cwd', ctx.workspace];
  if (ctx.arm === 'plugin') {
    args.push(...DSH_PLUGIN_ARGS); // TODO(FLAG): verify flag once CLI known
  }
  return args;
}

/**
 * Repair-round framing appended to the task prompt: tells the model this is
 * round r of N and to stop when it believes the task is complete. The harness
 * re-runs acceptance independently regardless of the model's claim.
 */
export function buildRepairFraming(ctx: DriverContext): string {
  const { round, maxRounds } = ctx;
  return (
    `\n\n[Repair protocol] This is repair round ${round} of ${maxRounds}. ` +
    `You may attempt up to ${maxRounds} rounds. Fix the code and, when you ` +
    `believe the task is complete, stop. The harness will independently re-run ` +
    `the acceptance tests; your own "done" claim is not trusted.`
  );
}

/**
 * Assumed dsh session-log line grammar (BEST-EFFORT — see file header). One
 * marker per line:
 *   TOOL_CALL self_debug
 *   CLAIM_DONE called_self_debug=true|false
 *   TOKENS input=<n> output=<m>
 * Replace these with the real dsh log grammar once the CLI is available; the
 * unit tests in test/benchmark-transcript-parser.test.ts pin this contract.
 */
export interface TranscriptAnalysis {
  /** Count of self_debug tool invocations (call-rate numerator). */
  selfDebugCalls: number;
  /** "About to claim done" moments; calledSelfDebug records if self_debug ran first. */
  claimDoneMoments: { calledSelfDebug: boolean }[];
  /** True if the model announced completion at least once this round. */
  claimedDone: boolean;
  /** Token usage parsed from the log, or null when not obtainable. */
  tokens: { input: number | null; output: number | null } | null;
}

export function parseTranscript(text: string): TranscriptAnalysis {
  let selfDebugCalls = 0;
  const claimDoneMoments: { calledSelfDebug: boolean }[] = [];
  let input: number | null = null;
  let output: number | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^TOOL_CALL\s+self_debug\b/i.test(line)) {
      selfDebugCalls += 1;
    } else if (/^CLAIM_DONE\b/i.test(line)) {
      const m = line.match(/called_self_debug=(true|false)/i);
      claimDoneMoments.push({ calledSelfDebug: m ? m[1]!.toLowerCase() === 'true' : false });
    } else if (/^TOKENS\b/i.test(line)) {
      const im = line.match(/input=(\d+)/i);
      const om = line.match(/output=(\d+)/i);
      if (im) {
        const n = Number(im[1]);
        if (!Number.isNaN(n)) input = (input ?? 0) + n;
      }
      if (om) {
        const n = Number(om[1]);
        if (!Number.isNaN(n)) output = (output ?? 0) + n;
      }
    }
  }

  return {
    selfDebugCalls,
    claimDoneMoments,
    claimedDone: claimDoneMoments.length > 0,
    tokens: input !== null || output !== null ? { input, output } : null,
  };
}

/** Spawn a dsh session, capturing the transcript, with a killable timeout. */
async function runDsh(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ transcript: string; timedOut: boolean }> {
  // Ensure the bundled Node toolchain (and thus `npx`) resolves even from a
  // bare shell; never mutate the host's persisted PATH.
  const env = { ...process.env };
  if (existsSync(join(NODE_BIN_DIR, 'node'))) {
    const sep = process.platform === 'win32' ? ';' : ':';
    env.PATH = `${NODE_BIN_DIR}${sep}${env.PATH ?? ''}`;
  }

  return new Promise((resolve) => {
    const child = spawn(DSH_CLI_LAUNCHER, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const pid = child.pid;
    const chunks: Buffer[] = [];
    const onData = (c: Buffer): void => {
      chunks.push(c);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (transcript: string, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ transcript, timedOut });
    };

    child.on('exit', (code) => {
      if (settled) return;
      const transcript = Buffer.concat(chunks, chunks.reduce((a, c) => a + c.length, 0)).toString('utf8');
      // Non-zero exit is treated as a failed session; we still hand the
      // (possibly partial) transcript to the parser. The harness verdict path
      // is independent and will catch any real failure.
      void code;
      finish(transcript, false);
    });

    timer = setTimeout(() => {
      const transcript = Buffer.concat(chunks, chunks.reduce((a, c) => a + c.length, 0)).toString('utf8');
      if (pid != null) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // group may already be gone
        }
      }
      finish(transcript, true);
    }, timeoutMs);
  });
}

export class DshDriver implements AgentDriver {
  readonly name = 'dsh';
  readonly arm: Arm;
  readonly selfDebugAvailable: boolean;

  constructor(arm: Arm) {
    this.arm = arm;
    this.selfDebugAvailable = arm === 'plugin';
  }

  async runRound(ctx: DriverContext): Promise<DriverRoundResult> {
    // Hard gate: no key => no run. The key is read from env, never hardcoded.
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error(
        'DEEPSEEK_API_KEY is not set. The real dsh driver requires a DeepSeek API key to run ' +
          'the agent session. Export DEEPSEEK_API_KEY (e.g. `export DEEPSEEK_API_KEY=...`) before ' +
          'running the benchmark. The key is read from the environment at run time and is never ' +
          'written to records or logs.',
      );
    }

    const prompt = `${ctx.task.prompt}${buildRepairFraming(ctx)}`;
    const args = buildDshArgs(ctx, prompt);
    const { transcript, timedOut } = await runDsh(args, ctx.workspace, PER_ROUND_TIMEOUT_MS);

    if (timedOut) {
      // The round exceeded the hard cap; do not claim completion. The
      // harness will count this as a used round and may retry next round.
      return { claimedDone: false };
    }

    const parsed = parseTranscript(transcript);
    // Mark each "about to claim done" moment so the harness can compute the
    // call-rate over eligible turns. We never route through ctx.callSelfDebug
    // (that would run the LOCAL core, not the in-session dsh tool call).
    for (const moment of parsed.claimDoneMoments) {
      ctx.markEligibleTurn(moment.calledSelfDebug);
    }

    return {
      claimedDone: parsed.claimedDone,
      selfDebugCalls: parsed.selfDebugCalls,
      tokens: parsed.tokens ?? undefined,
    };
  }
}
