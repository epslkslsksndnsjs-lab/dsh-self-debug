import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectProfile } from './profiles.ts';
import { runPipeline } from './runner.ts';
import { renderReport, renderUnknown } from './reporter.ts';

export interface SelfDebugOptions {
  /** Project root to verify. Defaults to the current working directory. */
  directory?: string;
}

/**
 * Top-level, framework-free entry point. Detects the project type from marker
 * files, runs the matching verification pipeline, and returns a deterministic
 * pure-text report. An unrecognized project yields the honest cannot-identify
 * response — never a guessed pipeline.
 */
export async function selfDebug(options: SelfDebugOptions = {}): Promise<string> {
  const directory = resolve(options.directory ?? process.cwd());

  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return renderUnknown(directory);
  }

  const profile = detectProfile(directory);
  if (!profile) {
    return renderUnknown(directory);
  }

  const results = await runPipeline(profile, { cwd: directory });
  return renderReport({ profile, results, directory });
}
