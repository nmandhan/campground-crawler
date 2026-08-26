import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionCookieOptions, hasValidSession } from './session';

test('SESSION_COOKIE is the string "session"', () => {
  assert.equal(SESSION_COOKIE, 'session');
});

test('SESSION_MAX_AGE_SECONDS equals 60 * 60 * 24 * 30 (2592000)', () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 2592000);
});

test('sessionCookieOptions returns the expected cookie option set', () => {
  assert.deepEqual(sessionCookieOptions(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 2592000,
    path: '/',
  });
});

test('hasValidSession(undefined) returns false', () => {
  assert.equal(hasValidSession(undefined, 'expected'), false);
});

test('hasValidSession("") returns false', () => {
  assert.equal(hasValidSession('', 'expected'), false);
});

test('hasValidSession("wrong", "expected") returns false', () => {
  assert.equal(hasValidSession('wrong', 'expected'), false);
});

test('hasValidSession("expected", "expected") returns true', () => {
  assert.equal(hasValidSession('expected', 'expected'), true);
});

test('hasValidSession("anything", undefined) returns false — fail closed on unset secret', () => {
  assert.equal(hasValidSession('anything', undefined), false);
});

test('hasValidSession("anything", "") returns false — fail closed on empty-string secret', () => {
  assert.equal(hasValidSession('anything', ''), false);
});
