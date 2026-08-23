import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubject, buildBody, sendDigestEmail, DEFAULT_FROM } from './email.js';
import type { MatchedSlot } from '../types.js';
import type { EmailPayload, SendResult, EmailLogger } from './email.js';

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

function recordingLogger(): { logger: EmailLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    logger: {
      info: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    },
    lines,
  };
}

function recordingSend(result: SendResult = { error: null }) {
  const calls: EmailPayload[] = [];
  return { calls, sendImpl: async (p: EmailPayload) => { calls.push(p); return result; } };
}

test('sendDigestEmail: no matches -> sendImpl not called, no error logged', async () => {
  const { logger, lines } = recordingLogger();
  const { calls, sendImpl } = recordingSend();
  await sendDigestEmail([], { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl });
  assert.equal(calls.length, 0);
  assert.equal(lines.length, 0);
});

test('sendDigestEmail: success -> sendImpl called once with expected payload', async () => {
  const { logger } = recordingLogger();
  const { calls, sendImpl } = recordingSend();
  const matches = [matched()];
  await sendDigestEmail(matches, { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    from: DEFAULT_FROM,
    to: ['user@example.test'],
    subject: buildSubject(matches),
    text: buildBody(matches),
  });
});

test('sendDigestEmail: resend API error -> resolves, logs error', async () => {
  const { logger, lines } = recordingLogger();
  const { sendImpl } = recordingSend({ error: { name: 'validation_error', message: 'bad from' } });
  await sendDigestEmail([matched()], { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes('email send failed'));
  assert.ok(lines[0]?.includes('validation_error'));
});

test('sendDigestEmail: sendImpl throws -> resolves, logs error', async () => {
  const { logger, lines } = recordingLogger();
  const sendImpl = async () => {
    throw new Error('socket hang up');
  };
  await sendDigestEmail([matched()], { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes('email send failed'));
});

test('sendDigestEmail: missing apiKey -> sendImpl not called, logs RESEND_API_KEY error', async () => {
  const { logger, lines } = recordingLogger();
  const { calls, sendImpl } = recordingSend();
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    await sendDigestEmail([matched()], { to: 'user@example.test', logger, sendImpl });
  } finally {
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
  }
  assert.equal(calls.length, 0);
  assert.ok(lines.some((l) => l.includes('RESEND_API_KEY is not set')));
});

test('sendDigestEmail: missing recipient -> sendImpl not called, logs NOTIFY_EMAIL error', async () => {
  const { logger, lines } = recordingLogger();
  const { calls, sendImpl } = recordingSend();
  const prev = process.env.NOTIFY_EMAIL;
  delete process.env.NOTIFY_EMAIL;
  try {
    await sendDigestEmail([matched()], { apiKey: 're_test_supersecret', logger, sendImpl });
  } finally {
    if (prev !== undefined) process.env.NOTIFY_EMAIL = prev;
  }
  assert.equal(calls.length, 0);
  assert.ok(lines.some((l) => l.includes('NOTIFY_EMAIL is not set')));
});

test('sendDigestEmail: from omitted -> payload.from equals DEFAULT_FROM', async () => {
  const { logger } = recordingLogger();
  const { calls, sendImpl } = recordingSend();
  await sendDigestEmail([matched()], { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl });
  assert.equal(calls[0]?.from, DEFAULT_FROM);
});

test('sendDigestEmail: no log line ever contains the api key value', async () => {
  const { logger, lines } = recordingLogger();
  const { sendImpl } = recordingSend({ error: { name: 'validation_error', message: 'bad from' } });
  await sendDigestEmail([matched()], { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl });
  await sendDigestEmail([matched()], { apiKey: 're_test_supersecret', to: 'user@example.test', logger, sendImpl: async () => {
    throw new Error('socket hang up');
  } });
  for (const line of lines) {
    assert.equal(line.includes('re_test_supersecret'), false);
  }
});
