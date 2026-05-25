// services/ai/openrouter.js

export const MODELS = [
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3 (Cheapest)' },
  { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Best SEO)' },
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini (Fast)' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Low Cost)' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (Balanced)' },
];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function rewriteForEbay(productData, apiKey, model = 'deepseek/deepseek-chat', onChunk = null) {
  if (!apiKey) throw new Error('OpenRouter API key is required');

  const prompt = buildPrompt(productData);

  const body = {
    model,
    max_tokens: 2000,
    stream: !!onChunk,
    messages: [
      {
        role: 'system',
        content: `You are an expert eBay UK SEO listing specialist with 10 years of experience. 
You write compelling, conversion-optimised product listings that rank highly on eBay UK search.
You ALWAYS respond in valid JSON format only — no markdown, no explanation, just raw JSON.`,
      },
      { role: 'user', content: prompt },
    ],
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://uk-listing-optimizer.ext',
      'X-Title': 'UK Listing Optimizer',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  if (onChunk) {
    return await streamResponse(res, onChunk);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseAIResponse(text);
}

async function streamResponse(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content || '';
        fullText += chunk;
        onChunk(chunk);
      } catch (_) {}
    }
  }

  return parseAIResponse(fullText);
}

function buildPrompt(product) {
  const variantDesc = product.variants?.length
    ? `Variants available: ${product.variants.map((v) => `${v.type}: ${v.value}`).join(', ')}`
    : 'No variants';

  return `Rewrite this Amazon UK product into a highly optimised eBay UK listing.

PRODUCT DATA:
Title: ${product.title}
Brand: ${product.brand}
Category: ${product.category}
Current Price: ${product.price?.sale || product.price?.original || 'N/A'}
${variantDesc}
Bullet Points:
${(product.bullets || []).map((b, i) => `${i + 1}. ${b}`).join('\n')}
Description: ${product.description || 'N/A'}

REQUIREMENTS:
1. SEO Title: Under 80 characters, include brand + main keyword + key feature + "UK" if fits. British English.
2. Subtitle: Under 55 characters, secondary keywords
3. eBay Category: Most appropriate eBay UK category name
4. Item Specifics: 8-12 key-value pairs for eBay item specifics
5. Bullet Points: 5 compelling selling points (British English, no Amazon references)
6. HTML Description: Professional HTML description (use <div>, <ul>, <li>, <h2>, <p>, <strong> tags). 300-500 words. Include delivery mention naturally.
7. Search Tags: 8 relevant UK search keywords

Respond ONLY with this exact JSON structure:
{
  "seoTitle": "",
  "subtitle": "",
  "ebayCategory": "",
  "itemSpecifics": {"key": "value"},
  "bulletPoints": ["", "", "", "", ""],
  "htmlDescription": "",
  "searchTags": ["", "", "", "", "", "", "", ""],
  "conditionDescription": ""
}`;
}

function parseAIResponse(text) {
  // Strip markdown fences
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Try to extract JSON from the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {}
    }
    // Return partial fallback
    return {
      seoTitle: text.substring(0, 80),
      subtitle: '',
      ebayCategory: '',
      itemSpecifics: {},
      bulletPoints: [],
      htmlDescription: text,
      searchTags: [],
      conditionDescription: '',
    };
  }
}
