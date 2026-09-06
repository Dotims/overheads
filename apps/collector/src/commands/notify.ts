import type { Sql } from '../db/client.ts';
import type { NotifyFilters } from '../domain/notify-filters.ts';
import { listOffersToNotify, markEverythingNotified, markNotified } from '../db/notifications.ts';
import { sendOffer, type TelegramCredentials } from '../notify/telegram.ts';
import { sleep } from '../sources/http.ts';

/**
 * How many messages one round may send. Roughly thirty listings a day reach the top tier,
 * so a normal round has one or two to report and this is never reached. It is here for the
 * abnormal round: a change that makes hundreds of stored listings eligible at once should
 * arrive as a trickle the owner can stop, not as a night of buzzing.
 *
 * Four rather than the twelve this was while rounds were half an hour apart. The number
 * that matters is the ceiling per hour, and moving to a round every ten minutes turned
 * twelve a round from twenty four an hour into seventy two without anybody deciding that.
 * On 2026-09-06 four districts were unhidden and the notifier worked through twelve days
 * of stored listings in those districts at that rate: sixty messages between 00:42 and
 * 01:25. `notify:seed` is what should have been run alongside the widening, and this is
 * what keeps the mistake to a nuisance rather than a night of it.
 */
const PER_ROUND = 4;

/** Telegram tolerates about one message a second to the same chat. */
const BETWEEN_MESSAGES_MS = 1_200;

/**
 * Announces the listings in budget that have not been announced yet.
 *
 * A send that fails takes the round down with it rather than being logged and stepped
 * over. The listing stays unrecorded either way, so the next round picks it up again;
 * failing loudly is what makes a wrong token or a blocked bot visible on the first round
 * instead of on the day a flat is missed.
 */
export async function notifyNewOffers(
  sql: Sql,
  credentials: TelegramCredentials,
  filters: NotifyFilters,
): Promise<number> {
  const offers = await listOffersToNotify(sql, PER_ROUND, filters);
  let sent = 0;

  for (const offer of offers) {
    if (sent > 0) await sleep(BETWEEN_MESSAGES_MS);

    await sendOffer(credentials, offer);
    // Only now: a message Telegram never accepted must not count as delivered.
    await markNotified(sql, offer.id);
    sent += 1;
  }

  return sent;
}

/**
 * Run once, when the bot is first connected. Everything currently in budget is recorded as
 * announced without a message being sent, so the notifier starts from today rather than
 * replaying a week of collecting into a phone.
 */
export async function seedNotifications(sql: Sql): Promise<number> {
  return markEverythingNotified(sql);
}
