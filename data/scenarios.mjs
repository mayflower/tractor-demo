// Synthetic German documents with independently authored expected final values.
// `expected.data` is the final normalized output a user wants, written from the
// text and the field contract, never copied from a model response.
// `accept` lists reviewed alternative answers per field (offline annotation).
// `expected.issues` lists the issue codes a correct rejection should report.
//
// Selection: the five demo scenarios hold the candidate cases that tractor
// answers correctly; every other candidate is kept, unchanged, under `edge`.
// The demo scenarios are therefore a showcase, not an accuracy measurement.
import cases from './cases.json' with {type: 'json'};

const meta = [
  {id: 'invoice', title: 'Rechnungen', subtitle: 'Nummer, Datum, Betrag, IBAN', summary: 'Typisierte Felder: Datum, Geld und Kennungen werden deterministisch geprüft und normalisiert.'},
  {id: 'units', title: 'Mengen und Einheiten', subtitle: 'Umrechnung', summary: 'Gewicht, Länge, Volumen, Temperatur und Druck werden in die Zieleinheit umgerechnet.'},
  {id: 'contacts', title: 'Kontaktdaten', subtitle: 'Personen, Telefon, Adresse', summary: 'Namen bleiben unverändert, Telefonnummern werden international formatiert, Postleitzahlen mit explizitem Land geprüft.'},
  {id: 'records', title: 'Mehrere Datensätze', subtitle: 'Records mit Anker', summary: 'Ein Anker-Feld trennt wenige, ausdrücklich beschriebene Datensätze; gleiche Namen bleiben getrennt. Positionslisten sind kein Gegenstand der Demo.'},
  {id: 'rejection', title: 'Ablehnen statt raten', subtitle: 'Ungültig und mehrdeutig', summary: 'Falsche Prüfsummen, widersprüchliche Werte, relative Fristen: null und ein Befund statt einer Vermutung.'},
];

const edge = {
  id: 'edge', title: 'Grenzfälle', subtitle: 'tractor liegt daneben',
  summary: 'Fälle, an denen tractor in dieser Prüfung scheitert, unverändert und offen gezeigt.',
};

export const scenarios = [...meta, edge].map(m => ({...m, cases: cases[m.id]}));

export const scenarioIndex = new Map(scenarios.map(s => [s.id, s]));

/** The speed run covers the five demo scenarios, not the edge cases. */
export const demoCases = () => scenarios.filter(s => s.id !== 'edge').flatMap(s => s.cases);

/** Metadata for the browser; expected values are included so the UI can score results. */
export function publicScenarios() {
  return scenarios.map(({id, title, subtitle, summary, cases: list}) => ({
    id, title, subtitle, summary,
    cases: list.map(({id: caseId, title: caseTitle, text, request, expected, accept}) => ({
      id: caseId, title: caseTitle, text, request, expected, accept: accept || {},
    })),
  }));
}
