// Synthetic German documents with independently authored expected final values.
// `expected.data` is the final normalized output a user wants, written from the
// text and the field contract, never copied from a model response.
// `accept` lists reviewed alternative answers per field (offline annotation).
// `expected.issues` lists the issue codes a correct rejection should report.

const text = description => ({type: 'text', description});
const quantity = (description, unit) => ({type: 'quantity', description, unit});
const money = (description, currency, locale) => ({type: 'money', description, currency, ...(locale ? {locale} : {})});
const date = (description, date_order = 'DMY') => ({type: 'date', description, date_order});
const identifier = (description, extra = {}) => ({type: 'identifier', description, ...extra});

const DE = 'de-DE';

export const scenarios = [
  {
    id: 'invoice',
    title: 'Rechnungen',
    subtitle: 'Typisierte Felder',
    summary: 'Nummer, Datum, Betrag, IBAN und USt-IdNr. aus Rechnungstexten. Datum, Geld und Kennungen werden deterministisch geprüft und normalisiert.',
    cases: [
      {
        id: 'inv-1',
        title: 'Vollständige Rechnung',
        text: 'Rechnung RE-2026-0412 vom 14.03.2026. Zahlbar bis 28.03.2026. Gesamtbetrag brutto: 2.380,00 EUR. Überweisung auf IBAN DE89 3704 0044 0532 0130 00. USt-IdNr. DE136695976.',
        request: {
          locale: DE,
          fields: {
            invoice_no: identifier('Rechnungsnummer'),
            invoice_date: date('Rechnungsdatum'),
            due_date: date('Fälligkeitsdatum (zahlbar bis)'),
            gross_amount: money('Rechnungsbetrag brutto', 'EUR'),
            iban: {type: 'iban', description: 'IBAN des Rechnungsstellers'},
            vat_id: identifier('USt-IdNr. des Rechnungsstellers', {format: 'vat', country: 'DE'}),
          },
        },
        expected: {
          data: {invoice_no: 'RE-2026-0412', invoice_date: '2026-03-14', due_date: '2026-03-28', gross_amount: 2380, iban: 'DE89370400440532013000', vat_id: '136695976'},
          issues: [],
        },
      },
      {
        id: 'inv-2',
        title: 'Englische Rechnung in US-Dollar',
        text: 'Invoice INV-77120 dated 2026-04-02. Total due: US$ 1,250.00. Payment due: April 30, 2026. Remit to DE02 1203 0000 0000 2020 51.',
        request: {
          locale: 'en-US',
          fields: {
            invoice_no: identifier('Invoice number'),
            invoice_date: {type: 'date', description: 'Invoice date'},
            due_date: {type: 'date', description: 'Payment due date'},
            gross_amount: money('Total due', 'USD', 'en-US'),
            iban: {type: 'iban', description: 'IBAN of the issuer'},
          },
        },
        expected: {
          data: {invoice_no: 'INV-77120', invoice_date: '2026-04-02', due_date: '2026-04-30', gross_amount: 1250, iban: 'DE02120300000000202051'},
          issues: [],
        },
      },
      {
        id: 'inv-3',
        title: 'Anzahlung und Restbetrag',
        text: 'Anzahlung 500,00 EUR wurde am 3. Mai 2026 verbucht. Der Restbetrag von 1.750,00 EUR ist bis zum 17. Mai 2026 fällig.',
        request: {
          locale: DE,
          fields: {
            paid: money('bereits gezahlte Anzahlung', 'EUR'),
            open_amount: money('noch zu zahlender Restbetrag', 'EUR'),
            due_date: date('Fälligkeitsdatum des Restbetrags'),
          },
        },
        expected: {data: {paid: 500, open_amount: 1750, due_date: '2026-05-17'}, issues: []},
      },
      {
        id: 'inv-4',
        title: 'Rechnungs- neben Kundennummer',
        text: 'Rechnungsnummer: RE-2026-0412, Kundennummer: K-88213. Der Gesamtbetrag beträgt 2.380,00 EUR.',
        request: {
          locale: DE,
          fields: {
            invoice_no: identifier('Rechnungsnummer'),
            gross_amount: money('Rechnungsbetrag brutto', 'EUR'),
          },
        },
        expected: {data: {invoice_no: 'RE-2026-0412', gross_amount: 2380}, issues: []},
      },
    ],
  },
  {
    id: 'units',
    title: 'Mengen und Einheiten',
    subtitle: 'Umrechnung',
    summary: 'Gewicht, Länge, Volumen, Temperatur und Druck werden in die geforderte Zieleinheit umgerechnet. Das Modell findet den Wert; Pint und Decimal rechnen.',
    cases: [
      {
        id: 'unit-1',
        title: 'Rover: kg, cm, miles',
        text: 'Der Rover-X wiegt 12,5 kg, ist 62 cm breit und schafft 10 miles pro Ladung.',
        request: {
          locale: DE,
          fields: {
            weight: quantity('Gewicht', 'kg'),
            width: quantity('Breite', 'mm'),
            range: quantity('Reichweite pro Ladung', 'km'),
          },
        },
        expected: {data: {weight: 12.5, width: 620, range: 16.09344}, issues: []},
      },
      {
        id: 'unit-2',
        title: 'Zoll und Fahrenheit',
        text: 'Die Kaffeemaschine ist 9 inches hoch und hält 212 °F aus.',
        request: {
          locale: DE,
          fields: {height: quantity('Höhe', 'mm'), temperature: quantity('maximale Temperatur', 'degC')},
        },
        expected: {data: {height: 228.6, temperature: 100}, issues: []},
      },
      {
        id: 'unit-3',
        title: 'Pfund und Celsius',
        text: 'Maximale Betriebstemperatur: 85 °C. Gewicht 50 lb.',
        request: {
          locale: DE,
          fields: {temperature: quantity('maximale Temperatur', 'degF'), weight: quantity('Gewicht', 'kg')},
        },
        expected: {data: {temperature: 185, weight: 22.6796185}, issues: []},
      },
      {
        id: 'unit-4',
        title: 'Kilometer in Meilen',
        text: 'Der Tank fasst 45 Liter, die Reichweite beträgt 650 km.',
        request: {
          locale: DE,
          fields: {volume: quantity('Tankvolumen', 'L'), range: quantity('Reichweite', 'mile')},
        },
        expected: {data: {volume: 45, range: 403.8912749542671}, issues: []},
      },
      {
        id: 'unit-5',
        title: 'Einheit fehlt, Bereich angegeben',
        text: 'Die Breite beträgt 12,5. Die Höhe liegt bei 10 bis 12 cm.',
        request: {
          locale: DE,
          fields: {width: quantity('Breite', 'mm'), height: quantity('Höhe', 'mm')},
        },
        expected: {
          data: {width: null, height: null},
          issues: [{field: 'width', code: 'missing_unit'}, {field: 'height', code: 'non_scalar_quantity'}],
        },
      },
      {
        id: 'unit-6',
        title: 'Mehrdeutiges „Pfund“',
        text: 'Das Gerät wiegt 3 Pfund.',
        request: {locale: DE, fields: {weight: quantity('Gewicht', 'kg')}},
        expected: {data: {weight: null}, issues: [{field: 'weight', code: 'ambiguous_unit'}]},
      },
    ],
  },
  {
    id: 'contacts',
    title: 'Kontaktdaten',
    subtitle: 'Personen, Telefon, Adresse',
    summary: 'Namen bleiben unverändert, Telefonnummern werden international formatiert, Adressen und Postleitzahlen mit explizitem Land geprüft. Es wird nichts erraten.',
    cases: [
      {
        id: 'con-1',
        title: 'Ansprechpartnerin',
        text: 'Ansprechpartnerin ist Dr. Anna Weber von der Nordlicht Systems GmbH, erreichbar unter Anna.Weber@Nordlicht-Systems.de oder +49 89 636 48018.',
        request: {
          locale: DE,
          fields: {
            contact: {type: 'person', description: 'Ansprechpartner'},
            company: {type: 'organization', description: 'Unternehmen'},
            email: {type: 'email', description: 'E-Mail-Adresse'},
            phone: {type: 'phone', description: 'Telefonnummer', country: 'DE'},
          },
        },
        expected: {
          data: {contact: 'Dr. Anna Weber', company: 'Nordlicht Systems GmbH', email: 'Anna.Weber@nordlicht-systems.de', phone: '+498963648018'},
          issues: [],
        },
        accept: {contact: ['Anna Weber']},
      },
      {
        id: 'con-2',
        title: 'Sitz mit Adresse und Telefon',
        text: 'Sitz der Gesellschaft: Hauptstraße 5, 01067 Dresden. Telefon 0351 987654.',
        request: {
          fields: {
            address: {type: 'address', description: 'Firmenadresse'},
            postcode: {type: 'postcode', description: 'Postleitzahl', country: 'DE'},
            phone: {type: 'phone', description: 'Telefon', country: 'DE'},
          },
        },
        expected: {data: {address: 'Hauptstraße 5, 01067 Dresden', postcode: '01067', phone: '+49351987654'}, issues: []},
      },
      {
        id: 'con-3',
        title: 'Lieferadresse mit Beschriftung',
        text: 'Lieferadresse: Lindenweg 14, 04107 Leipzig. Bitte beim Pförtner melden.',
        request: {
          locale: DE,
          fields: {
            address: {type: 'address', description: 'Lieferadresse', country: 'DE'},
            postcode: {type: 'postcode', description: 'Postleitzahl', country: 'DE'},
          },
        },
        expected: {data: {address: 'Lindenweg 14, 04107 Leipzig', postcode: '04107'}, issues: []},
      },
      {
        id: 'con-4',
        title: 'Web und Mobilnummer',
        text: 'Besuchen Sie WWW.Beispiel-Firma.DE/Kontakt oder rufen Sie uns an unter 0176 12345678.',
        request: {
          fields: {
            url: {type: 'url', description: 'Webseite'},
            phone: {type: 'phone', description: 'Mobilnummer', country: 'DE'},
          },
        },
        expected: {data: {url: 'www.beispiel-firma.de/Kontakt', phone: '+4917612345678'}, issues: []},
      },
      {
        id: 'con-5',
        title: 'Österreichische Nummer',
        text: 'Ansprechpartner: Herr Jonas Krüger, Tel. +43 1 5877966.',
        request: {
          fields: {
            person: {type: 'person', description: 'Ansprechpartner'},
            phone: {type: 'phone', description: 'Telefonnummer'},
          },
        },
        expected: {data: {person: 'Jonas Krüger', phone: '+4315877966'}, issues: []},
        accept: {person: ['Herr Jonas Krüger']},
      },
    ],
  },
  {
    id: 'records',
    title: 'Mehrere Datensätze',
    subtitle: 'Records mit Anker',
    summary: 'Ein Anker-Feld trennt ausdrücklich beschriebene Datensätze. Gleiche Namen bleiben getrennte Datensätze; fehlende Werte werden gemeldet statt erfunden.',
    cases: [
      {
        id: 'rec-1',
        title: 'Zwei Produkte',
        text: 'Alpha ist 10 cm breit. Beta ist 2 inches breit.',
        request: {
          many: true,
          anchor: 'product',
          fields: {product: text('Produktbezeichnung'), width: quantity('Breite', 'mm')},
        },
        expected: {data: [{product: 'Alpha', width: 100}, {product: 'Beta', width: 50.8}], issues: []},
      },
      {
        id: 'rec-2',
        title: 'Zwei Teammitglieder',
        text: 'Im Projektteam arbeiten Anna Weber (anna.weber@nordlicht.de) und Jonas Krüger (jonas.krueger@nordlicht.de). Beide sind erreichbar.',
        request: {
          many: true,
          anchor: 'name',
          fields: {
            name: {type: 'person', description: 'Teammitglied'},
            email: {type: 'email', description: 'E-Mail des Teammitglieds'},
          },
        },
        expected: {
          data: [
            {name: 'Anna Weber', email: 'anna.weber@nordlicht.de'},
            {name: 'Jonas Krüger', email: 'jonas.krueger@nordlicht.de'},
          ],
          issues: [],
        },
      },
      {
        id: 'rec-3',
        title: 'Lieferanten mit Beträgen',
        text: 'Die Nordlicht GmbH berechnet 1.200,00 EUR, die Südwind AG 980,50 EUR.',
        request: {
          locale: DE,
          many: true,
          anchor: 'supplier',
          fields: {supplier: {type: 'organization', description: 'Lieferant'}, amount: money('berechneter Betrag', 'EUR')},
        },
        expected: {data: [{supplier: 'Nordlicht GmbH', amount: 1200}, {supplier: 'Südwind AG', amount: 980.5}], issues: []},
      },
      {
        id: 'rec-4',
        title: 'Gleicher Name, zwei Datensätze',
        text: 'Atlas: Breite 10 cm. Atlas: Breite 12 cm.',
        request: {
          locale: DE,
          many: true,
          anchor: 'product',
          fields: {product: text('Produktbezeichnung'), width: quantity('Breite', 'mm')},
        },
        expected: {data: [{product: 'Atlas', width: 100}, {product: 'Atlas', width: 120}], issues: []},
      },
      {
        id: 'rec-5',
        title: 'Ein Wert fehlt',
        text: 'Atlas ist 12,5 cm breit. Boreal ist 8 cm breit und 3 kg schwer.',
        request: {
          locale: DE,
          many: true,
          anchor: 'product',
          fields: {product: text('Produktbezeichnung'), width: quantity('Breite', 'mm'), weight: quantity('Gewicht', 'kg')},
        },
        expected: {
          data: [{product: 'Atlas', width: 125, weight: null}, {product: 'Boreal', width: 80, weight: 3}],
          issues: [{field: 'weight', code: 'not_found', index: 0}],
        },
      },
    ],
  },
  {
    id: 'rejection',
    title: 'Ablehnen statt raten',
    subtitle: 'Ungültig und mehrdeutig',
    summary: 'Falsche Prüfsummen, widersprüchliche Beträge, relative Fristen oder fehlende Angaben liefern null und einen Befund. Eine korrekte Ablehnung zählt als richtiges Ergebnis.',
    cases: [
      {
        id: 'rej-1',
        title: 'Widersprüchliche Beträge',
        text: 'Der Betrag beträgt 1.200,00 EUR, korrigiert 1.250,00 EUR.',
        request: {locale: DE, fields: {amount: money('Rechnungsbetrag', 'EUR')}},
        expected: {data: {amount: null}, issues: [{field: 'amount', code: 'ambiguous_value'}]},
      },
      {
        id: 'rej-2',
        title: 'Kein Datum genannt',
        text: 'Die Lieferung erfolgt zeitnah nach Zahlungseingang.',
        request: {fields: {delivery: date('Lieferdatum')}},
        expected: {data: {delivery: null}, issues: [{field: 'delivery', code: 'not_found'}]},
      },
      {
        id: 'rej-3',
        title: 'IBAN mit falscher Prüfziffer',
        text: 'Bitte überweisen auf IBAN DE89 3704 0044 0532 0130 01.',
        request: {fields: {iban: {type: 'iban', description: 'IBAN'}}},
        expected: {data: {iban: null}, issues: [{field: 'iban', code: 'invalid_iban'}]},
      },
      {
        id: 'rej-4',
        title: 'Datum ohne festgelegte Reihenfolge',
        text: 'Der Termin ist am 03.04.2026.',
        request: {fields: {appointment: {type: 'date', description: 'Termin'}}},
        expected: {data: {appointment: null}, issues: [{field: 'appointment', code: 'ambiguous_or_unsupported_date'}]},
      },
      {
        id: 'rej-5',
        title: 'Währung passt nicht',
        text: 'Der Preis beträgt CA$ 40,00.',
        request: {locale: DE, fields: {price: money('Preis', 'USD')}},
        expected: {data: {price: null}, issues: [{field: 'price', code: 'currency_mismatch'}]},
      },
      {
        id: 'rej-6',
        title: 'USt-IdNr. mit falscher Prüfziffer',
        text: 'USt-IdNr. DE136695977.',
        request: {fields: {vat_id: identifier('USt-IdNr.', {format: 'vat', country: 'DE'})}},
        expected: {data: {vat_id: null}, issues: [{field: 'vat_id', code: 'invalid_identifier'}]},
      },
      {
        id: 'rej-7',
        title: 'Relative Frist',
        text: 'Zahlung bis nächsten Freitag.',
        request: {fields: {deadline: date('Zahlungsfrist')}},
        expected: {data: {deadline: null}, issues: [{field: 'deadline', code: 'ambiguous_or_unsupported_date'}]},
      },
    ],
  },
];

export const scenarioIndex = new Map(scenarios.map(s => [s.id, s]));

/** Metadata for the browser; expected values are included so the UI can score results. */
export function publicScenarios() {
  return scenarios.map(({id, title, subtitle, summary, cases}) => ({
    id, title, subtitle, summary,
    cases: cases.map(({id: caseId, title: caseTitle, text: source, request, expected, accept}) => ({
      id: caseId, title: caseTitle, text: source, request, expected, accept: accept || {},
    })),
  }));
}
