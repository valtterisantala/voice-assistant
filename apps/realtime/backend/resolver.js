const behaviorPolicy = require("./generated/behavior-policy.json");

const sessions = new Map();
const DEFAULT_SESSION_ID = "local-demo";
const caseLabelsFi = {
  general_app_help: "sovelluksen perusasioista",
  station_or_service_find: "asemista ja tankkauksesta",
  payment_or_card_issue: "mobiilimaksusta",
  receipt_or_transaction_issue: "kuiteista ja tapahtumista",
  technical_update_or_login_issue: "kirjautumisesta tai teknisestä viasta",
};
const fallbackCaseKeywords = {
  station_or_service_find: [
    "asema",
    "aseman",
    "kartta",
    "palvelu",
    "pesu",
    "lataus",
    "ravintola",
    "tankkaus",
    "tankka",
    "tankkauk",
    "tankata",
    "mobiilitankkaus",
    "mobiilitankkauk",
    "polttoaine",
  ],
  payment_or_card_issue: [
    "maksu",
    "maksaa",
    "mobiilimaksu",
    "kortti",
    "pankki",
    "apple pay",
    "google pay",
  ],
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
    resetActiveCase(session);
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
    const explicitCase = findCase(cleanTranscript);
    const followupType = classifyFollowup(cleanTranscript);

    if (
      explicitCase &&
      explicitCase.case_id !== "general_app_help" &&
      explicitCase.case_id !== session.case_id &&
      followupType === "unknown"
    ) {
      return startCase(session, explicitCase, sessionId);
    }

    return resolveFollowup(cleanTranscript, session, sessionId);
  }

  const matchedCase = findCase(cleanTranscript);

  if (!matchedCase || matchedCase.case_id === "general_app_help") {
    const recentCaseId = lastCaseId(session);
    resetActiveCase(session);

    if (recentCaseId && recentCaseId !== "general_app_help") {
      return buildDecision({
        mode: "clarify",
        approved_text_fi: `Puhuttiin äsken ${caseLabelsFi[recentCaseId]}. Jatketaanko siitä, vai vaihdetaanko aihetta?`,
        case_id: recentCaseId,
        confidence: 0.58,
        step_id: "confirm_recent_topic",
        awaits_confirmation: false,
        session_id: sessionId,
      });
    }

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
      resetActiveCase(session);
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
      resetActiveCase(session);
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
  rememberCase(session, matchedCase.case_id);

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
  const scoredCases = specificCases
    .map((caseConfig) => {
      const policyScore = matchScore(cleanTranscript, caseConfig.keywords);
      const fallbackScore = matchScore(
        cleanTranscript,
        fallbackCaseKeywords[caseConfig.case_id] ?? []
      );

      return {
        caseConfig,
        score: policyScore * 3 + fallbackScore,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return (
    scoredCases[0]?.caseConfig ??
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

  return "unknown";
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      case_id: null,
      step_index: 0,
      step_id: null,
      awaiting_confirmation: false,
      retry_count: 0,
      case_history: [],
    });
  }

  return sessions.get(sessionId);
}

function resetActiveCase(session) {
  session.case_id = null;
  session.step_index = 0;
  session.step_id = null;
  session.awaiting_confirmation = false;
  session.retry_count = 0;
}

function rememberCase(session, caseId) {
  session.case_history = session.case_history ?? [];
  session.case_history = [
    caseId,
    ...session.case_history.filter((candidate) => candidate !== caseId),
  ].slice(0, 3);
}

function lastCaseId(session) {
  return session.case_id ?? session.case_history?.[0] ?? null;
}

function containsAny(cleanTranscript, keywords) {
  return keywords.some((keyword) => cleanTranscript.includes(normalizeTranscript(keyword)));
}

function matchScore(cleanTranscript, keywords) {
  return keywords.reduce((score, keyword) => {
    return cleanTranscript.includes(normalizeTranscript(keyword)) ? score + 1 : score;
  }, 0);
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
