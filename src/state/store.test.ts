import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupKey } from './store.js';
import { HttpError, BlockedError, describeFailure } from '../errors.js';

test('dedupKey builds the expected colon-delimited key', () => {
  assert.equal(
    dedupKey('cascade', '12345', '2026-09-01', '2026-09-04'),
    'cascade:12345:2026-09-01:2026-09-04'
  );
});

test('dedupKey differs for different watchIds on the same site/dates', () => {
  const a = dedupKey('watch-a', '12345', '2026-09-01', '2026-09-04');
  const b = dedupKey('watch-b', '12345', '2026-09-01', '2026-09-04');
  assert.notEqual(a, b);
});

test('dedupKey differs for different date ranges on the same watch/site', () => {
  const a = dedupKey('watch-a', '12345', '2026-09-01', '2026-09-04');
  const b = dedupKey('watch-a', '12345', '2026-10-01', '2026-10-04');
  assert.notEqual(a, b);
});

test('describeFailure includes the status code for HttpError', () => {
  const err = new HttpError('failed', 429, 'https://example.com');
  assert.match(describeFailure(err), /429/);
});

test('describeFailure mentions "blocked" for BlockedError', () => {
  const err = new BlockedError('got html', 'https://example.com');
  assert.match(describeFailure(err), /blocked/);
});

test('describeFailure never throws for a non-Error value', () => {
  assert.doesNotThrow(() => describeFailure('not an error'));
  const result = describeFailure('not an error');
  assert.ok(result.length > 0);
});
