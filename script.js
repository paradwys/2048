(() => {
  'use strict';

  const SIZE = 4;
  const STORAGE_KEY = 'little-big-numbers-2048-v1';
  const MOVE_MS = 160;
  const POWERUPS = [
    { id: 'undo', label: 'Undo move', icon: '↶', threshold: 100, detail: 'Restore your last move' },
    { id: 'shuffle', label: 'Shuffle', icon: '✦', threshold: 500, detail: 'Mix tiles into new spots' },
    { id: 'clear', label: 'Clear a tile', icon: '⌫', threshold: 1500, detail: 'Remove your smallest tile' }
  ];
  const boardEl = document.querySelector('#board');
  const cellsEl = document.querySelector('#cells');
  const tilesEl = document.querySelector('#tiles');
  const shellEl = document.querySelector('.board-shell');
  const fireworksCanvas = document.querySelector('#fireworks');
  const scoreEl = document.querySelector('#score');
  const bestEl = document.querySelector('#best');
  const scorePopEl = document.querySelector('#score-pop');
  const overlayEl = document.querySelector('#overlay');
  const overlayIconEl = document.querySelector('#overlay-icon');
  const overlayTitleEl = document.querySelector('#overlay-title');
  const overlayMessageEl = document.querySelector('#overlay-message');
  const continueButton = document.querySelector('#continue');
  const powerupsEl = document.querySelector('#powerups');
  const powerupListEl = document.querySelector('#powerup-list');

  let state;
  let busy = false;
  let moveSnapshot = null;
  let tileNodes = new Map();
  let nextId = 1;
  let touchStart = null;

  function emptyBoard() { return Array.from({ length: SIZE }, () => Array(SIZE).fill(null)); }
  function makeTile(value) { return { id: `t${nextId++}`, value, merged: false }; }
  function loadGame() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.version === 1 && Array.isArray(saved.board) && saved.board.length === SIZE &&
          saved.board.every(row => Array.isArray(row) && row.length === SIZE) &&
          saved.board.flat().every(tile => tile === null || (Number.isInteger(tile.value) && tile.value > 0 && Number.isFinite(tile.value)))) {
        nextId = Math.max(1, Number(saved.nextId) || 1);
        return {
          board: saved.board.map(row => row.map(tile => tile ? { id: `t${nextId++}`, value: tile.value, merged: false } : null)),
          score: Math.max(0, Number(saved.score) || 0), best: Math.max(0, Number(saved.best) || 0),
          won: Boolean(saved.won), continued: Boolean(saved.continued),
          fireworksShown: Boolean(saved.fireworksShown),
          powerupUses: saved.powerupUses && typeof saved.powerupUses === 'object' ? saved.powerupUses : {},
          lastMove: saved.lastMove && typeof saved.lastMove === 'object' ? saved.lastMove : null
        };
      }
    } catch { /* Storage can be unavailable; the game still works for this session. */ }
    return { board: emptyBoard(), score: 0, best: 0, won: false, continued: false, fireworksShown: false, powerupUses: {}, lastMove: null };
  }
  function saveGame() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, board: state.board, score: state.score, best: state.best,
        won: state.won, continued: state.continued, nextId,
        fireworksShown: state.fireworksShown,
        powerupUses: state.powerupUses, lastMove: state.lastMove
      }));
    } catch { /* Keep the current game playable if storage is full or disabled. */ }
  }
  function randomEmptyCell() {
    const empty = [];
    state.board.forEach((row, r) => row.forEach((tile, c) => { if (!tile) empty.push([r, c]); }));
    if (!empty.length) return null;
    return empty[Math.floor(Math.random() * empty.length)];
  }
  function addRandomTile() {
    const cell = randomEmptyCell();
    if (!cell) return null;
    const [r, c] = cell;
    state.board[r][c] = makeTile(Math.random() < .9 ? 2 : 4);
    return state.board[r][c];
  }
  function startNewGame() {
    state = { board: emptyBoard(), score: 0, best: state?.best || 0, won: false, continued: false, fireworksShown: false, powerupUses: {}, lastMove: null };
    addRandomTile(); addRandomTile();
    busy = false;
    overlayEl.hidden = true;
    render(); saveGame();
  }
  function render() {
    cellsEl.replaceChildren();
    tilesEl.replaceChildren();
    tileNodes = new Map();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell'; cell.setAttribute('role', 'gridcell');
        cellsEl.append(cell);
        const tile = state.board[r][c];
        if (tile) {
          const node = createTileNode(tile, r, c);
          tilesEl.append(node); tileNodes.set(tile.id, node);
        }
      }
    }
    scoreEl.textContent = state.score.toLocaleString();
    bestEl.textContent = state.best.toLocaleString();
    boardEl.setAttribute('aria-label', `Game board. Score ${state.score}. ${state.board.flat().filter(Boolean).length} tiles.`);
    renderPowerups();
  }
  function renderPowerups() {
    const unlocked = POWERUPS.filter(powerup => state.best >= powerup.threshold);
    powerupsEl.hidden = unlocked.length === 0;
    powerupListEl.replaceChildren();
    for (const powerup of unlocked) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'powerup-button';
      button.dataset.powerup = powerup.id;
      const uses = state.powerupUses[powerup.id] || 0;
      const exhausted = powerup.id !== 'undo' && uses > 0;
      const undoUnavailable = powerup.id === 'undo' && !state.lastMove;
      button.disabled = busy || exhausted || undoUnavailable || !overlayEl.hidden;
      const detail = exhausted ? 'Used this game' : undoUnavailable ? 'Make a move first' : powerup.detail;
      button.innerHTML = `<span class="powerup-icon" aria-hidden="true">${powerup.icon}</span><span class="powerup-copy"><span class="powerup-name">${powerup.label}</span><span class="powerup-detail">${detail}</span></span>`;
      button.addEventListener('click', () => usePowerup(powerup.id));
      powerupListEl.append(button);
    }
  }
  function snapshotGame() {
    return {
      board: state.board.map(row => row.map(tile => tile ? { value: tile.value } : null)),
      score: state.score, won: state.won, continued: state.continued,
      powerupUses: { ...state.powerupUses }
    };
  }
  function usePowerup(id) {
    if (busy || !overlayEl.hidden) return;
    const powerup = POWERUPS.find(item => item.id === id);
    if (!powerup || state.best < powerup.threshold) return;
    if (id === 'undo') {
      if (!state.lastMove) return;
      const snapshot = state.lastMove;
      state.board = snapshot.board.map(row => row.map(tile => tile ? makeTile(tile.value) : null));
      state.score = snapshot.score;
      state.won = snapshot.won;
      state.continued = snapshot.continued;
      state.powerupUses = { ...snapshot.powerupUses };
      state.lastMove = null;
      overlayEl.hidden = true;
      render(); saveGame();
      return;
    }
    if (state.powerupUses[id]) return;
    state.lastMove = snapshotGame();
    state.powerupUses[id] = 1;
    if (id === 'shuffle') {
      const tiles = state.board.flat().filter(Boolean);
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      const positions = state.board.flatMap((row, r) => row.map((tile, c) => tile ? [r, c] : null)).filter(Boolean);
      state.board = emptyBoard();
      positions.forEach(([r, c], index) => { state.board[r][c] = tiles[index]; });
    } else if (id === 'clear') {
      const tiles = state.board.flat().filter(Boolean);
      const smallest = Math.min(...tiles.map(tile => tile.value));
      const target = tiles.find(tile => tile.value === smallest);
      state.board = state.board.map(row => row.map(tile => tile?.id === target.id ? null : tile));
    }
    overlayEl.hidden = true;
    render(); saveGame();
  }
  function setTilePosition(node, r, c) {
    node.style.setProperty('--row', r);
    node.style.setProperty('--col', c);
  }
  function createTileNode(tile, r, c) {
    const node = document.createElement('div');
    const sizeClass = tile.value > 2048 ? 'super' : String(tile.value);
    node.className = `tile tile-${sizeClass}${tile.spawn ? ' spawn' : ''}${tile.merged ? ' merged' : ''}`;
    node.textContent = tile.value.toLocaleString();
    node.setAttribute('aria-label', String(tile.value));
    setTilePosition(node, r, c);
    return node;
  }
  function showScoreGain(points) {
    if (!points) return;
    scorePopEl.textContent = `+${points}`;
    scorePopEl.classList.remove('active');
    void scorePopEl.offsetWidth;
    scorePopEl.classList.add('active');
  }
  function shakeBoard() {
    shellEl.classList.remove('shake');
    void shellEl.offsetWidth;
    shellEl.classList.add('shake');
  }
  function launchFireworks() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = fireworksCanvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    fireworksCanvas.width = Math.round(rect.width * pixelRatio);
    fireworksCanvas.height = Math.round(rect.height * pixelRatio);
    const context = fireworksCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const colors = ['#ff8b79', '#ffc45e', '#e77ec0', '#927fe9', '#55c9ad', '#69a6ed'];
    const particles = [];
    const centers = [
      [rect.width * .24, rect.height * .32],
      [rect.width * .72, rect.height * .25],
      [rect.width * .52, rect.height * .48]
    ];
    centers.forEach(([x, y], burstIndex) => {
      for (let i = 0; i < 34; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 3.1;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 48 + Math.random() * 22, maxLife: 70, color: colors[(i + burstIndex * 2) % colors.length], size: 2 + Math.random() * 2.2 });
      }
    });
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      context.clearRect(0, 0, rect.width, rect.height);
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += .045;
        particle.vx *= .99;
        particle.life--;
        context.globalAlpha = Math.min(1, particle.life / 16);
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      if (elapsed < 1500 && particles.some(particle => particle.life > 0)) requestAnimationFrame(frame);
      else context.clearRect(0, 0, rect.width, rect.height);
    }
    requestAnimationFrame(frame);
  }
  function move(direction) {
    if (busy || !overlayEl.hidden) return;
    moveSnapshot = snapshotGame();
    const before = state.board.map(row => row.map(tile => tile ? tile.value : 0));
    const oldPositions = new Map();
    state.board.forEach((row, r) => row.forEach((tile, c) => { if (tile) oldPositions.set(tile.id, [r, c]); }));
    let gained = 0;
    let createdShakeTile = false;

    for (let line = 0; line < SIZE; line++) {
      const coords = [];
      for (let i = 0; i < SIZE; i++) {
        if (direction === 'left') coords.push([line, i]);
        if (direction === 'right') coords.push([line, SIZE - 1 - i]);
        if (direction === 'up') coords.push([i, line]);
        if (direction === 'down') coords.push([SIZE - 1 - i, line]);
      }
      const tiles = coords.map(([r, c]) => state.board[r][c]).filter(Boolean);
      const compacted = [];
      for (let i = 0; i < tiles.length; i++) {
        if (i + 1 < tiles.length && tiles[i].value === tiles[i + 1].value) {
          const merged = makeTile(tiles[i].value * 2);
          merged.merged = true;
          if (merged.value === 512 || merged.value === 1024) createdShakeTile = true;
          compacted.push(merged);
          gained += merged.value;
          i++;
        } else compacted.push({ ...tiles[i], merged: false });
      }
      coords.forEach(([r, c], index) => { state.board[r][c] = compacted[index] || null; });
    }

    const changed = state.board.some((row, r) => row.some((tile, c) => (tile?.value || 0) !== before[r][c]));
    if (!changed) return;
    state.lastMove = moveSnapshot;
    moveSnapshot = null;
    state.score += gained;
    state.best = Math.max(state.best, state.score);
    showScoreGain(gained);
    if (createdShakeTile) shakeBoard();
    if (!state.fireworksShown && state.score >= 2048) {
      state.fireworksShown = true;
      launchFireworks();
    }

    const previousNodes = tileNodes;
    const currentIds = new Set(state.board.flat().filter(Boolean).map(tile => tile.id));
    for (const [id, node] of previousNodes) {
      if (!currentIds.has(id)) {
        node.style.opacity = '0';
        window.setTimeout(() => node.remove(), MOVE_MS);
      }
    }

    tilesEl.replaceChildren();
    const nextNodes = new Map();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = state.board[r][c];
        if (tile) {
          let node = previousNodes.get(tile.id);
          if (!node) node = createTileNode(tile, r, c);
          node.className = `tile tile-${tile.value > 2048 ? 'super' : tile.value}${tile.spawn ? ' spawn' : ''}${tile.merged ? ' merged' : ''}`;
          node.textContent = tile.value.toLocaleString();
          node.setAttribute('aria-label', String(tile.value));
          const old = oldPositions.get(tile.id);
          if (old) setTilePosition(node, old[0], old[1]);
          else setTilePosition(node, r, c);
          tilesEl.append(node); nextNodes.set(tile.id, node);
        }
      }
    }
    tileNodes = nextNodes;
    boardEl.setAttribute('aria-label', `Game board. Score ${state.score}. ${state.board.flat().filter(Boolean).length} tiles.`);
    void tilesEl.offsetWidth;
    requestAnimationFrame(() => {
      for (const [id, node] of tileNodes) {
        const position = state.board.flatMap((row, r) => row.map((tile, c) => tile?.id === id ? [r, c] : null)).find(Boolean);
        if (position) setTilePosition(node, position[0], position[1]);
      }
    });

    busy = true;
    renderPowerups();
    window.setTimeout(() => {
      if (state.board.flat().some(tile => tile?.spawn)) {
        const spawned = addRandomTile();
        if (spawned) spawned.spawn = true;
      } else addRandomTile();
      state.board.flat().forEach(tile => { if (tile) { tile.spawn = false; tile.merged = false; } });
      busy = false;
      if (!state.won && state.board.flat().some(tile => tile?.value === 2048)) {
        state.won = true; showOverlay('won');
      } else if (isGameOver()) showOverlay('over');
      render();
      saveGame();
    }, MOVE_MS + 15);
  }
  function isGameOver() {
    if (state.board.flat().some(tile => !tile)) return false;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (r < SIZE - 1 && state.board[r][c].value === state.board[r + 1][c].value) return false;
      if (c < SIZE - 1 && state.board[r][c].value === state.board[r][c + 1].value) return false;
    }
    return true;
  }
  function showOverlay(type) {
    overlayEl.hidden = false;
    const won = type === 'won';
    overlayIconEl.textContent = won ? '🎉' : '🌼';
    overlayTitleEl.textContent = won ? 'You made it!' : 'Lovely run!';
    overlayMessageEl.textContent = won ? 'You reached 2048. Want to keep going?' : 'The board is full. Fancy another round?';
    continueButton.hidden = !won;
    document.querySelector('#play-again').textContent = won ? 'New game' : 'Play again';
  }
  function confirmReset() {
    if (window.confirm('Start a new game? Your current board and score will be replaced.')) startNewGame();
  }
  function handleKey(event) {
    const key = event.key.toLowerCase();
    const directions = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
    if (directions[key]) { event.preventDefault(); move(directions[key]); }
  }

  document.querySelector('#reset').addEventListener('click', confirmReset);
  document.querySelector('#play-again').addEventListener('click', startNewGame);
  continueButton.addEventListener('click', () => { overlayEl.hidden = true; state.continued = true; saveGame(); });
  window.addEventListener('keydown', handleKey, { passive: false });
  shellEl.addEventListener('touchstart', event => {
    if (event.touches.length === 1) touchStart = [event.touches[0].clientX, event.touches[0].clientY];
  }, { passive: true });
  shellEl.addEventListener('touchend', event => {
    if (!touchStart || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - touchStart[0];
    const dy = event.changedTouches[0].clientY - touchStart[1];
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
  }, { passive: true });

  state = loadGame();
  if (!state.board.flat().some(Boolean)) { addRandomTile(); addRandomTile(); }
  render();
  if (state.won && !state.continued) showOverlay('won');
  else if (isGameOver()) showOverlay('over');
  saveGame();
})();
