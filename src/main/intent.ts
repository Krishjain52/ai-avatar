import { FILE_KINDS, FOLDERS, FileKind, FolderHint, SearchIntent } from './types';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

const STOPWORDS = new Set(
  ('a an the my me i im i\'m find search look looking for get show give open where is are was were ' +
    'it its of in on at to from with and or that this these those some any file files thing things ' +
    'stuff something which what need want please can you could called named about one ones took made ' +
    'saved downloaded sent received created edited have had there all every kind sort type like ' +
    'latest new old recent recently last past ago folder photo photos picture pictures pic pics ' +
    'image images document documents doc docs video videos ' +
    'but only just not also too then than so very really maybe mine our your his her their them ' +
    'we they he she him be been being do does did done will would should may might must into onto ' +
    'over under as by if when while until again still yet more most less other same such own here ' +
    'now how why who whom whose think remember somewhere maybe exactly actually named titled').split(' '),
);

const KIND_PATTERNS: Array<[RegExp, FileKind]> = [
  [/\b(photos?|pictures?|pics?|images?|screenshots?|selfies?|wallpapers?|jpe?gs?|pngs?|heic)\b/, 'image'],
  [/\b(videos?|movies?|clips?|recordings?|mp4|mov)\b/, 'video'],
  [/\b(songs?|music|audio|tracks?|mp3s?|podcasts?|voice notes?)\b/, 'audio'],
  [/\bpdfs?\b/, 'pdf'],
  [/\b(docs?|documents?|word files?|docx)\b/, 'document'],
  [/\b(spreadsheets?|excel|sheets?|xlsx|csv)\b/, 'spreadsheet'],
  [/\b(presentations?|slides?|decks?|powerpoint|pptx?|keynote)\b/, 'presentation'],
  [/\b(code|scripts?|source files?)\b/, 'code'],
  [/\b(zips?|archives?|rar)\b/, 'archive'],
  [/\b(folders?|directory|directories)\b/, 'folder'],
];

export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function cleanKeywords(words: string[]): string[] {
  const out: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/["\\*?]/g, '').replace(/\s+/g, ' ').trim();
    if (!w || w.length > 40 || STOPWORDS.has(w.toLowerCase())) continue;
    if (!out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w);
  }
  return out.slice(0, 5);
}

/** Rule-based fallback used when no AI model is available. */
export function heuristicIntent(text: string, now = new Date()): SearchIntent {
  let t = ` ${text.toLowerCase()} `;
  const extra: string[] = [];
  if (/\bscreenshots?\b/.test(t)) extra.push('screenshot');

  const kinds: FileKind[] = [];
  for (const [re, kind] of KIND_PATTERNS) {
    if (re.test(t)) {
      kinds.push(kind);
      t = t.replace(new RegExp(re.source, 'g'), ' ');
    }
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const mo = today.getMonth();
  const dateRules: Array<[RegExp, () => [Date, Date | null]]> = [
    [/\btoday\b/, () => [today, null]],
    [/\byesterday\b/, () => [addDays(today, -1), addDays(today, -1)]],
    [/\b(this|past|last) week\b/, () => [addDays(today, -7), null]],
    [/\bthis month\b/, () => [new Date(y, mo, 1), null]],
    [/\b(last|past) month\b/, () => [new Date(y, mo - 1, 1), new Date(y, mo, 0)]],
    [/\bthis year\b/, () => [new Date(y, 0, 1), null]],
    [/\b(last|past) year\b/, () => [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)]],
    [/\brecent(ly)?\b/, () => [addDays(today, -30), null]],
  ];
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  for (const [re, range] of dateRules) {
    if (re.test(t)) {
      const [from, to] = range();
      dateFrom = isoDate(from);
      dateTo = to ? isoDate(to) : null;
      t = t.replace(re, ' ');
      break;
    }
  }
  const year = t.match(/\b(19|20)\d{2}\b/);
  if (year && !dateFrom) {
    dateFrom = `${year[0]}-01-01`;
    dateTo = `${year[0]}-12-31`;
    t = t.replace(year[0], ' ');
  }

  let folder: FolderHint | null = null;
  const f = t.match(/\b(downloads|desktop)\b|\b(documents|pictures|movies|music) folder\b/);
  if (f) {
    folder = (f[1] ?? f[2]) as FolderHint;
    t = t.replace(f[0], ' ');
  }

  const words = t.split(/[^a-z0-9_\-.]+/).filter((w) => w.length > 1);
  return { keywords: cleanKeywords([...extra, ...words]), kinds, dateFrom, dateTo, folder };
}

function systemPrompt(now: Date): string {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return `You turn a person's request for a file on their Mac into JSON search filters for Spotlight.
Today is ${isoDate(now)} (${weekday}).
Return JSON with exactly these fields:
- "keywords": 0-4 short words likely to appear in the file's NAME or text (e.g. "invoice", "resume", "goa"). Never include generic words like file, photo, picture, document, find, my. Use singular forms.
- "kinds": file types the request implies, chosen from: ${FILE_KINDS.join(', ')}. Use [] if any type is fine. photo/picture/screenshot/selfie -> image. word doc/notes -> document.
- "dateFrom" and "dateTo": "YYYY-MM-DD" when the request mentions a time ("last week", "in March", "2023"), otherwise "".
- "folder": one of ${FOLDERS.join(', ')} only if the request names that folder, otherwise "".
Mac screenshots are named "Screenshot ...", so for screenshots add the keyword "screenshot".
Reply with the JSON object only.`;
}

const SCHEMA = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' } },
    kinds: { type: 'array', items: { type: 'string', enum: [...FILE_KINDS] } },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    folder: { type: 'string', enum: [...FOLDERS, ''] },
  },
  required: ['keywords', 'kinds', 'dateFrom', 'dateTo', 'folder'],
};

/** Validates whatever the model returned; never trusts its shape. */
export function sanitizeIntent(raw: unknown): SearchIntent {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const kinds = strings(o.kinds)
    .map((k) => k.toLowerCase())
    .filter((k): k is FileKind => (FILE_KINDS as readonly string[]).includes(k));
  const folderRaw = typeof o.folder === 'string' ? o.folder.toLowerCase() : '';
  const folder = (FOLDERS as readonly string[]).includes(folderRaw) ? (folderRaw as FolderHint) : null;
  return {
    keywords: cleanKeywords(strings(o.keywords)),
    kinds: [...new Set(kinds)],
    dateFrom: date(o.dateFrom),
    dateTo: date(o.dateTo),
    folder,
  };
}

const hasFilters = (i: SearchIntent) => i.keywords.length > 0 || i.kinds.length > 0 || i.dateFrom !== null;

function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

async function askOllama(text: string, now: Date): Promise<unknown> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: SCHEMA,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: systemPrompt(now) },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return parseJsonText(data.message?.content ?? '');
}

async function askGemini(text: string, now: Date, key: string): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(now) }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return parseJsonText(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

/** Local model first, free Gemini tier second, keyword rules last. */
export async function parseIntent(text: string): Promise<{ intent: SearchIntent; source: string }> {
  const now = new Date();
  try {
    const intent = sanitizeIntent(await askOllama(text, now));
    if (hasFilters(intent)) return { intent, source: `local AI (${OLLAMA_MODEL})` };
  } catch (err) {
    console.warn('[intent] Ollama unavailable:', (err as Error).message);
  }
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const intent = sanitizeIntent(await askGemini(text, now, key));
      if (hasFilters(intent)) return { intent, source: `Gemini (${GEMINI_MODEL})` };
    } catch (err) {
      console.warn('[intent] Gemini failed:', (err as Error).message);
    }
  }
  return { intent: heuristicIntent(text, now), source: 'basic mode' };
}
