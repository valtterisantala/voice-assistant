const CASES = {
  general_app_help: {
    case_id: "general_app_help",
    approved_text_fi:
      "Joo, autan. Liittyykö tämä maksuun, kuittiin, kirjautumiseen vai aseman etsimiseen?",
  },
  station_or_service_find: {
    case_id: "station_or_service_find",
    approved_text_fi:
      "Avaa ensin sovelluksesta asemahaku. Näitkö karttanäkymän auki?",
  },
  payment_or_card_issue: {
    case_id: "payment_or_card_issue",
    approved_text_fi:
      "Avaa maksutavat ja katso, onko oikea kortti valittuna. Löytyikö se sieltä?",
  },
  receipt_or_transaction_issue: {
    case_id: "receipt_or_transaction_issue",
    approved_text_fi:
      "Avaa ensin tapahtumahistoria sovelluksesta. Näetkö ostoksen siellä?",
  },
  technical_update_or_login_issue: {
    case_id: "technical_update_or_login_issue",
    approved_text_fi:
      "Kokeile ensin kirjautua ulos ja takaisin sisään. Pääsitkö takaisin sovellukseen?",
  },
};

const ROUTES = [
  {
    case_id: "receipt_or_transaction_issue",
    mode: "escalate",
    confidence: 0.9,
    keywords: ["tuplaveloitus", "kahdesti", "veloitettiin", "rahat", "hyvitys"],
    approved_text_fi:
      "Tuo kuulostaa veloitusasialta. Ohjaan tämän asiakaspalvelijalle jatkokäsittelyyn.",
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
        "En saanut vielä kiinni asiasta. Onko kyse maksusta, kuitista, kirjautumisesta vai asemasta?",
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
