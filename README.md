# ඞ Among Us Real Life

Eine Web-App, um **Among Us im echten Leben** zu spielen – im Haus, Garten, Büro oder auf einer Party.
Ein Gerät (Laptop/PC) startet den Server, alle anderen Handys/Tablets verbinden sich einfach per Browser
über das WLAN. Keine App-Store-Installation nötig – funktioniert auf **Android, iPhone, Tablet und PC**
(optional „Zum Home-Bildschirm hinzufügen" für App-Gefühl).

## Funktionen

**Spieler-App** (`http://<IP>:3000/`)
- Mit Namen beitreten, Farbe wählen, automatische Wiederverbindung (auch nach Neuladen)
- Geheime Rollen-Anzeige (Crewmate / Impostor) – Impostor sehen ihre Komplizen
- Eigene Aufgabenliste mit Ort, optional mit **Code-Prüfung** (Zettel am Aufgabenort)
- Gemeinsamer Aufgaben-Fortschrittsbalken
- 🚨 Leiche melden, 📣 Notfall-Meeting (begrenzt), 💀 „Ich wurde getötet"
- Impostor: 🔪 Töten mit Cooldown, ☢️ Reaktor-Sabotage (alle Geräte schlagen Alarm)
- Meetings mit Diskussion, Abstimmung (inkl. Überspringen) und Ergebnis
- Alarmton + Vibration bei Meetings, Sabotage und Tod; Bildschirm bleibt an

**Moderatoren-App** (`http://<IP>:3000/moderator`, mit PIN)
- **Spielerauswahl**: wer spielt mit, Impostor fest einteilen, umbenennen, entfernen
- **Aufgabenauswahl**: Katalog bearbeiten, Aufgaben an/aus, eigene Aufgaben mit Ort & Code anlegen
- **Einstellungen**: Anzahl Impostor, Aufgaben pro Spieler, Kill-Cooldown, Diskussions-/Abstimmungszeit,
  Notfall-Meetings, anonyme Abstimmung, Rauswurf bestätigen, Sabotage-Zeiten …
- Live-Übersicht: wer lebt, Rollen, Aufgaben-Fortschritt, Abstimmungen, Kill-Cooldowns
- Meetings einberufen/weiterschalten, Spieler tot/lebendig setzen, Sabotage beenden, Spiel beenden
- 📢 Nachrichten an alle Geräte, 📱 QR-Code zum Beitreten

Aufgabenkatalog und Einstellungen werden in `data/config.json` gespeichert.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
npm install
npm start
```

Die Konsole zeigt die Adressen und den **Moderator-PIN**:

```
  Spieler:    http://192.168.0.23:3000/
  Moderator:  http://192.168.0.23:3000/moderator
  Moderator-PIN: 4821
```

Eigener PIN oder Port: `MOD_PIN=1234 PORT=8080 npm start`

> Alle Geräte müssen im **gleichen WLAN** sein. Falls sich Handys nicht verbinden, die Firewall des
> Server-Rechners für Port 3000 freigeben.

## So wird gespielt

1. Moderator öffnet `/moderator`, meldet sich mit dem PIN an und zeigt den **QR-Code**.
2. Alle scannen den Code und treten mit ihrem Namen bei.
3. Moderator wählt Spieler, Aufgaben und Regeln und drückt **Spiel starten**.
4. Jeder sieht seine Rolle (Bildschirm verdecken!) und läuft zu seinen Aufgaben.
5. **Impostor** „töten" durch Antippen der Schulter und drücken danach im geheimen Bereich auf
   *Töten* – oder das Opfer drückt selbst *Ich wurde getötet*. Opfer bleiben liegen.
6. Wer eine Leiche findet, drückt **Leiche melden** → alle Handys klingeln → Treffen am Treffpunkt,
   diskutieren, abstimmen.
7. **Crew gewinnt**, wenn alle Aufgaben erledigt oder alle Impostor rausgeworfen sind.
   **Impostor gewinnen**, wenn sie so viele sind wie die Crew oder die Sabotage nicht rechtzeitig
   repariert wird (dafür müssen verschiedene Spieler am „Reaktor" auf *Reparieren* drücken).

## Entwicklung

```bash
npm test   # Tests der Spiellogik
```

- `server.js` – Webserver + Echtzeit-Kommunikation (Socket.IO)
- `src/game.js` – komplette Spiellogik (Rollen, Aufgaben, Meetings, Sabotage, Siegbedingungen)
- `public/` – Spieler- (`index.html`) und Moderatoren-Oberfläche (`moderator.html`)
