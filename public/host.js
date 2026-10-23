(() => {
  const socket = io({ transports: ['websocket', 'polling'] });
  const app = document.getElementById('app');
  const LETTERS = ['A', 'B', 'C', 'D'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n || 0).toLocaleString('pl-PL');
  const params = new URLSearchParams(location.search);
  let pin = params.get('pin') || '';
  try { pin = pin || sessionStorage.getItem('quiz_pin') || ''; } catch (e) {}
  if (params.get('pin')) history.replaceState(null, '', location.pathname);
  let authed = false, pinError = '', state = null, joinUrlText = '', clockOffset = 0, timerInt = null, lastKey = '', confirmReset = false, busy = false;

  fetch('/join-url').then(r => r.json()).then(j => { joinUrlText = j.url; render(true); }).catch(() => {});

  socket.on('connect', () => { if (pin) auth(pin); else render(true); });
  socket.on('disconnect', () => { authed = false; render(true); });
  socket.on('state', s => { state = s; clockOffset = Date.now() - s.now; render(); });

  function auth(p) {
    socket.emit('host:auth', p, res => {
      authed = !!res.ok; pinError = res.ok ? '' : 'Nieprawidłowy PIN.';
      if (res.ok) { pin = p; try { sessionStorage.setItem('quiz_pin', p); } catch (e) {} }
      render(true);
    });
  }
  function next() { if (busy) return; busy = true; socket.emit('host:next', res => { busy = false; if (res && !res.ok) { alert(res.error); } }); setTimeout(() => busy = false, 600); }

  // ---------- Zegar ----------
  function tick() {
    if (!state || state.phase !== 'question') return;
    const left = Math.max(0, state.deadline - (Date.now() - clockOffset));
    const el = document.getElementById('h-timer');
    if (el) { el.style.setProperty('--p', 100 * left / state.timeLimit); el.querySelector('b').textContent = Math.ceil(left / 1000); el.classList.toggle('low', left < 5000); }
  }
  function syncTimer() { if (state && state.phase === 'question') { if (!timerInt) timerInt = setInterval(tick, 100); tick(); } else if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  // ---------- Render ----------
  function render(force) {
    const key = JSON.stringify([authed, pinError, socket.connected, joinUrlText, confirmReset, state && [state.phase, state.roundIdx, state.qIdx, state.answered, state.playerCount, state.players.map(p => p.id + p.connected).join()]]);
    if (!force && key === lastKey) { syncTimer(); return; }
    lastKey = key;
    if (!authed) app.innerHTML = screenPin();
    else if (!state) app.innerHTML = '<div class="pin-box center muted pulse">Łączenie…</div>';
    else {
      const body = { lobby: screenLobby, question: screenQuestion, reveal: screenReveal, roundEnd: screenRoundEnd, gameOver: screenGameOver }[state.phase]();
      app.innerHTML = `${topBar()}<div class="h-main">${body}</div>${footer()}${confirmReset ? overlayReset() : ''}`;
    }
    bind(); syncTimer();
  }

  function screenPin() {
    return `<form class="pin-box" id="pinform"><h1>Ekran prowadzącego</h1><p class="muted">Podaj PIN prowadzącego (zmienna HOST_PIN na serwerze).</p>
      <input class="field" id="pin" type="password" inputmode="numeric" placeholder="PIN" autocomplete="off" value="">
      ${pinError ? `<div class="error">${esc(pinError)}</div>` : ''}
      <button class="btn block" type="submit">Zaloguj</button>
      ${socket.connected ? '' : '<div class="muted center">Łączenie z serwerem…</div>'}</form>`;
  }

  function topBar() {
    const s = state;
    const where = s.phase === 'lobby' ? 'Poczekalnia' : s.phase === 'gameOver' ? 'Koniec gry' : `${s.roundName} · runda ${s.roundIdx + 1}/${s.roundsTotal}`;
    return `<div class="h-top"><div class="brand">🏛️ ${esc(s.title)}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="tag">${esc(where)}</span><span class="tag">👥 ${s.activeCount} w grze · ${s.playerCount} ogółem</span>${socket.connected ? '' : '<span class="tag" style="color:#ffb4b4">brak połączenia</span>'}</div></div>`;
  }

  function footer() {
    const s = state; let main = '', hint = '';
    switch (s.phase) {
      case 'lobby': main = `<button class="btn" id="next" ${s.activeCount ? '' : 'disabled'}>▶ Start: ${esc(s.roundName)}</button>`; hint = 'Spacja / → = dalej'; break;
      case 'question': main = `<button class="btn ghost" id="reveal">⏹ Zakończ odpowiadanie</button>`; hint = 'Odsłonięcie następuje automatycznie po czasie lub gdy wszyscy odpowiedzą'; break;
      case 'reveal': main = `<button class="btn" id="next">${s.qIdx + 1 < s.qTotal ? '▶ Następne pytanie' : '🏁 Wyniki rundy'}</button>`; hint = 'Spacja / → = dalej'; break;
      case 'roundEnd': main = `<button class="btn" id="next">▶ Start: ${esc(s.standings.nextRoundName)}</button>`; hint = 'Spacja / → = dalej'; break;
      case 'gameOver': main = ''; break;
    }
    return `<div class="h-foot"><div class="left"><button class="btn ghost small" id="resetbtn">↺ Nowa gra</button><span class="hint">${hint}</span></div><div>${main}</div></div>`;
  }

  function screenLobby() {
    const s = state;
    const on = s.players.filter(p => p.connected), off = s.players.filter(p => !p.connected);
    return `<div class="lobby fade">
      <div><div class="qr"><img src="/qr" alt="Kod QR do dołączenia"></div><div class="url">${esc(joinUrlText.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div><div class="how">Zeskanuj kod lub wpisz adres · podaj nick · czekaj na start</div></div>
      <div style="display:flex;flex-direction:column;gap:18px">
        <h1>${esc(s.title)}</h1>
        <div class="muted" style="font-size:1.15em">${s.roundsTotal} rundy: Eliminacje → Półfinał (5 osób) → Finał (2 osoby). Punkty za poprawność i szybkość (500–1000 pkt).</div>
        <div><div class="count">${on.length}</div><div class="muted">graczy w poczekalni</div></div>
        <div class="chips">${on.map(p => `<span class="chip">${esc(p.nick)}<button title="Usuń gracza" data-kick="${p.id}">×</button></span>`).join('')}${off.map(p => `<span class="chip off">${esc(p.nick)} (rozłączony)<button data-kick="${p.id}">×</button></span>`).join('')}
          ${s.players.length ? '' : '<span class="muted">Jeszcze nikogo nie ma – czekamy…</span>'}</div>
      </div></div>`;
  }

  function qBar(showTimer) {
    const s = state;
    return `<div class="q-bar"><span class="round">${esc(s.roundName)}</span><span class="num">Pytanie ${s.qIdx + 1} / ${s.qTotal}</span><span class="spacer"></span>
      <span class="answered">✋ ${s.answered} / ${s.activeCount}</span>${showTimer ? `<div class="timer" id="h-timer" style="--p:100"><b>${Math.ceil(s.timeLimit / 1000)}</b></div>` : ''}</div>`;
  }

  function screenQuestion() {
    const q = state.question;
    return `<div class="question">${qBar(true)}<div class="q-card">${esc(q.text)}</div>
      <div class="h-answers">${q.answers.map((a, i) => `<div class="h-ans c${i}"><span class="ans-letter">${LETTERS[i]}</span><span class="t">${esc(a)}</span></div>`).join('')}</div></div>`;
  }

  function screenReveal() {
    const s = state, q = s.question, total = Math.max(1, s.answered);
    return `<div class="question">${qBar(false)}<div class="q-card">${esc(q.text)}</div>
      <div class="reveal-layout">
        <div class="h-answers" style="grid-template-columns:1fr">${q.answers.map((a, i) => `<div class="h-ans c${i} ${i === s.correct ? 'correct' : 'dim'}"><span class="ans-letter">${LETTERS[i]}</span><span class="t">${esc(a)}</span>${i === s.correct ? '<span style="font-size:1.4em">✓</span>' : ''}<span class="cnt">${s.counts[i]}</span><div class="barwrap"><i data-w="${100 * s.counts[i] / total}"></i></div></div>`).join('')}</div>
        <div class="board"><h3>Ranking rundy</h3>${s.leaderboard.map(r => `<div class="row"><span class="n">${r.rank}.</span><span class="nk">${esc(r.nick)}</span>${r.delta ? `<span class="d">+${fmt(r.delta)}</span>` : ''}<span class="sc">${fmt(r.roundScore)}</span></div>`).join('')}
          ${s.leaderboard.length === 0 ? '<div class="muted">brak graczy</div>' : ''}</div>
      </div></div>`;
  }

  function screenRoundEnd() {
    const st = state.standings;
    return `<div class="standings fade"><h1>Koniec rundy: ${esc(st.roundName)}</h1>
      <div class="sub">Do rundy <b>${esc(st.nextRoundName)}</b> awansuje <b>${st.advance}</b> ${st.advance === 1 ? 'osoba' : 'osób'}</div>
      <div class="table">${st.rows.map(r => `<div class="row ${r.advances ? 'adv' : 'out'}"><span class="n">${r.rank}.</span><span class="nk">${esc(r.nick)}</span>${r.advances ? '<span class="badge">AWANS</span>' : ''}<span class="sc">${fmt(r.roundScore)}</span></div>`).join('')}</div></div>`;
  }

  function screenGameOver() {
    const fs = state.finalStandings || [];
    const p = n => fs.find(x => x.place === n);
    const box = (n, cls, medal) => p(n) ? `<div class="p ${cls} pop"><div class="pl">${medal}</div><div class="nk">${esc(p(n).nick)}</div><div class="muted" style="color:rgba(255,255,255,.85)">${fmt(p(n).total)} pkt łącznie</div></div>` : '<div></div>';
    return `<div class="standings fade"><h1>🏆 Koniec quizu!</h1>
      <div class="podium">${box(2, 'p2', '🥈')}${box(1, 'p1', '🥇')}${box(3, 'p3', '🥉')}</div>
      <div class="sub">Klasyfikacja końcowa</div>
      <div class="table">${fs.map(r => `<div class="row ${r.place <= 3 ? 'adv' : ''}"><span class="n">${r.place}.</span><span class="nk">${esc(r.nick)}</span><span class="sc">${fmt(r.total)}</span></div>`).join('')}</div></div>`;
  }

  function overlayReset() {
    return `<div class="overlay"><div class="card"><h2>Rozpocząć nową grę?</h2><p class="muted">Wyniki zostaną wyzerowane. Połączeni gracze wrócą do poczekalni z tymi samymi nickami.</p>
      <button class="btn danger block" id="reset-keep">Nowa gra – zachowaj graczy</button>
      <button class="btn ghost block" id="reset-all">Nowa gra – usuń wszystkich</button>
      <button class="btn ghost block" id="reset-cancel">Anuluj</button></div></div>`;
  }

  // ---------- Zdarzenia ----------
  function bind() {
    const pf = document.getElementById('pinform');
    if (pf) { pf.addEventListener('submit', e => { e.preventDefault(); auth(document.getElementById('pin').value.trim()); }); document.getElementById('pin').focus(); }
    const n = document.getElementById('next'); if (n) n.addEventListener('click', next);
    const r = document.getElementById('reveal'); if (r) r.addEventListener('click', () => socket.emit('host:reveal'));
    const rb = document.getElementById('resetbtn'); if (rb) rb.addEventListener('click', () => { confirmReset = true; render(true); });
    const rk = document.getElementById('reset-keep'); if (rk) rk.addEventListener('click', () => { socket.emit('host:reset', { keepPlayers: true }); confirmReset = false; render(true); });
    const ra = document.getElementById('reset-all'); if (ra) ra.addEventListener('click', () => { socket.emit('host:reset', { keepPlayers: false }); confirmReset = false; render(true); });
    const rc = document.getElementById('reset-cancel'); if (rc) rc.addEventListener('click', () => { confirmReset = false; render(true); });
    app.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => socket.emit('host:kick', b.dataset.kick)));
    requestAnimationFrame(() => app.querySelectorAll('.barwrap i[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; }));
  }
  document.addEventListener('keydown', e => {
    if (!authed || !state || confirmReset || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter') { e.preventDefault(); if (state.phase === 'question') socket.emit('host:reveal'); else next(); }
  });
  render(true);
})();
