/**
 * C1 regression — serialized edit-queue semantics.
 *
 * The data-loss fix (C1) lives in `src/artifactEditorProvider.ts`, which imports
 * `vscode` and is therefore hard to unit-test directly. Rather than stand up a
 * heavy `@vscode/test-electron` harness, this test proves the *mechanism* the
 * fix relies on: a promise-chain where each async task reads-then-writes a
 * shared value MUST serialize, so no update is lost even when tasks are enqueued
 * faster than they settle.
 *
 * The production code in `artifactEditorProvider.ts` does exactly this:
 *
 *     let editQueue: Promise<void> = Promise.resolve();
 *     webview.onDidReceiveMessage((raw) => {
 *       ...
 *       editQueue = editQueue.then(() => this.handleMessage(...));
 *     });
 *
 * Each `handleMessage` re-reads `document.getText()` (the latest text) before it
 * mutates and applies its WorkspaceEdit. The `editQueue = editQueue.then(...)`
 * chaining guarantees handler N+1 only starts once handler N has fully settled,
 * so every handler observes the result of the one before it. This test mirrors
 * that exact pattern with an in-memory shared value standing in for the
 * document text.
 */
import { describe, expect, it } from 'vitest';

/**
 * An in-memory stand-in for the VS Code TextDocument. `read()` returns the
 * latest value; `write()` replaces it wholesale — exactly the read-then-
 * full-replace shape of an `applyEdit` against a `fullRange`.
 */
class SharedDocument {
  private value = 0;
  read(): number {
    return this.value;
  }
  /** Simulates an async applyEdit that takes a variable, non-zero time. */
  async write(next: number, settleMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    this.value = next;
  }
}

describe('C1 — serialized edit queue prevents lost updates', () => {
  it('serializes read-then-write tasks enqueued faster than they settle', async () => {
    const doc = new SharedDocument();

    // Mirror the production pattern: `editQueue = editQueue.then(...)`.
    let editQueue: Promise<void> = Promise.resolve();

    // Each "edit" reads the current value then writes value+1. The later edits
    // are given SHORTER settle times, so without serialization an earlier,
    // slower write would land last and clobber the increments after it.
    const enqueue = (settleMs: number): void => {
      editQueue = editQueue.then(async () => {
        const current = doc.read(); // re-read the latest value, like getText()
        await doc.write(current + 1, settleMs);
      });
    };

    // Enqueue 10 edits back-to-back within one tick — no awaiting between them.
    enqueue(30);
    enqueue(5);
    enqueue(25);
    enqueue(1);
    enqueue(20);
    enqueue(2);
    enqueue(15);
    enqueue(3);
    enqueue(10);
    enqueue(4);

    await editQueue;

    // If any update were lost, the final value would be < 10. Serialization
    // guarantees every one of the 10 increments is observed.
    expect(doc.read()).toBe(10);
  });

  it('without a queue, concurrent read-then-write tasks lose updates (control)', async () => {
    // Control case: prove the failure mode the queue prevents is real. Firing
    // the same read-then-write tasks WITHOUT chaining lets them all read the
    // same stale 0 and the slowest write wins.
    const doc = new SharedDocument();
    const unqueued: Promise<void>[] = [];
    const fireUnqueued = (settleMs: number): void => {
      unqueued.push(
        (async () => {
          const current = doc.read();
          await doc.write(current + 1, settleMs);
        })()
      );
    };
    for (let i = 0; i < 10; i++) {
      fireUnqueued(5);
    }
    await Promise.all(unqueued);

    // All 10 read 0 concurrently and each writes 1 — 9 updates are lost.
    expect(doc.read()).toBeLessThan(10);
  });

  it('preserves enqueue order — handler N+1 sees handler N\'s result', async () => {
    const doc = new SharedDocument();
    const observed: number[] = [];
    let editQueue: Promise<void> = Promise.resolve();

    for (let i = 1; i <= 5; i++) {
      editQueue = editQueue.then(async () => {
        observed.push(doc.read()); // the value handler i starts from
        await doc.write(i, 5);
      });
    }
    await editQueue;

    // Each handler must observe the value the previous handler wrote.
    expect(observed).toEqual([0, 1, 2, 3, 4]);
    expect(doc.read()).toBe(5);
  });
});
