import { describe, expect, it } from 'vitest';
import {
  effectiveCollapsed,
  toggleId
} from '../../webview/renderers/codedWorkflow/collapsePolicy';

const none: ReadonlySet<string> = new Set();

describe('effectiveCollapsed', () => {
  it('chips default to collapsed', () => {
    expect(effectiveCollapsed('chip-1', 'chip', false, none)).toBe(true);
    // A chip's collapsedByDefault input is ignored — chips are always
    // default-collapsed regardless of what the host computed.
    expect(effectiveCollapsed('chip-1', 'chip', true, none)).toBe(true);
  });

  it('containers follow the host-computed collapsedByDefault', () => {
    expect(effectiveCollapsed('ct-1', 'container', false, none)).toBe(false);
    expect(effectiveCollapsed('ct-1', 'container', true, none)).toBe(true);
  });

  it('a toggled id inverts its default', () => {
    const toggled: ReadonlySet<string> = new Set(['chip-1', 'ct-open', 'ct-closed']);
    // Chip default collapsed → toggled means expanded.
    expect(effectiveCollapsed('chip-1', 'chip', false, toggled)).toBe(false);
    // Container default expanded → toggled means collapsed.
    expect(effectiveCollapsed('ct-open', 'container', false, toggled)).toBe(true);
    // Container default collapsed → toggled means expanded.
    expect(effectiveCollapsed('ct-closed', 'container', true, toggled)).toBe(false);
  });

  it('unknown / untoggled ids follow their defaults', () => {
    const toggled: ReadonlySet<string> = new Set(['some-other-id']);
    expect(effectiveCollapsed('chip-9', 'chip', false, toggled)).toBe(true);
    expect(effectiveCollapsed('ct-9', 'container', false, toggled)).toBe(false);
    expect(effectiveCollapsed('ct-10', 'container', true, toggled)).toBe(true);
  });

  it('a host default recomputation does not fight an untouched node', () => {
    // Same node, same (empty) toggle set: the host flipping the default is
    // reflected directly because the delta set carries no opinion.
    expect(effectiveCollapsed('ct-1', 'container', false, none)).toBe(false);
    expect(effectiveCollapsed('ct-1', 'container', true, none)).toBe(true);
  });
});

describe('toggleId', () => {
  it('adds an absent id', () => {
    const set = new Set<string>();
    toggleId(set, 'a');
    expect(set.has('a')).toBe(true);
  });

  it('removes a present id (double toggle restores the default)', () => {
    const set = new Set<string>(['a']);
    toggleId(set, 'a');
    expect(set.has('a')).toBe(false);
    expect(effectiveCollapsed('a', 'chip', false, set)).toBe(true);
  });

  it('leaves unrelated ids alone', () => {
    const set = new Set<string>(['a', 'b']);
    toggleId(set, 'c');
    expect([...set].sort()).toEqual(['a', 'b', 'c']);
    toggleId(set, 'b');
    expect([...set].sort()).toEqual(['a', 'c']);
  });
});
