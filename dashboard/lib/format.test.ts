import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime, formatAbsolute, formatDateRange } from './format';

test('formatRelativeTime: 30 seconds ago', () => {
  assert.equal(
    formatRelativeTime('2026-08-23T12:00:00Z', new Date('2026-08-23T12:00:30Z')),
    '30 seconds ago',
  );
});

test('formatRelativeTime: 5 minutes ago', () => {
  assert.equal(
    formatRelativeTime('2026-08-23T12:00:00Z', new Date('2026-08-23T12:05:00Z')),
    '5 minutes ago',
  );
});

test('formatRelativeTime: 1 minute ago (singular)', () => {
  assert.equal(
    formatRelativeTime('2026-08-23T12:00:00Z', new Date('2026-08-23T12:01:00Z')),
    '1 minute ago',
  );
});

test('formatRelativeTime: 2 days ago', () => {
  assert.equal(
    formatRelativeTime('2026-08-23T12:00:00Z', new Date('2026-08-25T12:00:00Z')),
    '2 days ago',
  );
});

test('formatRelativeTime: future timestamp renders "in N minutes"', () => {
  assert.equal(
    formatRelativeTime('2026-08-23T12:05:00Z', new Date('2026-08-23T12:00:00Z')),
    'in 5 minutes',
  );
});

test('formatRelativeTime: unparseable input never throws, returns "unknown"', () => {
  assert.equal(formatRelativeTime('not-a-date', new Date('2026-08-23T12:00:00Z')), 'unknown');
});

test('formatRelativeTime: 1 hour ago', () => {
  assert.equal(
    formatRelativeTime('2026-08-23T11:00:00Z', new Date('2026-08-23T12:00:00Z')),
    '1 hour ago',
  );
});

test('formatAbsolute: returns a stable, non-empty string containing 2026', () => {
  const result = formatAbsolute('2026-08-23T12:00:00Z');
  assert.ok(result.length > 0);
  assert.ok(result.includes('2026'));
});

test('formatAbsolute: unparseable input returns "unknown"', () => {
  assert.equal(formatAbsolute('not-a-date'), 'unknown');
});

test('formatDateRange: same-year range with 2 nights', () => {
  assert.equal(formatDateRange('2026-10-09', '2026-10-11'), 'Oct 9 – Oct 11, 2026 (2 nights)');
});

test('formatDateRange: same-year range with 3 nights', () => {
  assert.equal(formatDateRange('2026-09-04', '2026-09-07'), 'Sep 4 – Sep 7, 2026 (3 nights)');
});

test('formatDateRange: cross-year range renders both years and (3 nights)', () => {
  const result = formatDateRange('2026-12-30', '2027-01-02');
  assert.ok(result.includes('2026'));
  assert.ok(result.includes('2027'));
  assert.ok(result.includes('(3 nights)'));
});

test('formatDateRange: unparseable input returns "unknown dates"', () => {
  assert.equal(formatDateRange('bad', 'worse'), 'unknown dates');
});

test('formatDateRange: single-night range uses singular "night"', () => {
  assert.equal(formatDateRange('2026-10-09', '2026-10-10'), 'Oct 9 – Oct 10, 2026 (1 night)');
});

test('formatDateRange: end <= start returns "unknown dates"', () => {
  assert.equal(formatDateRange('2026-10-11', '2026-10-09'), 'unknown dates');
  assert.equal(formatDateRange('2026-10-09', '2026-10-09'), 'unknown dates');
});
