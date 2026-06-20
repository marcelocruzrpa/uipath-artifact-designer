/**
 * Unit tests for the auto-open decision (`shouldAutoOpenCodedWorkflow`) — the
 * pure rule behind the `autoOpenDesigner` setting.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldAutoOpenCodedWorkflow,
  type AutoOpenDecision
} from '../../../src/model/codedWorkflow/autoOpen';

const base: AutoOpenDecision = {
  scheme: 'file',
  pathLower: '/proj/main.cs',
  enabled: true,
  isWorkflow: true,
  suppressed: false
};

describe('shouldAutoOpenCodedWorkflow', () => {
  it('opens an enabled, on-disk .cs coded workflow', () => {
    expect(shouldAutoOpenCodedWorkflow(base)).toBe(true);
  });

  it('does nothing when the setting is disabled', () => {
    expect(shouldAutoOpenCodedWorkflow({ ...base, enabled: false })).toBe(false);
  });

  it('does nothing for a non-.cs file', () => {
    expect(shouldAutoOpenCodedWorkflow({ ...base, pathLower: '/proj/main.txt' })).toBe(false);
  });

  it('does nothing for a plain C# file (not a coded workflow)', () => {
    expect(shouldAutoOpenCodedWorkflow({ ...base, isWorkflow: false })).toBe(false);
  });

  it('does nothing for a non-file scheme (diff / git / untitled)', () => {
    expect(shouldAutoOpenCodedWorkflow({ ...base, scheme: 'git' })).toBe(false);
    expect(shouldAutoOpenCodedWorkflow({ ...base, scheme: 'untitled' })).toBe(false);
  });

  it('does not bounce a URI the user reopened as text', () => {
    expect(shouldAutoOpenCodedWorkflow({ ...base, suppressed: true })).toBe(false);
  });

  it('matches .cs case-insensitively via the lower-cased path', () => {
    // The host lower-cases the path; an uppercase extension still resolves.
    expect(shouldAutoOpenCodedWorkflow({ ...base, pathLower: '/proj/main.cs' })).toBe(true);
  });
});
