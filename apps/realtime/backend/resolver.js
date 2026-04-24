const CASES = {
  general_app_help: {
    case_id: "general_app_help",
    approved_text_fi:
      "Voin auttaa sovelluksen perusasioissa. Kerro lyhyesti, liittyykö asia asemahakuun, maksamiseen, kuittiin vai kirjautumiseen.",
  },
  station_or_service_find: {
    case_id: "station_or_service_find",
    approved_text_fi:
      "Avaa sovelluksen asemahaku ja valitse tarvitsemasi palvelu suodattimista. Sen jälkeen näet sopivat asemat kartalla.",
  },
  payment_or_card_issue: {
    case_id: "payment_or_card_issue",
    approved_text_fi:
      "Tarkista ensin sovelluksesta, että maksukortti on voimassa ja valittuna. Jos maksu on veloitettu väärin, ohjaan asian asiakaspalvelijalle.",
  },
  receipt_or_transaction_issue: {
    case_id: "receipt_or_transaction_issue",
    approved_text_fi:
      "Kuitit ja tapahtumat löytyvät yleensä sovelluksen tapahtumahistoriasta. Tarkista oikea aikaväli ja avaa kyseinen ostotapahtuma.",
  },
  technical_update_or_login_issue: {
    case_id: "technical_update_or_login_issue",
    approved_text_fi:
      "Päivitä sovellus uusimpaan versioon ja yritä kirjautua uudelleen. Jos se ei auta, käynnistä puhelin ja kokeile vielä kerran.",
  },
};

const ROUTES = [
  {
    case_id: "receipt_or_transaction_issue",
    mode: "escalate",
    confidence: 0.9,
    keywords: ["tuplaveloitus", "kahdesti", "veloitettiin", "rahat", "hyvitys"],
    approved_text_fi:
      "Tämä kannattaa ohjata asiakaspalvelijalle. En tee muutoksia tässä demossa, mutta kirjaan asian jatkokäsittelyyn.",
  },
  {
    case_id: "station_or_service_find",
    mode: "answer",
    confidence: 0.84,
    keywords: ["asema", "aseman", "kartta", "palvelu", "pesu", "lataus", "ravintola"],
  },
  {
    case_id: "payment_or_card_issue",
    mode: "answer",
    confidence: 0.82,
    keywords: ["maksu", "maksaa", "kortti", "pankki", "apple pay", "google pay"],
  },
  {
    case_id: "receipt_or_transaction_issue",
    mode: "answer",
    confidence: 0.8,
    keywords: ["kuitti", "kuitit", "tapahtuma", "ostos", "historia"],
  },
  {
    case_id: "technical_update_or_login_issue",
    mode: "answer",
    confidence: 0.83,
    keywords: ["kirjautu", "salasana", "päivitys", "paivitys", "tekninen", "kaatuu", "aukea"],
  },
];

function resolveTurn(transcript) {
  const cleanTranscript = normalizeTranscript(transcript);

  if (!cleanTranscript) {
    return buildDecision({
      mode: "clarify",
      case_id: "general_app_help",
      confidence: 0.35,
      approved_text_fi:
        "En saanut vielä selvää asiasta. Kerro lyhyesti, tarvitsetko apua asemien, maksamisen, kuittien vai kirjautumisen kanssa.",
    });
  }

  const route = ROUTES.find((candidate) =>
    candidate.keywords.some((keyword) => cleanTranscript.includes(keyword))
  );

  if (!route) {
    return buildDecision({
      mode: "clarify",
      case_id: "general_app_help",
      confidence: 0.45,
      approved_text_fi: CASES.general_app_help.approved_text_fi,
    });
  }

  return buildDecision({
    mode: route.mode,
    case_id: route.case_id,
    confidence: route.confidence,
    approved_text_fi: route.approved_text_fi ?? CASES[route.case_id].approved_text_fi,
  });
}

function normalizeTranscript(transcript) {
  return String(transcript ?? "")
    .trim()
    .toLocaleLowerCase("fi-FI");
}

function buildDecision({ mode, approved_text_fi, case_id, confidence }) {
  return {
    mode,
    approved_text_fi,
    case_id,
    confidence,
  };
}

module.exports = {
  CASES,
  resolveTurn,
};
