interface AvatarApi {
  setMode(m: 'compact' | 'expanded'): Promise<void>;
  dragBy(dx: number, dy: number): void;
  setClickThrough(through: boolean): void;
  search(q: string): Promise<{
    results: Array<{ path: string; name: string; dir: string; modified: string; isDir: boolean; thumb?: string }>;
    source: string;
    relaxed: boolean;
    error?: string;
  }>;
  goToCorner(): Promise<void>;
  goHome(): Promise<void>;
  open(p: string): void;
  reveal(p: string): void;
  showMenu(): void;
}
declare const api: AvatarApi;

(() => {
  type State = 'sleeping' | 'awake' | 'searching' | 'results' | 'notfound';

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const avatar = $<HTMLDivElement>('avatar');
  const cloudText = $<HTMLParagraphElement>('cloud-text');
  const cloudNote = $<HTMLParagraphElement>('cloud-note');
  const form = $<HTMLFormElement>('chat');
  const input = $<HTMLInputElement>('q');
  const list = $<HTMLUListElement>('results');

  const sprite = document.getElementById('sprite') as unknown as SVGSVGElement;

  // ── Pixel sprite: 16x20 grid. '.' = transparent; each letter is a colour from style.css (.p<letter>).
  //    o outline · w pom-pom · b beanie · n beanie band · h hair · s skin · k blush
  //    e eyes · m mouth · d hoodie · l pocket · p jeans
  const BASE = [
    '.......ww.......', // pom-pom
    '.....oobboo.....', // beanie
    '....obbbbbbo....',
    '...obbbbbbbbo...',
    '...onnnnnnnno...', // beanie band
    '...ohsssssssho..'.slice(0, 16).replace('...ohsssssssho..', '...ohsssssssho..'), // placeholder, replaced below
    '..ohssssssssho..', // 6  eyes
    '..osssssssssso..', // 7  eyes
    '..osssssssssso..', // 8  eyes
    '..okssssssssko..', // 9  cheeks
    '..osssssssssso..', // 10 mouth
    '...osssssssso...', // 11 mouth
    '....oooooooo....', // chin
    '...oddddddddo...', // hoodie
    '..oddddddddddo..',
    '..osddddddddso..', // hands
    '..osddllllddso..', // pocket
    '...oddddddddo...',
    '....pp....pp....', // legs
    '...oooo..oooo...', // shoes
  ];
  BASE[5] = '...ohsssssho...'.length === 16 ? '...ohsssssho...' : '...ohsssssssho..'.slice(0, 16);

  // Faces are pixel overlays on BASE: [row, column, colour].
  type Px = [number, number, string];
  const eye = (cells: [number, number][]): Px[] => cells.map(([y, x]) => [y, x, 'e']);
  const mouth = (cells: [number, number][]): Px[] => cells.map(([y, x]) => [y, x, 'm']);
  const EYES = {
    open: eye([[7, 5], [7, 10], [8, 5], [8, 10]]),
    closed: eye([[8, 4], [8, 5], [8, 10], [8, 11]]),
    up: eye([[6, 5], [6, 10], [7, 5], [7, 10]]),
  };
  const MOUTHS = {
    o: mouth([[10, 7], [10, 8]]),
    smile: mouth([[10, 6], [10, 9], [11, 7], [11, 8]]),
    grin: mouth([[10, 5], [10, 6], [10, 7], [10, 8], [10, 9], [10, 10], [11, 6], [11, 7], [11, 8], [11, 9]]),
    flat: mouth([[10, 6], [10, 7], [10, 8], [10, 9]]),
    sad: mouth([[10, 7], [10, 8], [11, 6], [11, 9]]),
  };
  type Eyes = keyof typeof EYES;
  type Mouth = keyof typeof MOUTHS;
  const FACES: Record<State, [Eyes, Mouth]> = {
    sleeping: ['closed', 'o'],
    awake: ['open', 'smile'],
    searching: ['up', 'flat'],
    results: ['open', 'grin'],
    notfound: ['open', 'sad'],
  };

  function drawSprite(eyes: Eyes, mouth: Mouth) {
    const grid = BASE.map((row) => row.split(''));
    for (const [y, x, c] of [...EYES[eyes], ...MOUTHS[mouth]]) grid[y][x] = c;
    let svg = '';
    grid.forEach((row, y) => {
      // Merge same-colour runs into one rect each.
      for (let x = 0; x < row.length; ) {
        const c = row[x];
        let end = x + 1;
        while (end < row.length && row[end] === c) end++;
        if (c !== '.') svg += `<rect class="p${c}" x="${x}" y="${y}" width="${end - x}" height="1"/>`;
        x = end;
      }
    });
    sprite.innerHTML = svg;
  }

  let state: State = 'sleeping';
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function setState(s: State) {
    state = s;
    document.body.dataset.state = s;
    drawSprite(...FACES[s]);
  }

  // Blink every few seconds while he's awake.
  setInterval(() => {
    if (state !== 'awake' && state !== 'results') return;
    drawSprite('closed', FACES[state][1]);
    setTimeout(() => drawSprite(...FACES[state]), 140);
  }, 3500);

  function setLayout(mode: 'compact' | 'expanded') {
    document.body.classList.toggle('expanded', mode === 'expanded');
  }

  // Retro typewriter effect for the speech box.
  let typing: number | undefined;
  function say(text: string, note = '') {
    clearInterval(typing);
    cloudText.textContent = '';
    cloudNote.textContent = '';
    let i = 0;
    typing = window.setInterval(() => {
      cloudText.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(typing);
        cloudNote.textContent = note;
      }
    }, 28);
  }

  async function wake() {
    setState('awake');
    say('What do you need me to find?');
    list.replaceChildren();
    await api.setMode('expanded');
    setLayout('expanded');
    avatar.classList.add('waking');
    setTimeout(() => avatar.classList.remove('waking'), 700);
    input.value = '';
    input.focus();
  }

  async function sleep() {
    setState('sleeping');
    setLayout('compact');
    list.replaceChildren();
    await api.setMode('compact');
  }

  async function runSearch(query: string) {
    setState('searching');
    setLayout('compact');
    const [res] = await Promise.all([api.search(query), api.goToCorner(), delay(1200)]);
    await api.goHome();
    setLayout('expanded');

    if (res.error) {
      setState('notfound');
      say('Hmm, something went wrong.', res.error);
      return;
    }
    const n = res.results.length;
    if (!n) {
      setState('notfound');
      say("I couldn't find anything like that.", 'Try other words, or a file type and rough date.');
      return;
    }
    setState('results');
    say(`Found ${n} ${n === 1 ? 'thing' : 'things'}!`, `${res.relaxed ? 'Loosened some filters · ' : ''}${res.source}`);
    renderResults(res.results);
    input.select();
  }

  function renderResults(results: Awaited<ReturnType<AvatarApi['search']>>['results']) {
    list.replaceChildren(
      ...results.map((r) => {
        const li = document.createElement('li');
        li.className = 'result';
        li.title = r.path;

        const img = document.createElement('img');
        if (r.thumb) img.src = r.thumb;
        img.alt = '';

        const text = document.createElement('div');
        text.className = 'meta';
        const name = document.createElement('strong');
        name.textContent = r.name;
        const sub = document.createElement('span');
        sub.textContent = `${r.dir} · ${new Date(r.modified).toLocaleDateString()}`;
        text.append(name, sub);

        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'reveal';
        reveal.title = 'Show in Finder';
        reveal.textContent = 'DIR';
        reveal.addEventListener('click', (e) => {
          e.stopPropagation();
          api.reveal(r.path);
        });

        li.append(img, text, reveal);
        li.addEventListener('click', () => api.open(r.path));
        return li;
      }),
    );
  }

  function onAvatarClick() {
    if (state === 'sleeping') void wake();
    else if (state !== 'searching') void sleep();
  }

  // Click vs drag on the avatar.
  let start: { x: number; y: number } | null = null;
  let last = { x: 0, y: 0 };
  let dragging = false;
  avatar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    avatar.setPointerCapture(e.pointerId);
    start = { x: e.screenX, y: e.screenY };
    last = { ...start };
    dragging = false;
  });
  avatar.addEventListener('pointermove', (e) => {
    if (!start || state === 'searching') return;
    if (!dragging && Math.hypot(e.screenX - start.x, e.screenY - start.y) > 4) dragging = true;
    if (dragging) {
      api.dragBy(e.screenX - last.x, e.screenY - last.y);
      last = { x: e.screenX, y: e.screenY };
    }
  });
  avatar.addEventListener('pointerup', () => {
    if (!start) return;
    const wasDrag = dragging;
    start = null;
    dragging = false;
    if (!wasDrag) onAvatarClick();
  });
  avatar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.showMenu();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q && state !== 'searching') void runSearch(q);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state !== 'searching' && state !== 'sleeping') void sleep();
  });

  // Let clicks pass through the transparent parts of the window to the desktop.
  let through = true;
  document.addEventListener('mousemove', (e) => {
    const hit = !!(e.target as Element | null)?.closest?.('.hit');
    if (hit === through) {
      through = !hit;
      api.setClickThrough(through);
    }
  });
  document.addEventListener('mouseleave', () => {
    if (!through && !start) {
      through = true;
      api.setClickThrough(true);
    }
  });

  setState('sleeping');
})();
