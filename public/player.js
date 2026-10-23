(() => {
  const socket = io({ transports: ['websocket', 'polling'] });
  const app = document.getElementById('app');
  const LETTERS = ['A', 'B', 'C', 'D'];
  let token = null;
  try { token = localStorage.getItem('quiz_token'); } catch (e) {}
  let state = null, me = null, joinError = '', connected = false, replaced = false, clockOffset = 0;
  let lastKey = '', timerInt = null, pendingNick = '';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saveToken = t => { token = t; try { localStorage.setItem('quiz_token', t); } catch (e) {} };
  const clearToken = () => { token = null; try { localStorage.removeItem('quiz_token'); } catch (e) {} };
  const fmt = n => (n || 0).toLocaleString('pl-PL');

  // ---------- Połączenie ----------
  socket.on('connect', () => {
    connected = true; replaced = false;
    if (token) socket.emit('join', { token }, onJoin);
    render(true);
  });
  socket.on('disconnect', () => { connected = false; render(true); });
  socket.on('state', s => { state = s; clockOffset = Date.now() - s.now; render(); });
  socket.on('me', m => { me = m; render(); });
  socket.on('kicked', () => { me = null; clearToken(); joinError = 'Prowadzący usunął Cię z gry.'; render(true); });
  socket.on('replaced', () => { replaced = true; render(true); });

  function onJoin(res) {
    if (res.ok) { saveToken(res.token); joinError = ''; }
    else { me = null; if (!res.needNick || res.error) joinError = res.error || ''; if (res.needNick) clearToken(); }
    render(true);
  }
  function join(nick) {
    pendingNick = nick;
    socket.emit('join', { nick }, onJoin);
  }

  // ---------- Zegar ----------
  function startTimer() {
    stopTimer();
    timerInt = setInterval(tick, 100); tick();
  }
  function stopTimer() { if (timerInt) clearInterval(timerInt); timerInt = null; }
  function tick() {
    if (!state || state.phase !== 'question') return stopTimer();
    const left = Math.max(0, state.deadline - (Date.now() - clockOffset));
    const el = document.getElementById('t-left'); const bar = document.getElementById('t-bar');
    if (el) { el.textContent = Math.ceil(left / 1000); el.classList.toggle('low', left < 5000); }
    if (bar) { bar.firstElementChild.style.width = (100 * left / state.timeLimit) + '%'; bar.classList.toggle('low', left < 5000); }
  }

  // ---------- Render ----------
  function render(force) {
    const key = JSON.stringify([connected, replaced, !!me, state && state.phase, state && state.roundIdx, state && state.qIdx,
      me && me.answered, me && me.status, me && me.rank, me && me.roundScore, state && state.playerCount, joinError]);
    if (!force && key === lastKey) return;
    lastKey = key;

    let html = '';
    if (replaced) html = screenReplaced();
    else if (!me) html = screenJoin();
    else if (!state) html = screenWait('Łączenie…');
    else {
      switch (state.phase) {
        case 'lobby': html = screenLobby(); break;
        case 'question': html = screenQuestion(); break;
        case 'reveal': html = screenReveal(); break;
        case 'roundEnd': html = screenRoundEnd(); break;
        case 'gameOver': html = screenGameOver(); break;
        default: html = screenWait('Chwila…');
      }
    }
    app.innerHTML = html;
    bind();
    if (state && state.phase === 'question' && me) startTimer(); else stopTimer();
  }

  function top() {
    const conn = connected ? '' : '<span class="pill off">● brak połączenia</span>';
    const st = me && state ? (me.status === 'active' && me.rank ? `<span class="pill">#${me.rank} · ${fmt(me.roundScore)} pkt</span>` :
      me.status === 'out' ? `<span class="pill">miejsce ${me.place}</span>` : me.status === 'spectator' ? '<span class="pill">obserwujesz</span>' : '') : '';
    return `<div class="p-top"><span class="nick">${me ? esc(me.nick) : 'Quiz'}</span><span style="display:flex;gap:6px">${conn}${st}</span></div>`;
  }

  function screenJoin() {
    return `<div class="p-top"><span class="nick">Quiz</span>${connected ? '' : '<span class="pill off">● łączenie…</span>'}</div>
    <div class="p-main centered">
      <div class="p-icon">🏛️</div>
      <h1 class="p-title">Status prawny radnego gminy</h1>
      <p class="p-sub">Podaj swój nick i dołącz do gry</p>
      <form class="join-form" id="join" autocomplete="off">
        <input class="field" id="nick" name="nick" maxlength="20" placeholder="Twój nick" value="${esc(pendingNick)}" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go" required>
        ${joinError ? `<div class="error">${esc(joinError)}</div>` : ''}
        <button class="btn block" type="submit" ${connected ? '' : 'disabled'}>Dołącz do gry</button>
        <div class="join-hint">Nick zobaczą wszyscy na ekranie – max 20 znaków.</div>
      </form>
    </div>`;
  }

  function screenReplaced() {
    return `${top()}<div class="p-main centered"><div class="p-icon">📱</div><h1 class="p-title">Gra otwarta w innym oknie</h1>
    <p class="p-sub">Twoje konto jest aktywne w innej karcie lub na innym urządzeniu.</p>
    <button class="btn block" id="takeover">Graj tutaj</button></div>`;
  }

  function screenWait(t) { return `${top()}<div class="p-main centered"><div class="p-sub pulse">${esc(t)}</div></div>`; }

  function screenLobby() {
    const others = state.players.filter(p => p.connected);
    return `${top()}<div class="p-main centered fade">
      <div class="p-icon">✅</div>
      <h1 class="p-title">Jesteś w grze!</h1>
      <p class="p-sub">Patrz na ekran – prowadzący zaraz wystartuje.</p>
      <div class="lobby-count">${others.length}</div><div class="muted">${plural(others.length, 'gracz', 'graczy', 'graczy')} w poczekalni</div>
      <div class="chips">${others.slice(0, 40).map(p => `<span class="chip ${p.id === me.id ? 'me' : ''}">${esc(p.nick)}</span>`).join('')}</div>
      <button class="btn ghost small" id="leave">Zmień nick</button>
    </div>
    <div class="p-foot">Zasady: ${state.roundsTotal} rundy · do półfinału wchodzi 5 osób, do finału 2 · liczy się poprawność i szybkość</div>`;
  }

  function screenQuestion() {
    const q = state.question;
    const head = `<div class="q-head"><span>${esc(state.roundName)} · Pytanie ${state.qIdx + 1}/${state.qTotal}</span><span class="q-time" id="t-left">${Math.ceil(state.timeLimit / 1000)}</span></div>
      <div class="timebar" id="t-bar"><i></i></div>`;
    if (me.status !== 'active') {
      return `${top()}<div class="p-main">${head}<div class="q-text">${esc(q.text)}</div>
        <div class="card center"><div class="p-icon">👀</div><div class="p-sub">${me.status === 'out' ? `Odpadłeś/aś – zająłeś/aś miejsce ${me.place}. Kibicuj dalej!` : 'Gra już trwa – obserwujesz rozgrywkę.'}</div></div></div>`;
    }
    if (me.answered !== null && me.answered !== undefined) {
      return `${top()}<div class="p-main">${head}
        <div class="p-main centered">
          <div class="answer picked c${me.answered}" style="flex:0 0 auto;width:100%"><span class="ans-letter">${LETTERS[me.answered]}</span><span class="t">${esc(q.answers[me.answered])}</span></div>
          <div class="p-icon">⏳</div><h2 class="p-title" style="font-size:26px">Odpowiedź zapisana</h2><p class="p-sub pulse">Czekamy na pozostałych…</p>
        </div></div>`;
    }
    return `${top()}<div class="p-main">${head}
      <div class="q-text">${esc(q.text)}</div>
      <div class="answers">${q.answers.map((a, i) => `<button class="answer c${i}" data-i="${i}"><span class="ans-letter">${LETTERS[i]}</span><span class="t">${esc(a)}</span></button>`).join('')}</div>
    </div>`;
  }

  function screenReveal() {
    const q = state.question; const r = me.lastResult;
    if (me.status !== 'active') {
      return `${top()}<div class="p-main"><div class="q-head"><span>${esc(state.roundName)} · Pytanie ${state.qIdx + 1}/${state.qTotal}</span></div>
        <div class="q-text">${esc(q.text)}</div>
        <div class="answer correct c${state.correct}" style="flex:0 0 auto"><span class="ans-letter">${LETTERS[state.correct]}</span><span class="t">${esc(q.answers[state.correct])}</span><span class="mark">✓</span></div>
        <div class="muted center">Poprawna odpowiedź</div></div>`;
    }
    let cls = 'none', title = 'Brak odpowiedzi', icon = '⌛';
    if (r && r.answered) { cls = r.correct ? 'ok' : 'bad'; title = r.correct ? 'Dobrze!' : 'Źle'; icon = r.correct ? '🎉' : '❌'; }
    return `${top()}<div class="p-main">
      <div class="q-head"><span>${esc(state.roundName)} · Pytanie ${state.qIdx + 1}/${state.qTotal}</span></div>
      <div class="result ${cls}"><div style="font-size:44px">${icon}</div><div class="big">${title}</div><div class="pts">+${fmt(r ? r.points : 0)}</div><div>punktów</div></div>
      <div class="stats"><div class="stat"><b>#${me.rank}</b><span>miejsce z ${me.activeCount}</span></div><div class="stat"><b>${fmt(me.roundScore)}</b><span>pkt w rundzie</span></div></div>
      <div class="answer correct c${state.correct}" style="flex:0 0 auto"><span class="ans-letter">${LETTERS[state.correct]}</span><span class="t">${esc(q.answers[state.correct])}</span><span class="mark">✓</span></div>
      <div class="muted center" style="font-size:13px">Poprawna odpowiedź${r && r.answered && !r.correct ? ` · Ty: ${LETTERS[r.choice]}` : ''}</div>
    </div>`;
  }

  function screenRoundEnd() {
    const st = state.standings; const rows = st.rows;
    const mine = rows.find(x => x.id === me.id);
    let banner;
    if (!mine) banner = `<div class="banner out"><div class="t">Koniec rundy: ${esc(st.roundName)}</div><div class="s">${me.status === 'out' ? `Twoje miejsce: ${me.place}` : 'Obserwujesz rozgrywkę'}</div></div>`;
    else if (mine.advances) banner = `<div class="banner adv pop"><div style="font-size:44px">🚀</div><div class="t">Awansujesz!</div><div class="s">Miejsce ${mine.rank} w rundzie „${esc(st.roundName)}”. Przechodzisz do: <b>${esc(st.nextRoundName)}</b></div></div>`;
    else banner = `<div class="banner out pop"><div style="font-size:44px">🫡</div><div class="t">Koniec gry dla Ciebie</div><div class="s">Zająłeś/aś <b>${mine.rank}. miejsce</b> z ${fmt(mine.roundScore)} pkt. Dzięki za grę – kibicuj dalej!</div></div>`;
    return `${top()}<div class="p-main fade">${banner}
      <div class="muted" style="font-weight:700">Wyniki rundy · awansuje ${st.advance}</div>
      <ol class="rank-list">${rows.map(x => `<li class="${x.id === me.id ? 'me' : ''} ${x.advances ? 'adv' : 'out'}"><span class="n">${x.rank}</span><span class="nk">${esc(x.nick)}</span><span class="sc">${fmt(x.roundScore)}</span></li>`).join('')}</ol>
    </div>`;
  }

  function screenGameOver() {
    const fs = state.finalStandings || [];
    const mine = fs.find(x => x.id === me.id);
    let banner;
    if (mine && mine.place === 1) banner = `<div class="banner win pop"><div style="font-size:56px">🏆</div><div class="t">Wygrałeś/aś!</div><div class="s">Mistrz/Mistrzyni quizu o statusie radnego</div></div>`;
    else if (mine) banner = `<div class="banner ${mine.place <= 3 ? 'adv' : 'out'} pop"><div style="font-size:48px">${mine.place === 2 ? '🥈' : mine.place === 3 ? '🥉' : '🎓'}</div><div class="t">Miejsce ${mine.place}</div><div class="s">z ${fs.length} graczy. Dzięki za grę!</div></div>`;
    else banner = `<div class="banner out"><div class="t">Koniec quizu</div><div class="s">Dzięki za obecność!</div></div>`;
    return `${top()}<div class="p-main fade">${banner}
      <div class="muted" style="font-weight:700">Klasyfikacja końcowa</div>
      <ol class="rank-list">${fs.map(x => `<li class="${x.id === me.id ? 'me' : ''} ${x.place <= 3 ? 'adv' : ''}"><span class="n">${x.place}</span><span class="nk">${esc(x.nick)}</span><span class="sc">${fmt(x.total)}</span></li>`).join('')}</ol>
    </div>`;
  }

  function plural(n, a, b, c) { if (n === 1) return a; const m10 = n % 10, m100 = n % 100; if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return b; return c; }

  // ---------- Zdarzenia ----------
  function bind() {
    const form = document.getElementById('join');
    if (form) {
      const inp = document.getElementById('nick');
      form.addEventListener('submit', e => { e.preventDefault(); const v = inp.value.trim(); if (v.length < 2) { joinError = 'Nick musi mieć co najmniej 2 znaki.'; render(true); return; } join(v); });
      if (!('ontouchstart' in window)) inp.focus();
    }
    app.querySelectorAll('.answer[data-i]').forEach(b => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) {} }
        app.querySelectorAll('.answer[data-i]').forEach(x => { x.disabled = true; if (x !== b) x.classList.add('dim'); else x.classList.add('picked'); });
        socket.emit('answer', i);
      }, { once: true });
    });
    const leave = document.getElementById('leave');
    if (leave) leave.addEventListener('click', () => { socket.emit('leave'); me = null; pendingNick = ''; clearToken(); render(true); });
    const take = document.getElementById('takeover');
    if (take) take.addEventListener('click', () => { replaced = false; socket.emit('join', { token }, onJoin); });
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && !socket.connected) socket.connect(); });
  render(true);
})();
