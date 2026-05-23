import { describe, expect, it } from 'vitest';
import { isTriggerTypeId, triggerDisplayLabel } from '../../webview/renderers/bpmn/triggerLabels';

describe('isTriggerTypeId', () => {
  it('matches namespaced UiPath trigger type ids', () => {
    expect(isTriggerTypeId('core.trigger.manual')).toBe(true);
    expect(isTriggerTypeId('core.trigger.timer')).toBe(true);
    expect(isTriggerTypeId('core.trigger.queueItem')).toBe(true);
  });

  it('rejects human-entered element names', () => {
    expect(isTriggerTypeId('Process invoice')).toBe(false);
    expect(isTriggerTypeId('Approved?')).toBe(false);
    expect(isTriggerTypeId('Yes')).toBe(false);
    expect(isTriggerTypeId('Manual trigger')).toBe(false);
    expect(isTriggerTypeId('')).toBe(false);
    expect(isTriggerTypeId('core.task.manual')).toBe(false);
  });
});

describe('triggerDisplayLabel', () => {
  it('translates a trigger type id to a friendly label', () => {
    expect(triggerDisplayLabel('core.trigger.manual')).toBe('Manual trigger');
  });

  it('humanizes camelCase trigger kinds generically', () => {
    expect(triggerDisplayLabel('core.trigger.queueItem')).toBe('Queue Item trigger');
    expect(triggerDisplayLabel('core.trigger.timer')).toBe('Timer trigger');
  });

  it('leaves human-entered names unchanged', () => {
    expect(triggerDisplayLabel('Process invoice')).toBe('Process invoice');
    expect(triggerDisplayLabel('Approved?')).toBe('Approved?');
    expect(triggerDisplayLabel('Yes')).toBe('Yes');
    expect(triggerDisplayLabel('')).toBe('');
  });
});
