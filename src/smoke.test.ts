import { test } from 'node:test';
import assert from 'node:assert/strict';

test('typescript test runner executes', () => {
  const typed: number = 1 + 1;
  assert.equal(typed, 2);
});
