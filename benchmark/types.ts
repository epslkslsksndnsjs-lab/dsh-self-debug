// Benchmark harness types (T8, issue #9).
//
// The harness is language-agnostic and driver-agnostic. A task is a uniform
// bundle of a buggy scaffold, hash-guarded acceptance-test files, an
// independent acceptance command the harness runs itself, and (for offline
// verification) a canonical solution the scripted driver applies. Two arms
// compete on the same task: "plugin" (self_debug tool available) vs "plain"
// (no tool). Both arms get the SAME in-session repair budget N=3 rounds.

export type Arm = 'plugin' | 'plain';

export type TaskLanguage = 'node' | 'python' | 'go';

/** A committed benchmark task (uniform shape — see benchmark/tasks/README.md). */
export interface BenchmarkTask {
  /** Stable, unique id used in records and reports. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Project language / ecosystem style. */
  language: TaskLanguage;
  /** The prompt handed to the agent (what it is asked to do). */
  prompt: string;
  /**
   * Workspace scaffold: relative file path -> file content. This is the BUGGY
   * starting state the agent must repair. Copied verbatim into a temp workspace.
   */
  scaffold: Record<string, string>;
  /**
   * Relative paths (within the workspace) of the acceptance-test file(s). These
   * are hashed before the task starts and re-hashed at verdict time; ANY
   * modification (e.g. an agent editing the test to cheat) forces task failure
   * through the hash guard, independent of the acceptance exit code.
   */
  acceptanceFiles: string[];
  /**
   * Shell command the harness runs ITSELF, outside the agent session, to judge
   * the task. Exit code 0 == pass. This is the independent verdict path; the
   * agent's own "done" claim is never trusted.
   */
  acceptanceCommand: string;
  /** Human-readable description of expected-pass behaviour (documentation). */
  expectedPass: string;
  /**
   * Canonical corrected file contents, keyed like `scaffold`. Used ONLY by the
   * offline scripted driver to demonstrate repair; the real dsh model driver
   * (T9) does NOT read this — it must find the fix itself.
   */
  solution: Record<string, string>;
  /**
   * True when this task's acceptance command can run in the current offline
   * environment (no missing toolchain). Go tasks are false here and execute at
   * T9 where the go toolchain exists (the verdict path is language-agnostic).
   */
  offlineRunnable?: boolean;
}

/**
 * Context handed to a driver for each in-session repair round. The harness
 * owns the two observation hooks so call-rate accounting is centralised and
 * cannot be mis-reported by a driver.
 */
export interface DriverContext {
  arm: Arm;
  task: BenchmarkTask;
  /** Temp workspace directory (scaffold already copied in). */
  workspace: string;
  /** 1-based round number. */
  round: number;
  /** Max repair rounds (N=3 for both arms). */
  maxRounds: number;
  /**
   * The self_debug tool entry point. NON-NULL only when this arm has the
   * plugin. Every call is counted by the harness for call-rate measurement.
   */
  callSelfDebug: (() => Promise<string>) | null;
  /**
   * Mark an "about to claim done" moment. `calledSelfDebug` records whether
   * self_debug was invoked on that eligible turn. The harness increments the
   * eligible-turn counter here.
   */
  markEligibleTurn: (calledSelfDebug: boolean) => void;
}

export interface DriverRoundResult {
  /** The driver claims the task is complete and will make no more edits. */
  claimedDone: boolean;
  /**
   * Real-agent drivers (the dsh model driver) cannot route self_debug through
   * `ctx.callSelfDebug` — the call happens inside the external dsh session. Such
   * a driver reports the self_debug invocations it observed in the session
   * transcript for this round; the harness aggregates these into TaskRecord.
   * Scripted/offline drivers MUST leave this undefined so the harness's own
   * `ctx.callSelfDebug` counter remains the source of truth (no double count).
   */
  selfDebugCalls?: number;
  /**
   * Real-agent drivers report the round's token usage parsed from the session
   * log (source 'dsh'). The harness sums these across rounds. Offline/scripted
   * drivers leave this undefined (TaskRecord.tokens stays source 'none').
   */
  tokens?: { input: number | null; output: number | null };
}

/** Pluggable agent driver. The scripted driver (offline) and the real dsh
 *  driver (T9) both implement this contract. */
export interface AgentDriver {
  /** Driver name (recorded in the task record). */
  readonly name: string;
  /** Which arm this driver represents. */
  readonly arm: Arm;
  /** Whether this arm's environment exposes the self_debug tool. */
  readonly selfDebugAvailable: boolean;
  /** Execute one repair round. */
  runRound(ctx: DriverContext): Promise<DriverRoundResult>;
}

/** Token accounting. `input`/`output` are null when not obtainable (scripted
 *  driver); the shape is fixed so T9 can populate them from the real model. */
export interface TokenAccount {
  input: number | null;
  output: number | null;
  source: string;
}

export type VerdictReason = 'acceptance' | 'hash_modified';

/** Per-task record captured by the harness for every arm run. */
export interface TaskRecord {
  taskId: string;
  arm: Arm;
  driver: string;
  /**
   * 'run' for a fully executed arm; 'skipped' when the harness did not execute
   * the task (e.g. a go task with no go toolchain present). Skipped records
   * carry a `skipReason` and are excluded from success-rate accounting so the
   * manifest stays honest about what was actually measured.
   */
  status: 'run' | 'skipped';
  /** Set when status === 'skipped'. */
  skipReason?: string;
  /** Rounds actually used (1..maxRounds). */
  roundsUsed: number;
  maxRounds: number;
  /** Whether the driver ever claimed completion. */
  claimedDone: boolean;
  /** "About to claim done" moments observed (plugin arm: call-rate denominator). */
  eligibleTurns: number;
  /** self_debug calls counted in this arm run. */
  selfDebugCalls: number;
  /** selfDebugCalls / eligibleTurns, or null when no eligible turn occurred. */
  callRate: number | null;
  tokens: TokenAccount;
  /** Wall-clock milliseconds for the whole arm run (scaffold -> verdict). */
  wallTimeMs: number;
  /** True if any acceptance-test file changed between start and verdict. */
  hashModified: boolean;
  /** Acceptance-test files that changed (empty when hashModified is false). */
  modifiedFiles: string[];
  verdict: 'pass' | 'fail';
  verdictReason: VerdictReason;
  /** Acceptance command exit code (null when verdict was forced by hash guard). */
  acceptanceExitCode: number | null;
}
