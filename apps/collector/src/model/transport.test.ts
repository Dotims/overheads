import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ModelError } from './client.ts';
import { askForJson } from './transport.ts';

/**
 * A rate limited request is waited out, and that is the right answer while the wait is a
 * minute's tokens. It stopped being the right answer when rounds moved ten minutes apart:
 * a spent daily allowance comes back with a Retry-After measured in hours, and sleeping
 * through it would hold up every round behind this one for the rest of the day.
 */

const TARGET = {
  transport: 'openai' as const,
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'openai/gpt-oss-20b',
  apiKey: 'key',
  delayMs: 0,
};

function refuse(retryAfter: string): Response {
  return new Response('{"error":"rate limit"}', {
    status: 429,
    headers: { 'retry-after': retryAfter },
  });
}

test('an hours long Retry-After is refused rather than slept through', async () => {
  const fetching = mock.method(globalThis, 'fetch', () => Promise.resolve(refuse('7200')));
  const started = Date.now();

  await assert.rejects(
    () => askForJson(TARGET, 'system', 'user', {}),
    (error: unknown) =>
      error instanceof ModelError && error.message.includes('rate limited for another'),
  );

  // Asked once and given up on, rather than three retries of two hours each.
  assert.equal(fetching.mock.callCount(), 1);
  assert.ok(Date.now() - started < 1_000, 'the caller was not made to wait');
  fetching.mock.restore();
});

test('a seconds long Retry-After is still waited out', async () => {
  let call = 0;
  const fetching = mock.method(globalThis, 'fetch', () => {
    call++;
    if (call === 1) return Promise.resolve(refuse('0.05'));
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
    );
  });

  assert.deepEqual(await askForJson(TARGET, 'system', 'user', {}), { ok: true });
  assert.equal(fetching.mock.callCount(), 2);
  fetching.mock.restore();
});
