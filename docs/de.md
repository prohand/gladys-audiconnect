# Audi Connect

Verfolge deine Audi in Gladys: Akku und Laden, Kraftstoff, Reichweite, Kilometerstand,
Verriegelung, Türen und Fenster, Klimatisierung und Parkposition. Starte oder stoppe Laden und
Klimatisierung, setze das Ladeziel, ver- und entriegle — aus Gladys, einer Szene oder dem
Dashboard.

Die Integration liest die Audi-Cloud (myAudi): dieselben Daten wie die myAudi-App.

## Bevor du beginnst

- Ein **myAudi-Konto** mit deinem Fahrzeug und aktiven Audi connect Diensten (wie in der
  myAudi-App).
- Ein in **Europa** oder **Kanada** erstelltes Konto. Konten aus den USA und China werden nicht
  unterstützt.
- Optional: deine **S-PIN** (4-stellige Sicherheits-PIN von myAudi), nur zum Ver- und
  Entriegeln aus Gladys.
- Manche Werte und Befehle hängen vom Fahrzeug und seinem connect-Vertrag ab: Ein Fahrzeug, das
  einen Wert nicht meldet, bekommt dafür einfach keine Funktion.

## Konfiguration

1. Öffne den Tab **Konfiguration** der Integration.
2. Wähle deinen **Markt**: Europa (alle europäischen Länder) oder Kanada. Speichern.
3. Klicke neben **myAudi-Konto** auf **Verbinden**. Eine Audi-Seite öffnet sich: Melde dich mit
   deinem myAudi-Konto an und bestätige den angezeigten Code. Die Konfigurationsseite zeigt
   denselben Code, während sie wartet (höchstens 10 Minuten).
4. Nach der Bestätigung wechselt der Status auf verbunden und deine Fahrzeuge erscheinen im Tab
   **Erkennung**: Füge sie hinzu.
5. Optional: Trage deine **S-PIN** ein, um aus Gladys zu ver- und entriegeln.
6. Optional: Ändere das **Aktualisierungsintervall**, standardmäßig 15 Minuten (5 Minuten bis
   1 Stunde).

Warum kein Passwort? Audi lässt Drittanbieter-Apps nicht mehr per Passwort anmelden. Die
Anmeldung auf der Audi-Seite ist die Methode, die Audi noch akzeptiert. Die Integration behält
die Anmeldung (ein Token, von Gladys gespeichert, nie angezeigt) und erneuert sie selbst: Du
verbindest dich nur einmal.

## Was jedes Fahrzeug zeigt

| Funktion                     | Fahrzeuge            | Steuerung                       |
| ---------------------------- | -------------------- | ------------------------------- |
| Kilometerstand               | alle                 |                                 |
| Akkustand                    | Elektro und Hybrid   |                                 |
| Elektrische Reichweite       | Elektro und Hybrid   |                                 |
| Reichweite                   | Benzin, Diesel, PHEV |                                 |
| Tankfüllstand                | Benzin, Diesel, PHEV |                                 |
| Laden                        | Elektro und Hybrid   | starten / stoppen               |
| Angesteckt                   | Elektro und Hybrid   |                                 |
| Ladeleistung                 | Elektro und Hybrid   |                                 |
| Restladezeit                 | Elektro und Hybrid   |                                 |
| Ladeziel                     | Elektro und Hybrid   | 20 bis 100 %                    |
| Klimatisierung               | wenn unterstützt     | starten / stoppen               |
| Klimatemperatur              | wenn unterstützt     | beim nächsten Start verwendet   |
| Verriegelt                   | alle                 | ver- / entriegeln (S-PIN nötig) |
| Tür offen, Fenster offen     | alle                 |                                 |
| Service fällig in (Tage, km) | wenn gemeldet        | negativ bei Überfälligkeit      |
| Parkposition                 | wenn geteilt         | Breite, Länge                   |

Ein Badge an jedem Fahrzeug zeigt **Cloud**, wenn die letzte Abfrage geklappt hat, **nicht
erreichbar**, wenn sie fehlgeschlagen ist.

Befehle brauchen Zeit: Das Fahrzeug erhält den Befehl über die Audi-Cloud und führt ihn innerhalb
einer Minute aus. Gladys zeigt den neuen Zustand, sobald das Fahrzeug ihn bestätigt hat, und das
Fahrzeug wird 20 Sekunden später erneut gelesen.

## Schaltflächen der Konfiguration

- **Verbindung testen**: meldet sich erneut an, listet deine Fahrzeuge und die heute
  verbleibenden Aufrufe.
- **Fahrzeug jetzt aktualisieren**: liest ein Fahrzeug sofort. Kreuze **Fahrzeug aufwecken** an,
  um frische Werte beim Fahrzeug selbst abzufragen (bis zu 2 Minuten; das belastet die
  12-V-Batterie, also nicht zu oft).
- **Lichter blinken lassen**: Das Fahrzeug blinkt 10 Sekunden, um es auf einem Parkplatz zu
  finden (benötigt seine Parkposition).

## Szenen

Die Integration fügt dem Szenen-Editor eigene Karten hinzu (Gladys 5.1 oder neuer).

Auslöser:

- **Ladezustand geändert**: lädt, beendet (Ziel erreicht), lädt nicht, Fehler. Filtere nach
  Fahrzeug und neuem Zustand. Variablen: Fahrzeugname, Zustand, Akkustand, Reichweite.
- **Fahrzeug ver- oder entriegelt**: Der Verriegelungszustand hat sich zwischen zwei Abfragen
  geändert. Variablen: Fahrzeugname, Zustand (`locked` / `unlocked`).
- **Ein Fahrzeugbefehl ist fehlgeschlagen**: Das Fahrzeug oder die Audi-Cloud hat einen Befehl
  abgelehnt (Verriegeln, Laden, Klima…). Variablen: Fahrzeugname, Befehl, Grund
  (`spin_missing`, `spin_refused`, `failed`, `error`…), Meldung.

Aktionen:

- **Klimatisierung eines Fahrzeugs starten**, mit optionaler Temperatur (16 bis 30 °C; leer: die
  Einstellungen des Fahrzeugs). Ausgaben: Start angenommen, vom Fahrzeug bestätigt.
- **Klimatisierung eines Fahrzeugs stoppen**. Ausgaben: Stopp angenommen, vom Fahrzeug bestätigt.
- **Fahrzeug jetzt lesen**, optional mit Aufwecken. Ausgaben: Akkustand, Reichweite,
  Tankfüllstand, Kilometerstand, verriegelt, lädt, angesteckt, Klimatisierung an — nutzbar in
  den nächsten Aktionen.

Beispiel: „werktags um 7:30, wenn der Akku unter 30 % ist, Laden starten; um 7:45 die
Klimatisierung auf 21 °C starten“.

## Dashboard

Füge das Widget **Audi-Fahrzeug** hinzu und wähle das Fahrzeug (leer: das erste). Es zeigt live
die Akku- (oder Tank-)Anzeige, Reichweite und Kilometerstand, Verriegelung, Türen und Fenster,
Laden und Klima, die Zeit der letzten Meldung und Schaltflächen: aktualisieren, Klima
starten/stoppen, verriegeln (nie entriegeln aus einem Dashboard) und einen Kartenlink zur
Parkposition.

## Grenzen

- Audi begrenzt die Anzahl der Aufrufe pro Konto und Tag. Jede Abfrage eines Fahrzeugs kostet
  zwei Aufrufe: Bleib bei mehreren Fahrzeugen bei 15 Minuten oder mehr. **Verbindung testen**
  zeigt die heute verbleibenden Aufrufe.
- Die Werte sind die, die das Fahrzeug zuletzt an die Cloud geschickt hat. Ein geparktes,
  schlafendes Fahrzeug sendet nichts: Nutze **Fahrzeug aufwecken**, wenn du frische Werte
  brauchst.

## Fehlerbehebung

- **„Noch kein myAudi-Konto verbunden“**: Klicke auf **Verbinden** und bestätige den Code auf der
  Audi-Seite.
- **„Audi hat die gespeicherte Anmeldung abgelehnt“**: Die Verbindung wurde widerrufen (Passwort
  in myAudi geändert, Konto gelöscht…). Klicke erneut auf **Verbinden**.
- **Ver- oder Entriegeln schlägt fehl** mit `spin_missing` / `spin_refused`: Trage die richtige
  S-PIN ein.
- **Ein Wert fehlt**: Das Fahrzeug meldet ihn nicht, oder der Dienst gehört nicht zu seinem
  connect-Vertrag. Prüfe es in der myAudi-App.
- Schalte in der Konfiguration **Detaillierte Protokolle** ein, reproduziere das Problem und lies
  dann die Protokolle der Integration. E-Mail, Passwörter, Tokens und die S-PIN werden nie
  protokolliert.
