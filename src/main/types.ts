export const FILE_KINDS = [
  'image', 'video', 'audio', 'pdf', 'document', 'spreadsheet',
  'presentation', 'code', 'archive', 'folder',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FOLDERS = ['downloads', 'desktop', 'documents', 'pictures', 'movies', 'music'] as const;
export type FolderHint = (typeof FOLDERS)[number];

/** Structured filters extracted from what the user typed. */
export interface SearchIntent {
  keywords: string[];
  kinds: FileKind[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;   // YYYY-MM-DD
  folder: FolderHint | null;
}

export interface FoundFile {
  path: string;
  name: string;
  dir: string;
  modified: string;
  isDir: boolean;
  thumb?: string;
}

export interface SearchResponse {
  results: FoundFile[];
  source: string;
  relaxed: boolean;
  error?: string;
}
