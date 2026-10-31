# ඞ Among Us Real Life

Eine Web-App, um **Among Us im echten Leben** zu spielen – im Haus, Garten, Büro oder auf einer Party.
Ein Gerät (Laptop/PC) startet den Server, alle anderen Handys/Tablets verbinden sich einfach per Browser
über das WLAN. Keine App-Store-Installation nötig – funktioniert auf **Android, iPhone, Tablet und PC**
(optional „Zum Home-Bildschirm hinzufügen" für App-Gefühl).

## Funktionen

**Spieler-App** (`http://<IP>:3000/`)
- Mit Namen beitreten, Farbe wählen, automatische Wiederverbindung (auch nach Neuladen)
- Geheime Rollen-Anzeige (Crewmate / Impostor) – Impostor sehen ihre Komplizen
- Eigene Aufgabenliste mit Ort und Beschreibung, optional mit **Code-Prüfung** (Zettel am Aufgabenort)
- 📷 **Beweisfotos**: Bei Aufgaben mit Fotopflicht macht man beim Abhaken ein Foto mit der Handy-Kamera
- Gemeinsamer Aufgaben-Fortschrittsbalken
- 🚨 Leiche melden, 📣 Notfall-Meeting (begrenzt), 💀 „Ich wurde getötet"
- Impostor: 🔪 Opfer aus einer Liste auswählen (mit Cooldown, optional stirbt das Opfer erst nach
  einer einstellbaren Zeit), ☢️ Reaktor-Sabotage (alle Geräte schlagen Alarm, zufällig ausgeloste
  Crewmates müssen reparieren)
- Meetings mit Diskussion, Abstimmung (inkl. Überspringen) und Ergebnis
- Alarmton + Vibration bei Meetings, Sabotage und Tod; Bildschirm bleibt an

**Moderatoren-App** (`http://<IP>:3000/moderator`, mit PIN)
- **Spielerauswahl**: wer spielt mit, Impostor fest einteilen, umbenennen, entfernen
- **Aufgabenauswahl**: Katalog bearbeiten, Aufgaben an/aus, eigene Aufgaben mit Ort, Beschreibung & Code anlegen,
  „Standard-Aufgaben laden“ ersetzt den Katalog durch die 17 mitgelieferten Aufgaben
- **Beweisfotos**: pro Aufgabe „📷 Foto“ an/aus (oder für alle auf einmal). Im Tab „Spiel“ zeigt eine
  Galerie alle Fotos der Runde; ein abgelehntes Foto macht die Aufgabe beim Spieler wieder offen.
  Fotos werden verkleinert in `data/photos/` gespeichert und sind nur mit Moderator-PIN abrufbar.
- **Einstellungen**: Anzahl Impostor, Aufgaben pro Spieler, Kill-Cooldown, Verzögerung bis zum Tod,
  Diskussions-/Abstimmungszeit, Notfall-Meetings, anonyme Abstimmung, Rauswurf bestätigen,
  Sabotagen pro Runde, Anzahl ausgeloster Reparierer, Sabotage-Zeiten …
- **Demomodus**: Zum Ausprobieren oder Vorführen bekommen alle Platzhalter („Demo-Aufgabe 1“ …)
  statt der echten Aufgaben – auch bei der Reaktor-Reparatur. Alle Geräte zeigen ein DEMO-Abzeichen.
- **Meetings mit Sammelphase**: Nach dem Einberufen zeigen alle Handys „Alle zum Treffpunkt!“. Die
  Diskussion (und ihr Countdown) startet erst, wenn der Spielleiter „Diskussion starten“ tippt.
  Abschaltbar in den Einstellungen.
- Live-Übersicht: wer lebt, Rollen, Aufgaben-Fortschritt, Abstimmungen, Kill-Cooldowns
- Meetings einberufen/weiterschalten, Spieler tot/lebendig setzen, Sabotage beenden, Spiel beenden
- 📢 Nachrichten an alle Geräte, 📱 QR-Code zum Beitreten

**Live-Board** (`http://<IP>:3000/live`, mit PIN) – für PC, Beamer oder TV
- Lobby: großer QR-Code und alle beigetretenen Spieler
- Während des Spiels: Kennzahlen, Aufgaben-Fortschritt über die Zeit (mit Meeting-Markierungen),
  Spielerübersicht, Ereignis-Protokoll, Meeting-Verlauf, Sabotage-Countdown
- Meetings: Abstimmung als Live-Balkendiagramm mit den Abstimmenden, Rauswurf-Ergebnis
- Spielende: Sieger, Statistik (Dauer, Kills, Rauswürfe), fleißigste Crewmates
- Schalter **Publikumsmodus / Geheimnisse sichtbar**: Im Publikumsmodus sieht man keine Rollen,
  keine unentdeckten Leichen und die Stimmen erst nach der Abstimmung – sicher für einen Bildschirm,
  den alle sehen. Mit Geheimnissen sieht der Moderator alles live.

Tipp: Live-Board auf dem PC, Moderatoren-Ansicht zum Steuern auf dem Handy. Beide sind gleichzeitig nutzbar.

Aufgabenkatalog und Einstellungen werden in `data/config.json` gespeichert.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
npm install
npm start
```

Die Konsole zeigt die Adressen und den **Moderator-PIN**:

```
  Spieler:     http://192.168.0.23:3000/
  Moderator:   http://192.168.0.23:3000/moderator
  Live-Board:  http://192.168.0.23:3000/live   (auf diesem Rechner: http://localhost:3000/live)
  Moderator-PIN: 4821
```

**Windows ohne Terminal:** Doppelklick auf `starten.bat` startet den Server (beim ersten Mal wird
vorher automatisch installiert). `aktualisieren.bat` holt die neueste Version von GitHub – dafür das
Spiel einmal mit Git herunterladen statt als ZIP:

```bash
git clone https://github.com/moritzherrmann-ctrl/Among-us.git
```

Aufgaben und Einstellungen im Ordner `data/` bleiben beim Aktualisieren erhalten.

Eigener PIN oder Port: `MOD_PIN=1234 PORT=8080 npm start`

> Alle Geräte müssen im **gleichen WLAN** sein. Falls sich Handys nicht verbinden, die Firewall des
> Server-Rechners für Port 3000 freigeben.

## So wird gespielt

1. Moderator öffnet `/moderator`, meldet sich mit dem PIN an und zeigt den **QR-Code**.
2. Alle scannen den Code und treten mit ihrem Namen bei.
3. Moderator wählt Spieler, Aufgaben und Regeln und drückt **Spiel starten**.
4. Jeder sieht seine Rolle (Bildschirm verdecken!) und läuft zu seinen Aufgaben.
5. **Impostor** „töten" durch Antippen der Schulter und wählen danach im geheimen Bereich das Opfer
   aus der Liste – oder das Opfer drückt selbst *Ich wurde getötet*. Ist eine Verzögerung eingestellt,
   stirbt das Opfer erst nach dieser Zeit (sein Handy meldet es dann). Opfer bleiben liegen.
6. Wer eine Leiche findet, drückt **Leiche melden** → alle Handys klingeln → alle kommen zum
   Treffpunkt → der Spielleiter startet die Diskussion → diskutieren, abstimmen.
7. **Crew gewinnt**, wenn alle Aufgaben erledigt oder alle Impostor rausgeworfen sind.
   **Impostor gewinnen**, wenn sie so viele sind wie die Crew oder die Sabotage nicht rechtzeitig
   repariert wird. Bei einer Sabotage werden zufällig Crewmates ausgelost (Standard: 2). Jeder bekommt
   eine zufällige Aufgabe aus dem Aufgabenkatalog, die er erledigen muss (mit Code, falls die Aufgabe
   einen hat). Erst wenn alle ausgelosten ihre Aufgabe erledigt haben, ist der Reaktor repariert.
   Stirbt einer davon, übernimmt ein neu ausgeloster Crewmate seine Aufgabe.

## Entwicklung

```bash
npm test   # Tests der Spiellogik
```

- `server.js` – Webserver + Echtzeit-Kommunikation (Socket.IO)
- `src/game.js` – komplette Spiellogik (Rollen, Aufgaben, Meetings, Sabotage, Siegbedingungen)
- `public/` – Spieler- (`index.html`), Moderatoren- (`moderator.html`) und Live-Board-Oberfläche (`live.html`)
