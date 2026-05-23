/** Renders a compact summary of the agent's evaluation configuration. */
import type { EvalsSummary } from '../../src/model/types';
import { el } from '../util';

export function renderEvals(evals: EvalsSummary): HTMLElement {
  const container = el('div', { class: 'evals-panel' });

  if (evals.evaluators.length === 0 && evals.sets.length === 0) {
    container.append(el('p', { class: 'muted-note', text: 'No evaluations configured.' }));
    return container;
  }

  if (evals.sets.length > 0) {
    container.append(el('div', { class: 'evals-subhead', text: 'Evaluation sets' }));
    for (const set of evals.sets) {
      const cases = `${set.testCaseCount} test case${set.testCaseCount === 1 ? '' : 's'}`;
      const evaluators = `${set.evaluatorCount} evaluator${set.evaluatorCount === 1 ? '' : 's'}`;
      container.append(
        el('div', { class: 'evals-item' }, [
          el('span', { class: 'evals-name', text: set.name }),
          el('span', { class: 'evals-meta', text: `${cases} · ${evaluators}` })
        ])
      );
    }
  }

  if (evals.evaluators.length > 0) {
    container.append(el('div', { class: 'evals-subhead', text: 'Evaluators' }));
    for (const evaluator of evals.evaluators) {
      container.append(
        el('div', { class: 'evals-item' }, [
          el('span', { class: 'evals-name', text: evaluator.name }),
          el('span', { class: 'evals-meta', text: evaluator.typeLabel })
        ])
      );
    }
  }

  return container;
}
