import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Core is framework-free: profiles are plain data (per ADR-0001, "profiles are
// data, not code"). Pipelines are inherited verbatim from verify-mcp.

export type ProfileId = 'node' | 'python' | 'go';

export interface Command {
  /** Shell command line executed by the runner (via `shell: true`). */
  run: string;
  /** Short label rendered in the report. */
  label: string;
}

export interface Profile {
  id: ProfileId;
  /** Marker file whose presence identifies the project. */
  marker: string;
  /** Human-readable label, e.g. "node". */
  label: string;
  /** Ordered verification pipeline. */
  pipeline: Command[];
}

export const PROFILES: readonly Profile[] = [
  {
    id: 'node',
    marker: 'package.json',
    label: 'node',
    pipeline: [
      { run: 'npm run --if-present lint', label: 'npm run --if-present lint' },
      { run: 'npm run --if-present test', label: 'npm run --if-present test' },
      { run: 'npm run --if-present build', label: 'npm run --if-present build' },
    ],
  },
  {
    id: 'python',
    marker: 'pyproject.toml',
    label: 'python',
    pipeline: [
      { run: 'uv run pytest', label: 'uv run pytest' },
      { run: 'uv run ruff check .', label: 'uv run ruff check .' },
    ],
  },
  {
    id: 'go',
    marker: 'go.mod',
    label: 'go',
    pipeline: [
      { run: 'go build ./...', label: 'go build ./...' },
      { run: 'go test ./... -count=1', label: 'go test ./... -count=1' },
      { run: 'go vet ./...', label: 'go vet ./...' },
    ],
  },
];

/** Detect the project profile for `dir` by marker-file presence. Returns null when unknown. */
export function detectProfile(dir: string): Profile | null {
  for (const profile of PROFILES) {
    if (existsSync(join(dir, profile.marker))) {
      return profile;
    }
  }
  return null;
}
