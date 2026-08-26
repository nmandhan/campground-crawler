/** Notification delivery (NOTF-01/NOTF-02). Formatting is pure and unit-testable;
 *  the Resend call is injectable via `sendImpl` so tests never touch the network.
 *
 *  This module is the designated wiring point for notification credentials — it is
 *  the ONLY place that may read RESEND_API_KEY / NOTIFY_EMAIL / NOTIFY_FROM. It MUST
 *  NEVER include the API key in any log line or error string (threat T-02-01).
 */
import { Resend } from 'resend';
import type { MatchedSlot } from '../types.js';
import { describeFailure } from '../errors.js';

const MAX_FIELD_LENGTH = 200;

/** Collapse CR/LF and runs of whitespace, trim, and truncate. Prevents a hostile or
 *  malformed upstream field from injecting extra lines into the subject (email header
 *  injection) or forging structure in the plain-text body (threat T-02-02).
 */
function sanitize(value: string): string {
  const flat = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return flat.length > MAX_FIELD_LENGTH ? `${flat.slice(0, MAX_FIELD_LENGTH)}…` : flat;
}

/** Only Recreation.gov campsite links are emitted; anything else is dropped rather
 *  than pasted into the user's inbox (threat T-02-03, link spoofing). */
function safeBookingUrl(url: string): string | null {
  return typeof url === 'string' && url.startsWith('https://www.recreation.gov/') ? url : null;
}

export function buildSubject(matches: MatchedSlot[]): string {
  const count = matches.length;
  const noun = count === 1 ? 'campsite' : 'campsites';
  const parks = [...new Set(matches.map((m) => sanitize(m.facilityName)).filter((n) => n.length > 0))];
  const head = `${count} new ${noun} available`;
  return parks.length === 0 ? head : `${head}: ${parks.join(', ')}`;
}

export function buildBody(matches: MatchedSlot[]): string {
  const count = matches.length;
  const noun = count === 1 ? 'campsite' : 'campsites';
  if (count === 0) {
    return `${count} new ${noun} available.`;
  }

  const groups = new Map<
    string,
    { facilityName: string; facilityType: 'standard' | 'group'; watchId: string; matches: MatchedSlot[] }
  >();
  for (const m of matches) {
    const key = `${m.watchId} ${m.facilityName}`;
    let group = groups.get(key);
    if (!group) {
      group = { facilityName: m.facilityName, facilityType: m.facilityType, watchId: m.watchId, matches: [] };
      groups.set(key, group);
    }
    group.matches.push(m);
  }

  const groupBlocks: string[] = [];
  for (const group of groups.values()) {
    // D-05: the user's real use case is 1-2 tent sites. A group campground must never
    // be mistakable for one, so it is flagged in the section header, not buried.
    const groupTag = group.facilityType === 'group' ? ' [GROUP]' : '';
    const lines: string[] = [`${sanitize(group.facilityName)}${groupTag} — watch "${sanitize(group.watchId)}"`];
    for (const m of group.matches) {
      const loop = sanitize(m.loop);
      const loopPart = loop.length > 0 ? ` (Loop ${loop})` : '';
      lines.push(
        `  Site ${sanitize(m.siteLabel)}${loopPart}: ${sanitize(m.startDate)} to ${sanitize(m.endDate)} (checkout)`
      );
      const safeUrl = safeBookingUrl(m.bookingUrl);
      lines.push(`  ${safeUrl ?? '(booking link unavailable)'}`);
    }
    groupBlocks.push(lines.join('\n'));
  }

  const header = `${count} new ${noun} available.`;
  const footer = 'Dates are nights; the checkout date is not a night. Book at the link above.';
  return [header, ...groupBlocks, footer].join('\n\n');
}

export const DEFAULT_FROM = 'Campground Crawler <onboarding@resend.dev>';

export interface EmailLogger {
  info(msg: string): void;
  error(msg: string): void;
}

export interface EmailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

export interface SendResult {
  error: { name: string; message: string } | null;
}

export interface SendDigestOptions {
  apiKey?: string; // default: process.env.RESEND_API_KEY
  to?: string; // default: process.env.NOTIFY_EMAIL
  from?: string; // default: process.env.NOTIFY_FROM ?? DEFAULT_FROM
  logger?: EmailLogger; // default: console
  sendImpl?: (payload: EmailPayload) => Promise<SendResult>; // default: real Resend call
}

export async function sendDigestEmail(matches: MatchedSlot[], opts?: SendDigestOptions): Promise<void> {
  if (matches.length === 0) return;

  const logger = opts?.logger ?? console;

  const apiKey = opts?.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.error('email not sent: RESEND_API_KEY is not set');
    return;
  }

  const to = opts?.to ?? process.env.NOTIFY_EMAIL;
  if (!to) {
    logger.error('email not sent: NOTIFY_EMAIL is not set');
    return;
  }

  const from = opts?.from ?? process.env.NOTIFY_FROM ?? DEFAULT_FROM;

  const sendImpl =
    opts?.sendImpl ??
    ((payload: EmailPayload) => new Resend(apiKey).emails.send(payload) as Promise<SendResult>);

  const payload: EmailPayload = { from, to: [to], subject: buildSubject(matches), text: buildBody(matches) };

  try {
    const { error } = await sendImpl(payload);
    if (error) {
      logger.error(`email send failed: ${error.name}: ${error.message}`);
      return;
    }
  } catch (err) {
    logger.error(`email send failed: ${describeFailure(err)}`);
    return;
  }
  logger.info(`email sent: ${matches.length} new match${matches.length === 1 ? '' : 'es'}`);
}
