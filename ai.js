
'use strict';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function getApiKeys() {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
  ].filter(Boolean);
}

async function generateText(prompt) {
  const keys = getApiKeys();
  if (!keys.length) throw new Error('No Gemini API key is configured.');

  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(MODEL) + ':generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': keys[i],
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{
                text: 'You are The Cottage★ SMP Discord assistant. Summarize Discord conversations accurately and neutrally. Do not invent details. Focus on decisions, questions, useful information, unresolved points, and notable context. Keep the result concise and easy to scan.',
              }],
            },
            contents: [{
              role: 'user',
              parts: [{ text: prompt }],
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 900,
            },
          }),
          signal: AbortSignal.timeout(45000),
        },
      );

      const body = await response.json();

      if (response.ok) {
        const text = body?.candidates?.[0]?.content?.parts
          ?.map(part => part.text || '')
          .join('')
          .trim();

        if (!text) throw new Error('Gemini returned an empty response.');
        return text;
      }

      lastError = new Error(
        'Gemini key ' + (i + 1) + ' failed: ' +
        (body?.error?.message || ('HTTP ' + response.status))
      );

      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Gemini request failed.');
}

module.exports = { generateText };
