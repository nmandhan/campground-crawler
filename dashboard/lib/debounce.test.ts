import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from './debounce';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('debounce: three calls within the delay invoke fn once, with the last call\'s arguments', async () => {
  const calls: number[] = [];
  const debounced = debounce((n: number) => calls.push(n), 20);

  debounced(1);
  debounced(2);
  debounced(3);

  await wait(60);

  assert.deepEqual(calls, [3]);
});

test('debounce: calling again after the timer already fired invokes fn twice', async () => {
  const calls: number[] = [];
  const debounced = debounce((n: number) => calls.push(n), 20);

  debounced(1);
  await wait(60);
  debounced(2);
  await wait(60);

  assert.deepEqual(calls, [1, 2]);
});

test('debounce: calling .cancel() before the delay elapses means fn is never invoked', async () => {
  const calls: number[] = [];
  const debounced = debounce((n: number) => calls.push(n), 20);

  debounced(1);
  debounced.cancel();

  await wait(60);

  assert.deepEqual(calls, []);
});

test('debounce: delay 0 still defers to a later turn (does not invoke synchronously)', async () => {
  const calls: number[] = [];
  const debounced = debounce((n: number) => calls.push(n), 0);

  debounced(1);
  assert.deepEqual(calls, []);

  await wait(20);

  assert.deepEqual(calls, [1]);
});
