import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeTarget, modelTarget } from './client.ts';

/**
 * Which model a machine ends up using is decided entirely by its environment, and the two
 * machines this runs on have different ones: a laptop with a graphics card and a CI runner
 * with an API key. Getting the precedence wrong is silent, so it is tested.
 */

const CLOUD = {
  LLM_API_KEY: 'key',
  LLM_BASE_URL: 'https://api.groq.com/openai/v1',
  LLM_MODEL: 'llama-3.3-70b-versatile',
};

test('no model configured is null rather than an error', () => {
  // The collection round asks for one and has to carry on without it.
  assert.equal(modelTarget({}), null);
});

test('an ollama model on its own is used locally', () => {
  const target = modelTarget({ OLLAMA_MODEL: 'qwen3:4b' });
  assert.equal(target?.transport, 'ollama');
  assert.equal(target?.baseUrl, 'http://127.0.0.1:11434');
  // Nothing to queue behind locally, so nothing is waited for.
  assert.equal(target?.delayMs, 0);
});

test('a hosted key wins over a local model, because the round has no graphics card', () => {
  const target = modelTarget({ ...CLOUD, OLLAMA_MODEL: 'qwen3:4b' });
  assert.equal(target?.transport, 'openai');
  assert.equal(target?.model, 'llama-3.3-70b-versatile');
  assert.ok((target?.delayMs ?? 0) > 0, 'a hosted free tier has to be paced');
});

test('a half configured hosted model falls back rather than failing', () => {
  // A blank secret in CI reads as an empty string, not as an absent variable.
  assert.equal(modelTarget({ LLM_API_KEY: '', LLM_BASE_URL: 'x', LLM_MODEL: 'y' }), null);
  assert.equal(modelTarget({ LLM_API_KEY: 'key', OLLAMA_MODEL: 'qwen3:4b' })?.transport, 'ollama');
});

test('a trailing slash on the base url does not become a double slash in the path', () => {
  const target = modelTarget({ ...CLOUD, LLM_BASE_URL: 'https://api.groq.com/openai/v1/' });
  assert.equal(target?.baseUrl, 'https://api.groq.com/openai/v1');
});

test('the delay can be overridden for a tier with different limits', () => {
  assert.equal(modelTarget({ ...CLOUD, LLM_DELAY_MS: '3000' })?.delayMs, 3_000);
  // Nonsense falls back rather than turning into NaN and a hung round.
  assert.ok((modelTarget({ ...CLOUD, LLM_DELAY_MS: 'soon' })?.delayMs ?? 0) > 0);
});

test('describing a target never includes the key', () => {
  const described = describeTarget(modelTarget(CLOUD)!);
  assert.equal(described.includes('key'), false);
  assert.match(described, /api\.groq\.com/);
});
