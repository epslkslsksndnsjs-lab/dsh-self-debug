import { describe, it, expect } from 'vitest';
import { parseTranscript } from '../benchmark/drivers/dsh.ts';

// Fixture transcripts use the ASSUMED dsh session-log grammar documented in
// benchmark/drivers/dsh.ts (TOOL_CALL / CLAIM_DONE / TOKENS lines). These tests
// pin that contract; if the real dsh log grammar differs, both the parser and
// these fixtures must be updated together.

const SAMPLE = [
  'system: session started',
  'TOOL_CALL self_debug',
  'assistant: ran self_debug, found a failing assertion',
  'CLAIM_DONE called_self_debug=true',
  'TOOL_CALL self_debug',
  'TOKENS input=120 output=45',
  'CLAIM_DONE called_self_debug=true',
  'TOKENS input=80 output=30',
].join('\n');

describe('T9 dsh transcript parser', () => {
  it('counts self_debug calls, eligible turns, and tokens from a fixture transcript', () => {
    const a = parseTranscript(SAMPLE);
    expect(a.selfDebugCalls).toBe(2);
    expect(a.claimDoneMoments).toHaveLength(2);
    expect(a.claimDoneMoments.every((m) => m.calledSelfDebug)).toBe(true);
    expect(a.claimedDone).toBe(true);
    // tokens summed across both TOKENS lines: input 200, output 75
    expect(a.tokens).toEqual({ input: 200, output: 75 });
  });

  it('marks eligible turns as not-self-debugged when called_self_debug=false', () => {
    const a = parseTranscript('CLAIM_DONE called_self_debug=false');
    expect(a.claimDoneMoments).toEqual([{ calledSelfDebug: false }]);
    expect(a.selfDebugCalls).toBe(0);
  });

  it('defaults called_self_debug to false when the flag is absent', () => {
    const a = parseTranscript('CLAIM_DONE');
    expect(a.claimDoneMoments).toEqual([{ calledSelfDebug: false }]);
  });

  it('returns null tokens and zero counts for an empty / unrelated transcript', () => {
    const a = parseTranscript('assistant: hello\nuser: fix the bug');
    expect(a.selfDebugCalls).toBe(0);
    expect(a.claimDoneMoments).toHaveLength(0);
    expect(a.claimedDone).toBe(false);
    expect(a.tokens).toBeNull();
  });

  it('is case-insensitive on the tool_call marker', () => {
    const a = parseTranscript('tool_call Self_Debug');
    expect(a.selfDebugCalls).toBe(1);
  });
});
