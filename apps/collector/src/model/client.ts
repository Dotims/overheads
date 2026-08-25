/**
 * Which model answers, and how it is reached.
 *
 * Two transports, one question. Ollama runs on the owner's machine with no quota and no
 * key, which is what a backfill of thousands of listings needs; an OpenAI-compatible API
 * runs in the collection round, where there is no graphics card and only a handful of new
 * listings to read. Neither is the "real" one: they read the same prompt into the same
 * shape, and `read-cost.ts` cannot tell them apart.
 *
 * OpenAI-compatible rather than one vendor's client, because the free tiers this leans on
 * come and go. Groq, Cerebras and OpenRouter all speak it, so moving is a base URL.
 */

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface ModelTarget {
  /** Where the request goes. Ollama's own API differs enough to need its own branch. */
  transport: 'ollama' | 'openai';
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  /**
   * Between requests. Free tiers cap tokens per minute long before requests per minute,
   * and one prompt here is over a thousand tokens, so a round that fired as fast as it
   * could would spend most of its time being told to wait.
   */
  delayMs: number;
}

const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

/**
 * Generous: the first call to a local model pays for reading it off the disk into the
 * card, which on a six gigabyte card is tens of seconds. Later calls take seconds.
 */
const OLLAMA_TIMEOUT_MS = 180_000;

/** A hosted model has nothing to load, so a minute here means something is wrong. */
const OPENAI_TIMEOUT_MS = 60_000;

/** Local has no quota to respect, so it goes as fast as the card allows. */
const OLLAMA_DELAY_MS = 0;
/** Twelve seconds is five requests a minute, under a 6000 token-per-minute free tier. */
const OPENAI_DELAY_MS = 12_000;

/**
 * The model this machine is configured to use, or null when there is none.
 *
 * Null rather than an error: the collection round asks for one and must carry on without
 * it, exactly as it carries on with no Telegram bot configured. A listing with no reading
 * is priced by the rules alone, which is the behaviour this project had before any model
 * was involved.
 */
export function modelTarget(env: NodeJS.ProcessEnv = process.env): ModelTarget | null {
  const apiKey = env['LLM_API_KEY'];
  const baseUrl = env['LLM_BASE_URL'];
  const cloudModel = env['LLM_MODEL'];

  if (apiKey !== undefined && apiKey !== '' && baseUrl !== undefined && cloudModel !== undefined) {
    return {
      transport: 'openai',
      baseUrl: baseUrl.replace(/\/$/, ''),
      model: cloudModel,
      apiKey,
      timeoutMs: OPENAI_TIMEOUT_MS,
      delayMs: readDelay(env, OPENAI_DELAY_MS),
    };
  }

  const localModel = env['OLLAMA_MODEL'];
  if (localModel === undefined || localModel === '') return null;

  return {
    transport: 'ollama',
    baseUrl: (env['OLLAMA_HOST'] ?? OLLAMA_DEFAULT_URL).replace(/\/$/, ''),
    model: localModel,
    timeoutMs: OLLAMA_TIMEOUT_MS,
    delayMs: readDelay(env, OLLAMA_DELAY_MS),
  };
}

function readDelay(env: NodeJS.ProcessEnv, fallback: number): number {
  const raw = env['LLM_DELAY_MS'];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** For logs and error messages. The key is never part of it. */
export function describeTarget(target: ModelTarget): string {
  return target.transport === 'ollama'
    ? `${target.model} on ${target.baseUrl}`
    : `${target.model} via ${new URL(target.baseUrl).host}`;
}
