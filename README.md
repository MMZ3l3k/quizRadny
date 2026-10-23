# Quiz na żywo – Status prawny radnego gminy

Quiz w stylu Kahoot: prowadzący wyświetla ekran na projektorze, uczestnicy skanują kod QR,
podają nick i odpowiadają na telefonach. Trzy rundy turniejowe:

| Runda       | Pytania | Awansuje |
|-------------|---------|----------|
| Eliminacje  | 1–7     | 5 osób   |
| Półfinał    | 8–12    | 2 osoby  |
| Finał       | 13–15   | zwycięzca |

Punktacja: poprawna odpowiedź = 500–1000 pkt (im szybciej, tym więcej), zła = 0.
Wynik liczy się osobno w każdej rundzie (po awansie start od zera). Remis rozstrzyga łączny czas odpowiedzi.

## Uruchomienie lokalne

```bash
npm install
HOST_PIN=1234 npm start
```

- Gracze: `http://localhost:3000/`
- Prowadzący: `http://localhost:3000/host` (poda PIN z `HOST_PIN`)
- Test z botami: `npm run simulate -- http://localhost:3000 30`

## Wdrożenie na Railway (krok po kroku)

1. Wrzuć projekt na GitHub:
   ```bash
   git add -A && git commit -m "Quiz radnego" && git branch -M main
   git remote add origin https://github.com/TWOJ_LOGIN/quizRadny.git && git push -u origin main
   ```
2. Na [railway.app](https://railway.app): **New Project → Deploy from GitHub repo** → wybierz repo.
   Railway sam wykryje Node.js i uruchomi `npm start`.
3. W zakładce **Variables** dodaj:
   - `HOST_PIN` = własny PIN prowadzącego (np. `7351`) – **koniecznie**, inaczej domyślny `1234`
   - opcjonalnie `TIME_LIMIT` = sekundy na pytanie (domyślnie 20)
4. W **Settings → Networking → Generate Domain** wygeneruj publiczny adres, np. `quiz-radny.up.railway.app`.
5. Otwórz `https://TWOJ-ADRES.up.railway.app/host`, wpisz PIN – zobaczysz poczekalnię z kodem QR.

### Kod QR do prezentacji

- Gotowy obrazek: `https://TWOJ-ADRES.up.railway.app/qr.png` (PNG 1200 px) – wstaw go na slajd.
- Kod QR prowadzi na stronę główną (`/`), gdzie uczestnik wpisuje nick.
- Jeśli serwer stoi za innym adresem niż ten, z którego otwierasz `/host`, ustaw zmienną `PUBLIC_URL`.

## Prowadzenie quizu

1. Wyświetl `/host` na projektorze (pełny ekran – F11). Uczestnicy skanują QR i podają nick.
2. **Start** – rusza pierwsze pytanie. Czas leci 20 s; odsłonięcie następuje automatycznie po czasie
   albo gdy wszyscy odpowiedzą. Można też wcisnąć **Zakończ odpowiadanie**.
3. Po odsłonięciu widać poprawną odpowiedź, rozkład odpowiedzi i ranking rundy. **Następne pytanie** (albo Spacja / →).
4. Po ostatnim pytaniu rundy – tabela i oznaczenie, kto awansuje. Wyeliminowani widzą swoje miejsce
   na telefonie i mogą dalej obserwować.
5. Po finale – podium i klasyfikacja końcowa. **Nowa gra** zeruje wyniki (z zachowaniem graczy lub bez).

Uwagi:
- Osoby, które dołączą w trakcie eliminacji, grają dalej (pominięte pytania = 0 pkt). Po eliminacjach nowe osoby są tylko obserwatorami.
- Odświeżenie strony na telefonie nie wyrzuca gracza (sesja zapamiętana w przeglądarce).
- Prowadzący może usunąć gracza w poczekalni (×) przy nicku.

## Zmiana pytań

Edytuj `questions.json`: każda runda ma `name`, `advance` (ile osób awansuje) i listę `questions`
z polami `text`, `answers` (4 odpowiedzi) i `correct` (indeks 0–3 poprawnej). Liczbę rund i pytań
w rundzie można dowolnie zmienić.

## Dlaczego nie GitHub Pages?

GitHub Pages serwuje tylko statyczne pliki. Gra na żywo wymaga serwera (WebSockety, wspólny stan gry),
dlatego hostowanie jest na Railway, a GitHub służy jako repozytorium kodu.
