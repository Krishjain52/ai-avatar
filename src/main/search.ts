import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileKind, FolderHint, FoundFile, SearchIntent } from './types';

const KIND_UTIS: Record<FileKind, string[]> = {
  image: ['public.image'],
  video: ['public.movie'],
  audio: ['public.audio'],
  pdf: ['com.adobe.pdf'],
  // People say "document" for PDFs too. Plain text is left out: it also matches code, CSV and logs.
  document: [
    'com.adobe.pdf',
    'org.openxmlformats.wordprocessingml.document', 'com.microsoft.word.doc', 'public.rtf',
    'com.apple.iwork.pages.sffpages', 'com.apple.iwork.pages.pages',
    'org.oasis-open.opendocument.text', 'net.daringfireball.markdown',
  ],
  spreadsheet: ['public.spreadsheet', 'public.comma-separated-values-text'],
  presentation: ['public.presentation'],
  code: ['public.source-code', 'public.script'],
  archive: ['public.archive', 'public.zip-archive'],
  folder: ['public.folder'],
};

const FOLDER_DIRS: Record<FolderHint, string> = {
  downloads: 'Downloads', desktop: 'Desktop', documents: 'Documents',
  pictures: 'Pictures', movies: 'Movies', music: 'Music',
};

export interface QueryOptions {
  useKinds: boolean;
  useDates: boolean;
  /** Match ANY keyword instead of ALL of them. */
  anyKeyword?: boolean;
  /** Only look at file names, not file contents. */
  nameOnly?: boolean;
}

export function escapeTerm(s: string): string {
  return s.replace(/["\\*?]/g, '').replace(/\s+/g, ' ').trim();
}

/** Rough singular stem so "invoices" still finds "invoice.pdf" (used as a name substring). */
export function stem(w: string): string {
  const l = w.toLowerCase();
  if (l.length < 5) return w;
  if (l.endsWith('ies')) return w.slice(0, -3);
  if (/(s|x|ch|sh)es$/.test(l)) return w.slice(0, -2);
  if (l.endsWith('s') && !/(ss|us|is)$/.test(l)) return w.slice(0, -1);
  return w;
}

function keywordClause(kw: string, nameOnly: boolean): string | null {
  const w = escapeTerm(kw);
  if (!w) return null;
  const st = stem(w);
  const parts = [`kMDItemDisplayName == "*${st}*"cd`];
  if (!nameOnly) {
    parts.push(`kMDItemTextContent == "${w}"cdw`);
    if (st !== w) parts.push(`kMDItemTextContent == "${st}"cdw`);
  }
  return `(${parts.join(' || ')})`;
}

/** Builds a Spotlight (mdfind) query string, or null if there is nothing to filter on. */
export function buildQuery(intent: SearchIntent, opts: QueryOptions): string | null {
  const clauses: string[] = [];
  const kwClauses = intent.keywords
    .map((k) => keywordClause(k, !!opts.nameOnly))
    .filter((c): c is string => c !== null);
  if (kwClauses.length) {
    clauses.push(opts.anyKeyword && kwClauses.length > 1 ? `(${kwClauses.join(' || ')})` : kwClauses.join(' && '));
  } else if (opts.nameOnly) {
    return null;
  }
  if (opts.useKinds && intent.kinds.length) {
    const utis = [...new Set(intent.kinds.flatMap((k) => KIND_UTIS[k]))];
    clauses.push(`(${utis.map((u) => `kMDItemContentTypeTree == "${u}"`).join(' || ')})`);
  }
  if (opts.useDates && (intent.dateFrom || intent.dateTo)) {
    const range = (attr: string) => {
      const parts: string[] = [];
      if (intent.dateFrom) parts.push(`${attr} >= $time.iso(${intent.dateFrom}T00:00:00)`);
      if (intent.dateTo) parts.push(`${attr} <= $time.iso(${intent.dateTo}T23:59:59)`);
      return `(${parts.join(' && ')})`;
    };
    clauses.push(`(${range('kMDItemContentCreationDate')} || ${range('kMDItemFSContentChangeDate')})`);
  }
  return clauses.length ? clauses.join(' && ') : null;
}

/** Hide system/app internals that Spotlight indexes but people never mean. */
export function isExcluded(p: string, home = os.homedir()): boolean {
  if (!p.startsWith(home + '/')) return true;
  const segs = p.slice(home.length + 1).split('/');
  if (segs[0] === 'Library' || segs[0] === 'Applications') return true;
  return segs.some(
    (s) => s.startsWith('.') || s === 'node_modules' || s === '__pycache__' ||
      s.endsWith('.app') || s.endsWith('.photoslibrary') || s.endsWith('.musiclibrary'),
  );
}

function runMdfind(dir: string, query: string, limit = 1500): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('mdfind', ['-onlyin', dir, query]);
    const out: string[] = [];
    let buf = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill();
      resolve(out);
    };
    const timer = setTimeout(finish, 10_000);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line && !isExcluded(line)) out.push(line);
        if (out.length >= limit) return finish();
      }
    });
    proc.on('close', () => {
      if (buf && !isExcluded(buf)) out.push(buf);
      finish();
    });
    proc.on('error', finish);
  });
}

async function rank(paths: string[], intent: SearchIntent, limit: number): Promise<FoundFile[]> {
  const home = os.homedir();
  const kws = intent.keywords.map((k) => stem(escapeTerm(k)).toLowerCase()).filter(Boolean);
  const now = Date.now();
  const scored = await Promise.all(
    paths.slice(0, 800).map(async (p) => {
      try {
        const st = await fs.stat(p);
        const name = path.basename(p);
        const lowerName = name.toLowerCase();
        const lowerPath = p.toLowerCase();
        let score = 0;
        let nameHits = 0;
        for (const k of kws) {
          if (lowerName.includes(k)) { score += 10; nameHits++; }
          else if (lowerPath.includes(k)) score += 2;
        }
        if (kws.length > 1 && nameHits === kws.length) score += 10; // every word is in the name
        const ageDays = (now - st.mtimeMs) / 86_400_000;
        score += 5 * Math.exp(-ageDays / 120);
        score -= p.split('/').length * 0.1;
        const dir = path.dirname(p);
        return {
          score,
          file: {
            path: p,
            name,
            dir: dir.startsWith(home) ? '~' + dir.slice(home.length) : dir,
            modified: st.mtime.toISOString(),
            isDir: st.isDirectory(),
          } satisfies FoundFile,
        };
      } catch {
        return null;
      }
    }),
  );
  return scored
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.file);
}

/**
 * Runs the strictest search first, then loosens filters until something turns up:
 * folder → dates → all words → file type. An explicit file type ("image", "pdf") is
 * kept as long as possible, since people are surer of the type than of exact words.
 */
export async function searchFiles(
  intent: SearchIntent,
  limit = 20,
): Promise<{ results: FoundFile[]; relaxed: boolean }> {
  const home = os.homedir();
  type Attempt = QueryOptions & { useFolder: boolean };
  const attempts: Attempt[] = [
    { useKinds: true, useDates: true, useFolder: true },
    { useKinds: true, useDates: true, useFolder: false },
    { useKinds: true, useDates: false, useFolder: false },
    { useKinds: true, useDates: false, useFolder: false, anyKeyword: true },
    { useKinds: false, useDates: false, useFolder: false },
    { useKinds: false, useDates: false, useFolder: false, anyKeyword: true },
  ];
  const seen = new Set<string>();
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const query = buildQuery(intent, a);
    if (!query) continue;
    const dir = a.useFolder && intent.folder ? path.join(home, FOLDER_DIRS[intent.folder]) : home;
    const key = `${dir}\n${query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Name matches are the strongest signal, so fetch them separately and put them first;
    // otherwise they can be crowded out by files that only mention the word inside.
    const nameQuery = buildQuery(intent, { ...a, nameOnly: true });
    const [byName, byAny] = await Promise.all([
      nameQuery ? runMdfind(dir, nameQuery, 400) : Promise.resolve([]),
      runMdfind(dir, query),
    ]);
    const paths = [...new Set([...byName, ...byAny])];
    if (paths.length) return { results: await rank(paths, intent, limit), relaxed: i > 0 };
  }
  return { results: [], relaxed: false };
}
