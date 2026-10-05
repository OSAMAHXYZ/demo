import { aiConfigured, config } from '../config.js';

export interface RawAction {
  type: string;
  url?: string | null;
  title?: string | null;
  label?: string | null;
  value?: string | null;
  selectors?: Record<string, string>;
}

export interface DraftStep {
  type: string;
  label: string;
  url?: string;
  value?: string;
  selectors?: Record<string, string>;
  timeoutMs?: number;
}

export interface Analysis {
  source: 'model' | 'rules';
  name: string;
  description: string;
  variables: string[];
  steps: DraftStep[];
}

export interface RecoveryInput {
  originalLabel: string;
  url: string;
  candidates: string[];
}

export interface RecoveryResult {
  match: string;
  confidence: number;
  reason: string;
  source: 'model' | 'similarity';
}

function actionLabel(action: RawAction) {
  const target = action.label || action.selectors?.text || action.selectors?.ariaLabel || action.selectors?.name || '';
  if (action.type === 'navigate' || action.type === 'OPEN_URL') return `Open ${action.url || 'page'}`;
  if (action.type === 'click') return target ? `Click ${target}` : 'Click';
  if (action.type === 'input' || action.type === 'TYPE') return target ? `Enter ${target}` : 'Enter text';
  if (action.type === 'select') return target ? `Select ${target}` : 'Select option';
  if (action.type === 'download') return `Download ${target || 'file'}`;
  if (action.type === 'key') return `Press ${action.value || 'key'}`;
  return action.type;
}

export function analyzeWithRules(actions: RawAction[]): Analysis {
  const steps: DraftStep[] = [];
  let lastUrl = '';
  for (const action of actions) {
    if ((action.type === 'navigate' || action.type === 'OPEN_URL') && action.url && action.url !== lastUrl) {
      lastUrl = action.url;
      steps.push({ type: 'OPEN_URL', label: `Open ${action.title || action.url}`, url: action.url, value: action.url });
      continue;
    }
    if (action.type === 'click') {
      steps.push({ type: 'CLICK', label: actionLabel(action), selectors: action.selectors, value: action.label || '' });
    } else if (action.type === 'input') {
      const secret = action.value?.includes('{{') || action.selectors?.inputType === 'password';
      steps.push({
        type: 'TYPE',
        label: secret ? 'Enter credential' : actionLabel(action),
        selectors: action.selectors,
        value: action.value || '',
      });
    } else if (action.type === 'select') {
      steps.push({ type: 'SELECT', label: actionLabel(action), selectors: action.selectors, value: action.value || '' });
    } else if (action.type === 'download') {
      steps.push({ type: 'DOWNLOAD_FILE', label: actionLabel(action), value: action.value || '' });
    } else if (action.type === 'key') {
      steps.push({ type: 'PRESS_KEY', label: actionLabel(action), value: action.value || 'Enter' });
    }
  }
  if (!steps.length) {
    steps.push({ type: 'SCREENSHOT', label: 'Capture the page' });
  }
  const variables = new Set<string>();
  for (const step of steps) {
    const source = `${step.value || ''} ${step.label}`;
    if (/date|today/i.test(source)) variables.add('TODAY');
    for (const match of source.matchAll(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g)) variables.add(match[1]);
  }
  const firstUrl = steps.find((step) => step.url)?.url || 'the recorded site';
  return {
    source: 'rules',
    name: 'Recorded browser task',
    description: `Replay the recorded browser actions, starting at ${firstUrl}. Dates in fields can use {{TODAY}}.`,
    variables: [...variables],
    steps,
  };
}

function similarity(a: string, b: string) {
  const left = a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const right = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const grams = (value: string) => {
    const set = new Set<string>();
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
    return set;
  };
  const A = grams(left);
  const B = grams(right);
  let shared = 0;
  for (const gram of A) if (B.has(gram)) shared += 1;
  return (2 * shared) / (A.size + B.size || 1);
}

export function recoverBySimilarity(input: RecoveryInput): RecoveryResult | null {
  let best = '';
  let score = 0;
  for (const candidate of input.candidates) {
    const next = similarity(input.originalLabel, candidate);
    if (next > score) {
      score = next;
      best = candidate;
    }
  }
  if (!best || score < 0.72) return null;
  return { match: best, confidence: Math.round(score * 100) / 100, reason: 'Closest visible label on the current page.', source: 'similarity' };
}

async function chat(system: string, user: string) {
  const response = await fetch(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI provider returned an empty response');
  return JSON.parse(content) as Record<string, unknown>;
}

export async function analyzeRecording(actions: RawAction[]): Promise<Analysis> {
  const rules = analyzeWithRules(actions);
  if (!aiConfigured()) return rules;
  try {
    const parsed = await chat(
      'Convert recorded browser actions into a reusable workflow. Reply with JSON: {name, description, variables: string[], steps: [{type, label, url, value}]}. Allowed types: OPEN_URL, CLICK, TYPE, SELECT, PRESS_KEY, WAIT, UPLOAD_FILE, DOWNLOAD_FILE, SCREENSHOT, VERIFY. Use {{TODAY}} for dates. Never invent passwords.',
      JSON.stringify(actions.map((action) => ({ ...action, value: action.value?.includes('{{') ? action.value : action.value?.slice(0, 120) }))),
    );
    const steps = Array.isArray(parsed.steps) ? parsed.steps as DraftStep[] : rules.steps;
    return {
      source: 'model',
      name: String(parsed.name || rules.name),
      description: String(parsed.description || rules.description),
      variables: Array.isArray(parsed.variables) ? parsed.variables.map(String) : rules.variables,
      steps: steps.length ? steps : rules.steps,
    };
  } catch (error) {
    return { ...rules, description: `${rules.description} Model analysis was unavailable (${error instanceof Error ? error.message : 'error'}).` };
  }
}

export async function recoverStep(input: RecoveryInput): Promise<RecoveryResult | null> {
  if (aiConfigured()) {
    try {
      const parsed = await chat(
        'Pick the closest current page control for the original target. Reply JSON {match, confidence, reason}. confidence is 0 to 1. match must be one of the candidates or empty.',
        JSON.stringify(input),
      );
      const match = String(parsed.match || '');
      const confidence = Number(parsed.confidence || 0);
      if (match && input.candidates.includes(match) && confidence >= 0.6) {
        return { match, confidence, reason: String(parsed.reason || 'Model match'), source: 'model' };
      }
    } catch {
      /* fall through to similarity */
    }
  }
  return recoverBySimilarity(input);
}
