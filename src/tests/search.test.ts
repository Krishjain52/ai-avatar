import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicIntent, sanitizeIntent } from '../main/intent';
import { buildQuery, isExcluded } from '../main/search';

const NOW = new Date(2026, 10, 9); // 9 Nov 2026

test('heuristic: screenshot from last week', () => {
  const i = heuristicIntent('find my screenshot from last week', NOW);
  assert.deepEqual(i.kinds, ['image']);
  assert.deepEqual(i.keywords, ['screenshot']);
  assert.equal(i.dateFrom, '2026-11-02');
  assert.equal(i.dateTo, null);
});

test('heuristic: resume pdf in downloads from last month', () => {
  const i = heuristicIntent('my resume pdf in downloads from last month', NOW);
  assert.deepEqual(i.kinds, ['pdf']);
  assert.deepEqual(i.keywords, ['resume']);
  assert.equal(i.folder, 'downloads');
  assert.equal(i.dateFrom, '2026-10-01');
  assert.equal(i.dateTo, '2026-10-31');
});

test('sanitize drops junk from the model', () => {
  const i = sanitizeIntent({ keywords: ['goa', 'photo', 'x"*'], kinds: ['image', 'banana'], dateFrom: 'soon', folder: 'Desktop' });
  assert.deepEqual(i.keywords, ['goa', 'x']);
  assert.deepEqual(i.kinds, ['image']);
  assert.equal(i.dateFrom, null);
  assert.equal(i.folder, 'desktop');
});

test('buildQuery combines keyword, kind and date clauses', () => {
  const q = buildQuery(
    { keywords: ['invoice'], kinds: ['pdf'], dateFrom: '2026-01-01', dateTo: null, folder: null },
    { useKinds: true, useDates: true },
  );
  assert.ok(q?.includes('kMDItemDisplayName == "*invoice*"cd'));
  assert.ok(q?.includes('kMDItemContentTypeTree == "com.adobe.pdf"'));
  assert.ok(q?.includes('$time.iso(2026-01-01T00:00:00)'));
});

test('buildQuery returns null with no filters', () => {
  assert.equal(buildQuery({ keywords: [], kinds: [], dateFrom: null, dateTo: null, folder: null }, { useKinds: true, useDates: true }), null);
});

test('isExcluded hides Library, hidden folders and app bundles', () => {
  const home = '/Users/me';
  assert.equal(isExcluded('/Users/me/Library/Caches/x.png', home), true);
  assert.equal(isExcluded('/Users/me/.config/a.txt', home), true);
  assert.equal(isExcluded('/Users/me/Desktop/Foo.app/Contents/x', home), true);
  assert.equal(isExcluded('/Users/me/Desktop/photo.png', home), false);
});
