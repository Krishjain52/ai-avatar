import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileKind, SearchIntent } from './types';

/**
 * Backup search that walks the usual folders directly. It works even when Spotlight
 * indexing is off or still rebuilding, and it matches names loosely, so "pancard"
 * finds "PAN Card.jpg" and "pan card" finds "pancard.png".
 */

const ROOTS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'];
const MAX_ENTRIES = 60_000;
const MAX_DEPTH = 8;
const TIME_BUDGET_MS = 4_000;
const CACHE_MS = 60_000;

const KIND_EXTS: Record<Exclude<FileKind, 'folder'>, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'svg', 'dng', 'cr2', 'nef', 'arw'],
  video: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'],
  audio: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'aiff', 'aif'],
  pdf: ['pdf'],
  document: ['pdf', 'doc', 'docx', 'rtf', 'pages', 'odt', 'md'],
  spreadsheet: ['xls', 'xlsx', 'csv', 'tsv', 'numbers', 'ods'],
  presentation: ['ppt', 'pptx', 'key', 'odp'],
  code: ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'swift', 'kt', 'sh', 'html', 'css'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'],
};

const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build', 'target', 'Pods']);

interface Entry {
  path: string;
  norm: string; // lowercase name with spaces, dashes, underscores etc. removed
  ext: string;
  isDir: boolean;
}

/** "PAN Card_final.JPG" → "pancardfinaljpg" */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

let cache: { at: number; entries: Entry[] } | null = null;

async function scanAll(home = os.homedir()): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.entries;
  const entries: Entry[] = [];
  const deadline = Date.now() + TIME_BUDGET_MS;
  const queue: Array<[string, number]> = ROOTS.map((r) => [path.join(home, r), 0]);
  while (queue.length && entries.length < MAX_ENTRIES && Date.now() < deadline) {
    const [dir, depth] = queue.shift()!;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // no permission, vanished, etc.
    }
    for (const d of dirents) {
      const name = d.name;
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const isDir = d.isDirectory();
      // Packages like .app / .photoslibrary are folders on disk but single things to people.
      const isPackage = isDir && /\.(app|photoslibrary|musiclibrary|fcpbundle|bundle)$/i.test(name);
      if (isPackage) continue;
      const ext = isDir ? '' : path.extname(name).slice(1).toLowerCase();
      entries.push({ path: full, norm: normalizeName(isDir ? name : name.slice(0, name.length - ext.length)), ext, isDir });
      if (isDir && depth < MAX_DEPTH && !SKIP_DIRS.has(name)) queue.push([full, depth + 1]);
    }
  }
  cache = { at: Date.now(), entries };
  return entries;
}

export interface ScanOptions {
  useKinds: boolean;
  useDates: boolean;
  anyKeyword?: boolean;
  folder?: string | null; // absolute folder to stay inside
}

function kindMatches(e: Entry, kinds: FileKind[]): boolean {
  return kinds.some((k) => (k === 'folder' ? e.isDir : !e.isDir && KIND_EXTS[k].includes(e.ext)));
}

/** Finds files whose names loosely contain the keywords. Needs keywords or a file type to filter on. */
export async function scanFiles(intent: SearchIntent, opts: ScanOptions, stemFn: (w: string) => string): Promise<string[]> {
  const words = intent.keywords.map((k) => normalizeName(stemFn(k))).filter((w) => w.length >= 2);
  const kinds = opts.useKinds ? intent.kinds : [];
  if (!words.length && !kinds.length) return [];
  const entries = await scanAll();
  let hits = entries.filter((e) => {
    if (opts.folder && !e.path.startsWith(opts.folder + path.sep)) return false;
    if (kinds.length && !kindMatches(e, kinds)) return false;
    if (!words.length) return true;
    return opts.anyKeyword ? words.some((w) => e.norm.includes(w)) : words.every((w) => e.norm.includes(w));
  });
  if (opts.useDates && (intent.dateFrom || intent.dateTo)) {
    const from = intent.dateFrom ? new Date(`${intent.dateFrom}T00:00:00`).getTime() : -Infinity;
    const to = intent.dateTo ? new Date(`${intent.dateTo}T23:59:59`).getTime() : Infinity;
    const dated = await Promise.all(
      hits.slice(0, 3000).map(async (e) => {
        try {
          const st = await fs.stat(e.path);
          const inRange = (t: number) => t >= from && t <= to;
          return inRange(st.mtimeMs) || inRange(st.birthtimeMs) ? e : null;
        } catch {
          return null;
        }
      }),
    );
    hits = dated.filter((e): e is Entry => e !== null);
  }
  return hits.slice(0, 1500).map((e) => e.path);
}
