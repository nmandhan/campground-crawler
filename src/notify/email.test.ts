import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubject, buildBody } from './email.js';
import type { MatchedSlot } from '../types.js';

function matched(over: Partial<MatchedSlot> = {}): MatchedSlot {
  return {
    watchId: 'yose',
    campsiteId: '12345',
    siteLabel: '012',
    loop: 'A',
    siteType: 'tent',
    facilityId: 232447,
    facilityName: 'Upper Pines',
    startDate: '2026-09-04',
    endDate: '2026-09-07',
    bookingUrl: 'https://www.recreation.gov/camping/campsites/12345',
    ...over,
  };
}

test('buildSubject: no matches', () => {
  assert.equal(buildSubject([]), '0 new campsites available');
});

test('buildSubject: one match', () => {
  assert.equal(
    buildSubject([matched({ facilityName: 'Upper Pines' })]),
    '1 new campsite available: Upper Pines'
  );
});

test('buildSubject: two matches at different parks', () => {
  assert.equal(
    buildSubject([
      matched({ facilityName: 'Upper Pines' }),
      matched({ facilityName: 'Kirk Creek' }),
    ]),
    '2 new campsites available: Upper Pines, Kirk Creek'
  );
});

test('buildSubject: two matches same park deduped', () => {
  assert.equal(
    buildSubject([
      matched({ facilityName: 'Upper Pines' }),
      matched({ facilityName: 'Upper Pines' }),
    ]),
    '2 new campsites available: Upper Pines'
  );
});

test('buildSubject: newline injection neutralized', () => {
  const subject = buildSubject([matched({ facilityName: 'Upper\nPines' })]);
  assert.ok(subject.includes('Upper Pines'));
  assert.equal(subject.includes('\n'), false);
});

test('buildBody: one match', () => {
  const body = buildBody([matched()]);
  assert.ok(body.includes('Upper Pines — watch "yose"'));
  assert.ok(body.includes('Site 012 (Loop A): 2026-09-04 to 2026-09-07 (checkout)'));
  assert.ok(body.includes('https://www.recreation.gov/camping/campsites/12345'));
});

test('buildBody: empty loop renders no loop fragment', () => {
  const body = buildBody([matched({ loop: '' })]);
  assert.ok(body.includes('Site 012: 2026-09-04 to 2026-09-07 (checkout)'));
  assert.equal(body.includes('(Loop )'), false);
});

test('buildBody: two matches sharing facility+watch grouped under one header', () => {
  const body = buildBody([
    matched({ campsiteId: '12345', siteLabel: '012' }),
    matched({ campsiteId: '12346', siteLabel: '013' }),
  ]);
  const headerMatches = body.match(/— watch "yose"/g) ?? [];
  assert.equal(headerMatches.length, 1);
  const siteMatches = body.match(/^\s*Site /gm) ?? [];
  assert.equal(siteMatches.length, 2);
});

test('buildBody: unsafe booking url renders unavailable line', () => {
  const body = buildBody([matched({ bookingUrl: 'https://evil.example.com/phish' })]);
  assert.ok(body.includes('  (booking link unavailable)'));
  assert.equal(body.includes('evil.example.com'), false);
});

test('buildBody: newline injection in siteLabel neutralized to single line', () => {
  const body = buildBody([matched({ siteLabel: '012\nBcc: attacker@evil.com' })]);
  assert.ok(body.includes('012 Bcc: attacker@evil.com'));
});

test('buildBody: empty matches', () => {
  assert.equal(buildBody([]), '0 new campsites available.');
});
