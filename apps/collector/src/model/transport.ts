import { ModelError, type ModelTarget } from './client.ts';

/**
 * One question, one JSON answer, shaped by `schema`.
 *
 * The schema is handed to the server rather than described in the prompt, so the answer is
 * constrained as it is generated: a small model asked nicely for JSON returns prose around
 * it often enough to matter, and a grammar removes the whole class of failure.
 *
 * Temperature zero because this is extraction. The same listing must read the same way
 * twice, or a reread would quietly move flats between tiers.
 */
export async function askForJson(
  target: ModelTarget,
  system: string,
  user: string,
  schema: unknown,
): Promise<unknown> {
  const content =
    target.transport === 'ollama'
      ? await askOllama(target, system, user, schema)
      : await askOpenAiCompatible(target, system, user, schema);

  try {
    return JSON.parse(content) as unknown;
  } catch {
    // Reported rather than repaired: a model that stopped honouring the schema is a
    // problem with the model or the prompt, and patching the string here would hide it.
    throw new ModelError(`The model returned something that is not JSON: ${content.slice(0, 200)}`);
  }
}

/** A complete answer is under a hundred tokens, so a run that reaches this has gone wrong. */
const MAX_ANSWER_TOKENS = 300;

/**
 * The same cap for a hosted model, but far higher.
 *
 * Reasoning models spend tokens deliberating before the answer and the API counts those
 * against `max_tokens`, so a cap sized for the answer alone truncates the JSON mid-object
 * and the server rejects its own output with "Failed to generate JSON". Ollama has a
 * switch for this and every provider spells it differently - Groq wants "low" for
 * gpt-oss and "none" for qwen, and rejects the other - so the portable answer is to leave
 * the switch alone and give the deliberation room.
 */
const MAX_HOSTED_TOKENS = 2_000;

async function askOllama(
  target: ModelTarget,
  system: string,
  user: string,
  schema: unknown,
): Promise<string> {
  const response = await fetch(`${target.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(target.timeoutMs ?? 180_000),
    body: JSON.stringify({
      model: target.model,
      stream: false,
      // A reasoning model left to reason writes a few thousand tokens of deliberation
      // before its answer, and Ollama does not count those in `eval_count`, so the symptom
      // is an eighty token answer that took ninety seconds. Models without a thinking mode
      // ignore this.
      think: false,
      format: schema,
      options: { temperature: 0, num_ctx: 4_096, num_predict: MAX_ANSWER_TOKENS },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    throw new ModelError(
      `Ollama answered ${String(response.status)}: ${(await response.text()).slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as { message?: { content?: unknown } };
  const content = body.message?.content;
  if (typeof content !== 'string') throw new ModelError('Ollama returned no message content.');

  return content;
}

/** How many times a rate limited request is worth repeating before the listing is skipped. */
const RATE_LIMIT_RETRIES = 3;
/** When the server does not say how long to wait. */
const FALLBACK_BACKOFF_MS = 20_000;

/**
 * Past this the wait is not a queue any more, it is a spent allowance. A per minute limit
 * is answered with seconds; a per day one with hours. Rounds now run ten minutes apart, so
 * honouring a two hour Retry-After would hold up not this listing but every round behind
 * it. Over the ceiling the reading gives up for the round instead, and the listings are
 * priced by the rules alone, which is what happens when no model is configured at all.
 */
const MAX_BACKOFF_MS = 90_000;

/** How long to wait, or null when the server is asking for longer than a round can give. */
function backoffMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null) return FALLBACK_BACKOFF_MS;

  // Seconds, per the spec. A date is legal too and not worth parsing for this.
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return FALLBACK_BACKOFF_MS;

  const requested = seconds * 1_000;
  return requested > MAX_BACKOFF_MS ? null : requested;
}

async function askOpenAiCompatible(
  target: ModelTarget,
  system: string,
  user: string,
  schema: unknown,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.apiKey ?? ''}`,
      },
      signal: AbortSignal.timeout(target.timeoutMs ?? 60_000),
      body: JSON.stringify({
        model: target.model,
        temperature: 0,
        max_tokens: MAX_HOSTED_TOKENS,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'cost_reading', strict: true, schema },
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    // The one status worth waiting out. A free tier is a queue, not a refusal, and the
    // whole point of running this in the round is that it finishes without supervision.
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = backoffMs(response);
      if (wait === null) {
        throw new ModelError(
          `The model API is rate limited for another ${response.headers.get('retry-after') ?? '?'} ` +
            'second(s), which is longer than a round waits.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    if (!response.ok) {
      throw new ModelError(
        `The model API answered ${String(response.status)}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ModelError('The model API returned no content.');

    return content;
  }
}

/**
 * Says whether the model is reachable, so a long command fails in a second rather than at
 * the end of it. Only Ollama can be asked: an API key is checked by using it.
 */
export async function assertModelAvailable(target: ModelTarget): Promise<void> {
  if (target.transport !== 'ollama') return;

  let names: string[];
  try {
    const response = await fetch(`${target.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new ModelError(`Ollama answered ${String(response.status)} at ${target.baseUrl}.`);
    }

    const body: unknown = await response.json();
    const models = (body as { models?: { name?: unknown }[] }).models ?? [];
    names = models.map((entry) => String(entry.name));
  } catch (cause) {
    if (cause instanceof ModelError) throw cause;
    throw new ModelError(
      `No model server at ${target.baseUrl}. Start one with "ollama serve" (${String(cause)}).`,
    );
  }

  // Ollama stores "qwen3:4b" and answers to it, but a tag typed without ":latest" is a
  // different string to this comparison and would look missing when it is not.
  const known = names.some((name) => name === target.model || name === `${target.model}:latest`);
  if (!known) {
    throw new ModelError(
      `${target.baseUrl} has no model "${target.model}". Pull it: ollama pull ${target.model}.`,
    );
  }
}
