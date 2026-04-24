const behaviorPolicy = require("./generated/behavior-policy.json");

const sessions = new Map();
const DEFAULT_SESSION_ID = "local-demo";
const fallbackCaseKeywords = {
  station_or_service_find: ["asema", "aseman", "kartta", "palvelu", "pesu", "lataus", "ravintola"],
  payment_or_card_issue: ["maksu", "maksaa", "kortti", "pankki", "apple pay", "google pay"],
  receipt_or_transaction_issue: ["kuitti", "kuitit", "tapahtuma", "ostos", "historia", "tankkaus"],
  technical_update_or_login_issue: [
    "kirjautu",
    "salasana",
    "päivitys",
    "paivitys",
    "tekninen",
    "kaatuu",
    "aukea",
  ],
};
const escalationKeywordFallbacks = [
  "tuplaveloitus",
  "kahdesti",
  "veloitettiin",
  "veloitettu",
  "hyvitys",
  "rahat",
];

const followupMatchers = {
  yes: ["joo", "kyllä", "onnistui", "onnistu", "sain", "löytyi", "loytyi", "valmis", "tein", "done"],
  no: ["ei", "eipä", "nope", "ei toimi", "ei onnistunut", "ei auta", "sama ongelma"],
  unclear: ["mitä", "mita", "tarkoitat", "en ymmärrä", "en tajua", "selitä", "selita"],
  cannot_find: ["en löydä", "en loyda", "missä", "missa", "ei näy", "ei nay", "puuttuu"],
};

function resolveTurn(transcript, options = {}) {
  const cleanTranscript = normalizeTranscript(transcript);
  const sessionId = normalizeSessionId(options.session_id);
  const session = getSession(sessionId);

  if (!cleanTranscript) {
    return buildDecision({
      mode: "clarify",
      approved_text_fi:
        "En saanut vielä kiinni asiasta. Onko kyse maksusta, kuitista, kirjautumisesta vai asemasta?",
      case_id: session.case_id ?? "general_app_help",
      confidence: 0.35,
      step_id: session.step_id ?? "general_choose_area",
      awaits_confirmation: false,
      session_id: sessionId,
    });
  }

  if (
    containsAny(cleanTranscript, behaviorPolicy.escalation_keywords) ||
    containsAny(cleanTranscript, escalationKeywordFallbacks)
  ) {
    resetSession(session);
    return buildDecision({
      mode: "escalate",
      approved_text_fi:
        "Tuo kuulostaa veloitusasialta. Ohjaan tämän asiakaspalvelijalle jatkokäsittelyyn.",
      case_id: "receipt_or_transaction_issue",
      confidence: 0.9,
      step_id: "escalate_billing",
      awaits_confirmation: false,
      session_id: sessionId,
    });
  }

  if (session.awaiting_confirmation && session.case_id) {
    return resolveFollowup(cleanTranscript, session, sessionId);
  }

  const matchedCase = findCase(cleanTranscript);

  if (!matchedCase || matchedCase.case_id === "general_app_help") {
    resetSession(session);
    return buildDecision({
      mode: "clarify",
      approved_text_fi: firstStep("general_app_help").approved_text_fi,
      case_id: "general_app_help",
      confidence: matchedCase ? 0.55 : 0.45,
      step_id: firstStep("general_app_help").step_id,
      awaits_confirmation: false,
      session_id: sessionId,
    });
  }

  return startCase(session, matchedCase, sessionId);
}

function resolveFollowup(cleanTranscript, session, sessionId) {
  const followupType = classifyFollowup(cleanTranscript);
  const currentCase = getCase(session.case_id);
  const currentStep = currentCase.steps[session.step_index] ?? currentCase.steps[0];

  if (followupType === "yes") {
    const nextStepIndex = session.step_index + 1;
    const nextStep = currentCase.steps[nextStepIndex];

    if (!nextStep) {
      resetSession(session);
      return buildDecision({
        mode: "answer",
        approved_text_fi: "Hyvä, homma kunnossa. Tarvitsetko vielä muuta apua?",
        case_id: currentCase.case_id,
        confidence: 0.78,
        step_id: "case_complete",
        awaits_confirmation: false,
        session_id: sessionId,
      });
    }

    session.step_index = nextStepIndex;
    session.step_id = nextStep.step_id;
    session.awaiting_confirmation = true;
    session.retry_count = 0;
    return stepDecision(currentCase, nextStep, sessionId, 0.82);
  }

  if (followupType === "cannot_find") {
    session.retry_count += 1;
    return buildDecision({
      mode: "clarify",
      approved_text_fi: currentStep.retry_text_fi,
      case_id: currentCase.case_id,
      confidence: 0.72,
      step_id: currentStep.step_id,
      awaits_confirmation: true,
      session_id: sessionId,
    });
  }

  if (followupType === "unclear") {
    return buildDecision({
      mode: "clarify",
      approved_text_fi: currentStep.clarify_text_fi,
      case_id: currentCase.case_id,
      confidence: 0.7,
      step_id: currentStep.step_id,
      awaits_confirmation: true,
      session_id: sessionId,
    });
  }

  if (followupType === "no") {
    session.retry_count += 1;

    if (session.retry_count >= 2) {
      resetSession(session);
      return buildDecision({
        mode: "escalate",
        approved_text_fi:
          "Okei, ei jäädä jumiin. Ohjaan tämän asiakaspalvelijalle jatkokäsittelyyn.",
        case_id: currentCase.case_id,
        confidence: 0.74,
        step_id: "retry_limit_escalation",
        awaits_confirmation: false,
        session_id: sessionId,
      });
    }

    return buildDecision({
      mode: "clarify",
      approved_text_fi: currentStep.retry_text_fi,
      case_id: currentCase.case_id,
      confidence: 0.74,
      step_id: currentStep.step_id,
      awaits_confirmation: true,
      session_id: sessionId,
    });
  }

  return buildDecision({
    mode: "clarify",
    approved_text_fi:
      "Sano vaikka onnistuiko se vai jäikö kohta löytymättä, niin jatketaan siitä.",
    case_id: currentCase.case_id,
    confidence: 0.62,
    step_id: currentStep.step_id,
    awaits_confirmation: true,
    session_id: sessionId,
  });
}

function startCase(session, matchedCase, sessionId) {
  const step = matchedCase.steps[0];
  session.case_id = matchedCase.case_id;
  session.step_index = 0;
  session.step_id = step.step_id;
  session.awaiting_confirmation = true;
  session.retry_count = 0;

  return stepDecision(matchedCase, step, sessionId, 0.84);
}

function stepDecision(caseConfig, step, sessionId, confidence) {
  return buildDecision({
    mode: "answer",
    approved_text_fi: step.approved_text_fi,
    case_id: caseConfig.case_id,
    confidence,
    step_id: step.step_id,
    awaits_confirmation: true,
    session_id: sessionId,
  });
}

function buildDecision({
  mode,
  approved_text_fi,
  case_id,
  confidence,
  step_id,
  awaits_confirmation,
  session_id,
}) {
  return {
    mode,
    approved_text_fi,
    case_id,
    confidence,
    step_id,
    awaits_confirmation,
    allowed_followup_types: behaviorPolicy.allowed_followup_types,
    session_id,
  };
}

function findCase(cleanTranscript) {
  const specificCases = behaviorPolicy.cases.filter(
    (caseConfig) => caseConfig.case_id !== "general_app_help"
  );

  return (
    specificCases.find((caseConfig) => containsAny(cleanTranscript, caseConfig.keywords)) ??
    specificCases.find((caseConfig) =>
      containsAny(cleanTranscript, fallbackCaseKeywords[caseConfig.case_id] ?? [])
    ) ??
    behaviorPolicy.cases.find((caseConfig) => containsAny(cleanTranscript, caseConfig.keywords))
  );
}

function firstStep(caseId) {
  return getCase(caseId).steps[0];
}

function getCase(caseId) {
  return behaviorPolicy.cases.find((caseConfig) => caseConfig.case_id === caseId);
}

function classifyFollowup(cleanTranscript) {
  for (const [followupType, keywords] of Object.entries(followupMatchers)) {
    if (containsAny(cleanTranscript, keywords)) {
      return followupType;
    }
  }

  return "unclear";
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      case_id: null,
      step_index: 0,
      step_id: null,
      awaiting_confirmation: false,
      retry_count: 0,
    });
  }

  return sessions.get(sessionId);
}

function resetSession(session) {
  session.case_id = null;
  session.step_index = 0;
  session.step_id = null;
  session.awaiting_confirmation = false;
  session.retry_count = 0;
}

function containsAny(cleanTranscript, keywords) {
  return keywords.some((keyword) => cleanTranscript.includes(normalizeTranscript(keyword)));
}

function normalizeTranscript(transcript) {
  return String(transcript ?? "")
    .trim()
    .toLocaleLowerCase("fi-FI");
}

function normalizeSessionId(sessionId) {
  return String(sessionId ?? DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
}

module.exports = {
  behaviorPolicy,
  resolveTurn,
};
