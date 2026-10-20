# tractor Extraction Lab

Fünf Browser-Demos mit synthetischen deutschen Texten für **tractor**, das System One Extraction Model. Die Oberfläche ruft die einzige öffentliche Extraktions-API `POST /v1/extract` auf und vergleicht das **finale Ergebnis nach Extraktion, Parsing, Prüfung und Normalisierung** mit unabhängig geschriebenen Sollwerten. Ein optionales LLM bearbeitet dieselben Aufgaben mit striktem JSON-Schema.

Keine npm-Pakete, keine Datenbank, kein Build-Schritt. Node.js ab 22.9 oder Docker.

## Schnell starten

```bash
cp .env.example .env     # TRACTOR_URL eintragen
npm start                # http://localhost:3000
```

`TRACTOR_URL` ist die Basis-URL eines laufenden `tractor serve` (ohne `/v1/extract`). Ohne Wert startet die Datenvorschau; Messungen bleiben gesperrt. Es gibt keine simulierten Antworten. **Verbindung prüfen** sendet einen echten Extraktionsaufruf.

```bash
docker compose up --build -d   # liest .env; tractor auf dem Host: http://host.docker.internal:8000
```

## Was die Demo zeigt

Kern ist die **Geschwindigkeit**: Text rein, typisierte und geprüfte Felder raus, in Millisekunden.

- **Einzelextraktion:** Beispiel anklicken (oder eigenen Text und eigenes Schema eingeben). Oben steht die gemessene Laufzeit mit Stufenbalken aus `Server-Timing` (Warteschlange, Vorverarbeitung, Modell, Normalisierung, Netz). Mit „gegen LLM antreten“ laufen beide Systeme live gegeneinander, inklusive „×N schneller“.
- **Speed-Run:** Alle 27 Dokumente aus fünf Demos nacheinander. tractor und LLM haben je eine Spalte; jede einzelne Extraktion erscheint mit Laufzeit, ✓/✗, Werten und Befunden, sobald sie fertig ist. Die Stoppuhr beginnt nach dem Warm-up.
- **Demos:** Rechnungen, Mengen und Einheiten, Kontaktdaten, mehrere Datensätze, Ablehnen statt raten (ungültige Prüfsummen, widersprüchliche Beträge, relative Fristen).

27 Fälle, alle synthetisch. Einzelne sind bewusst Grenzfälle (z. B. Rechnungs- neben Kundennummer); Abweichungen werden ausgewiesen, nicht versteckt.

## Wie bewertet wird

- Verglichen werden finale Feldwerte, Zahlen nach Wert, Text exakt. Geprüfte Alternativen (`accept`) liegen nur in `data/scenarios.mjs`, nie in der Inferenz.
- **Positive Felder** und **korrekte Ablehnungen** (erwartet `null`) werden getrennt gezählt. Bei tractor muss zusätzlich der erwartete Befundcode stimmen; das LLM liefert keine Befunde und wird nur an den Daten gemessen.
- Ein fehlgeschlagener Aufruf zählt als falsch, auch bei erwarteter Ablehnung.
- Die Trefferquote ist **keine Benchmarkzahl** und sagt nichts über Realdaten.
- Das LLM erhält dieselben Texte und Feldregeln (Zieleinheit, Währung, Datumsreihenfolge, Prüfziffern), aber keine Sollwerte.

## Optional: LLM-Vergleich und Kosten

`LLM_MODEL` und `LLM_API_KEY` aktivieren den Vergleich (`/v1/chat/completions`, `LLM_BASE_URL` standardmäßig OpenAI). Kosten: LLM aus gemeldeten Token × Listenpreis (`LLM_PRICE_*`), tractor aus Laufzeit × `TRACTOR_COST_PER_HOUR`. Leere Werte bedeuten „nicht konfiguriert“, nie „kostenlos“.

tractor arbeitet mit einem Worker pro Prozess. `MAX_CONCURRENCY=1` vermeidet Wartezeit-Fehler. Gemessen wird die HTTP-Laufzeit des konfigurierten tractor-Servers (CPU oder GPU); auf einem ausgelasteten oder swappenden Rechner sind sie nicht aussagekräftig.

## Tests und Messung

```bash
npm test                          # Bewertung, Protokoll, LLM-Schema, Server (Fake-Backends)
TRACTOR_URL=http://127.0.0.1:8000 npm run probe   # alle Fälle gegen ein echtes tractor
```

## Deployment

Helm-Chart in `deploy/helm/tractordemo`, Image `ghcr.io/mayflower/tractor-demo` (GitHub-Workflow baut `sha-`-Tags). Der Dienst tractor selbst kommt aus dem Chart `deploy/helm/tractor` im tractor-Repository; `TRACTOR_URL` zeigt im Cluster auf `http://tractor.tractor.svc.cluster.local:8000`.
