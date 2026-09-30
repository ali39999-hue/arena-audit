/**
 * Arena Audit — LLM Provider Layer (multi-provider, SSRF-guarded, JSON-safe)
 *
 * All outbound requests go through safeFetch(): http/https only, and
 * localhost / loopback / private / reserved hosts are refused (explicit
 * exception: a user-configured Ollama endpoint).
 */

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|\[?::1\]?|.*\.local$)/i;

export function validateUrl(urlString, { allowLocal = false } = {}) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Forbidden protocol '${parsed.protocol}' — only http/https allowed`);
  }
  if (!allowLocal && PRIVATE_HOST.test(parsed.hostname)) {
    throw new Error(`Refusing private/loopback host: ${parsed.hostname}`);
  }
  return parsed;
}

export async function safeFetch(urlString, options = {}, { allowLocal = false } = {}) {
  validateUrl(urlString, { allowLocal });
  return fetch(urlString, options);
}

export function detectProvider(explicit = null) {
  if (explicit) return explicit.toLowerCase();
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.OLLAMA_HOST) return 'ollama';
  return null;
}

/**
 * Unified chat call. provider/model overridable per call.
 */
export async function callLLM(providerName, systemPrompt, userPrompt, { model = null, maxTokens = 4096 } = {}) {
  const prov = providerName.toLowerCase();

  if (prov === 'anthropic') {
    const resp = await safeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-latest',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    return data.content[0].text;
  }

  if (prov === 'openai' || prov === 'deepseek') {
    const isDeepSeek = prov === 'deepseek';
    const key = isDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
    const url = isDeepSeek
      ? 'https://api.deepseek.com/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const resp = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: model || (isDeepSeek ? 'deepseek-chat' : 'gpt-4o'),
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`${prov} API error: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    return data.choices[0].message.content;
  }

  if (prov === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-pro-latest'}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const resp = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      }),
    });
    if (!resp.ok) throw new Error(`Gemini API error: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
  }

  if (prov === 'ollama') {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const resp = await safeFetch(`${host.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.1',
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }, { allowLocal: true }); // explicit user-configured local inference endpoint
    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    return data.message.content;
  }

  throw new Error(`Unsupported provider: ${providerName}`);
}

/** Parse JSON out of an LLM answer (raw JSON or fenced block). */
export function parseJSONFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) return JSON.parse(m[1]);
    throw new Error('Could not find valid JSON in LLM response');
  }
}
