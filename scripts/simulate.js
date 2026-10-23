// Symulacja N botów-graczy do testów: node scripts/simulate.js [url] [liczba]
const { io } = require('socket.io-client');
const URL = process.argv[2] || 'http://localhost:3000';
const N = Number(process.argv[3] || 30);
const NICKS = ['Ania', 'Bartek', 'Celina', 'Darek', 'Ewa', 'Filip', 'Gosia', 'Hubert', 'Iga', 'Jacek', 'Kasia', 'Leon', 'Marta', 'Norbert', 'Ola', 'Piotr', 'Rafał', 'Sylwia', 'Tomek', 'Ula', 'Wiktor', 'Zosia', 'Adam', 'Beata', 'Czarek', 'Dorota', 'Emil', 'Franek', 'Grzesiek', 'Hania'];
let joined = 0;
for (let i = 0; i < N; i++) {
  const nick = NICKS[i % NICKS.length] + (i >= NICKS.length ? i : '');
  const s = io(URL, { transports: ['websocket'] });
  let answeredKey = null;
  s.on('connect', () => s.emit('join', { nick }, res => { if (res.ok) { joined++; if (joined === N) console.log(`${N} botów dołączyło`); } else console.log(nick, res); }));
  s.on('state', st => {
    if (st.phase !== 'question') return;
    const key = st.roundIdx + '-' + st.qIdx;
    if (answeredKey === key) return;
    answeredKey = key;
    const delay = 500 + Math.random() * Math.min(8000, st.timeLimit - 1000);
    setTimeout(() => s.emit('answer', Math.floor(Math.random() * 4)), delay);
  });
}
