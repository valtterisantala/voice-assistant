const behaviorPolicy = require("./generated/behavior-policy.json");
const caseDialogue = require("./generated/case-dialogue.json");
const caseContent = caseDialogue.cases;

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
const coverageFallbackText =
  "Tämä demo kattaa nyt vain maksut, kuitit, kirjautumisen ja aseman etsimisen. Valitaanko joku niistä?";
const harmlessMetaMatchers = {
  greeting: ["hei", "moi", "terve", "heippa"],
  repeat: ["toista", "sano uudelleen", "uudestaan", "voitko toistaa"],
  capability: ["mitä osaat", "mita osaat", "missä voit auttaa", "missa voit auttaa"],
};

const followupMatchers = {
  no: ["ei", "eipä", "nope", "ei toimi", "ei onnistunut", "ei auta", "sama ongelma"],
  yes: ["joo", "kyllä", "onnistui", "onnistu", "sain", "löytyi", "loytyi", "valmis", "tein", "done"],
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
      session,
      match_reason: "empty_transcript",
    });
  }

  if (
    containsAny(cleanTranscript, behaviorPolicy.escalation_keywords) ||
    containsAny(cleanTranscript, escalationKeywordFallbacks)
  ) {
    const resetReason = "escalation_keyword";
    resetActiveCase(session, resetReason);
    return buildDecision({
      mode: "escalate",
      approved_text_fi:
        "Tuo kuulostaa veloitusasialta. Ohjaan tämän asiakaspalvelijalle jatkokäsittelyyn.",
      case_id: "receipt_or_transaction_issue",
      confidence: 0.9,
      step_id: "escalate_billing",
      awaits_confirmation: false,
      session_id: sessionId,
      session,
      reset_reason: resetReason,
      match_reason: "escalation_keyword",
    });
  }

  if (session.awaiting_confirmation && session.case_id) {
    const explicitCaseMatch = findCase(cleanTranscript);
    const explicitCase = explicitCaseMatch?.caseConfig;
    const followupType = classifyFollowup(cleanTranscript);
    const currentCase = getCase(session.case_id);
    const currentFact = findApprovedFact(cleanTranscript, currentCase);
    const metaResponse = resolveHarmlessMeta(cleanTranscript, session, sessionId);

    if (metaResponse) {
      return metaResponse;
    }

    if (
      explicitCase &&
      explicitCase.case_id !== "general_app_help" &&
      explicitCase.case_id !== session.case_id &&
      followupType !== "yes"
    ) {
      return startCase(session, explicitCase, sessionId, `coverage:case_switch:${explicitCaseMatch.match_reason}`);
    }

    if (currentFact && followupType === "unknown") {
      return factDecision(currentCase, currentFact, session, sessionId, "coverage:approved_fact:active_case", true);
    }

    if (followupType === "unknown" && !explicitCase) {
      return buildDecision({
        mode: "clarify",
        approved_text_fi: `Tuo menee tämän demon ulkopuolelle. Jatketaanko aiheesta ${caseLabelsFi[currentCase.case_id]}?`,
        case_id: currentCase.case_id,
        confidence: 0.52,
        step_id: "out_of_coverage_active_case",
        awaits_confirmation: true,
        session_id: sessionId,
        session,
        match_reason: "coverage:out_of_coverage:active_case",
      });
    }

    return resolveFollowup(cleanTranscript, session, sessionId);
  }

  const caseMatch = findCase(cleanTranscript);
  const matchedCase = caseMatch?.caseConfig;

  if (!matchedCase || matchedCase.case_id === "general_app_help") {
    const recentCaseId = lastCaseId(session);
    const metaResponse = resolveHarmlessMeta(cleanTranscript, session, sessionId);

    if (metaResponse) {
      return metaResponse;
    }

    const resetReason = matchedCase ? "general_app_help" : "out_of_coverage";
    resetActiveCase(session, resetReason);

    if (recentCaseId && recentCaseId !== "general_app_help") {
      return buildDecision({
        mode: "clarify",
        approved_text_fi: `Tuo menee tämän demon ulkopuolelle. Puhuttiin äsken ${caseLabelsFi[recentCaseId]}. Jatketaanko siitä?`,
        case_id: recentCaseId,
        confidence: 0.5,
        step_id: "out_of_coverage_recent_topic",
        awaits_confirmation: false,
        session_id: sessionId,
        session,
        reset_reason: resetReason,
        match_reason: "coverage:out_of_coverage:recent_topic",
      });
    }

    return buildDecision({
      mode: "clarify",
      approved_text_fi: matchedCase ? firstStep("general_app_help").approved_text_fi : coverageFallbackText,
      case_id: "general_app_help",
      confidence: matchedCase ? 0.55 : 0.45,
      step_id: matchedCase ? firstStep("general_app_help").step_id : "out_of_coverage",
      awaits_confirmation: false,
      session_id: sessionId,
      session,
      reset_reason: resetReason,
      match_reason: caseMatch?.match_reason ?? "coverage:out_of_coverage",
    });
  }

  const matchedFact = findApprovedFact(cleanTranscript, matchedCase);

  if (matchedFact) {
    rememberCase(session, matchedCase.case_id);
    return factDecision(matchedCase, matchedFact, session, sessionId, "coverage:approved_fact:new_case", false);
  }

  return startCase(session, matchedCase, sessionId, `coverage:case_start:${caseMatch.match_reason}`);
}

function resolveFollowup(cleanTranscript, session, sessionId) {
  const followupType = classifyFollowup(cleanTranscript);
  const currentCase = getCase(session.case_id);
  const currentStep = currentCase.steps[session.step_index] ?? currentCase.steps[0];

  if (followupType === "yes") {
    const nextStepIndex = session.step_index + 1;
    const nextStep = currentCase.steps[nextStepIndex];

    if (!nextStep) {
      const resetReason = "case_complete";
      resetActiveCase(session, resetReason);
      return buildDecision({
        mode: "answer",
        approved_text_fi: "Hyvä, homma kunnossa. Tarvitsetko vielä muuta apua?",
        case_id: currentCase.case_id,
        confidence: 0.78,
        step_id: "case_complete",
        awaits_confirmation: false,
        session_id: sessionId,
        session,
        reset_reason: resetReason,
        match_reason: "coverage:covered_followup:yes",
      });
    }

    session.step_index = nextStepIndex;
    session.step_id = nextStep.step_id;
    session.awaiting_confirmation = true;
    session.retry_count = 0;
    return stepDecision(currentCase, nextStep, sessionId, 0.82, session, "coverage:covered_followup:yes");
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
      session,
      match_reason: "coverage:covered_followup:cannot_find",
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
      session,
      match_reason: "coverage:covered_followup:unclear",
    });
  }

  if (followupType === "no") {
    session.retry_count += 1;

    if (session.retry_count >= 2) {
      const resetReason = "retry_limit";
      resetActiveCase(session, resetReason);
      return buildDecision({
        mode: "escalate",
        approved_text_fi:
          "Okei, ei jäädä jumiin. Ohjaan tämän asiakaspalvelijalle jatkokäsittelyyn.",
        case_id: currentCase.case_id,
        confidence: 0.74,
        step_id: "retry_limit_escalation",
        awaits_confirmation: false,
        session_id: sessionId,
        session,
        reset_reason: resetReason,
        match_reason: "coverage:covered_followup:no",
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
      session,
      match_reason: "coverage:covered_followup:no",
    });
  }

  return buildDecision({
    mode: "clarify",
    approved_text_fi:
      "En lähde arvaamaan. Tässä kohdassa voin jatkaa, jos sanot onnistuiko se, jäikö kohta löytymättä vai haluatko vaihtaa aihetta.",
    case_id: currentCase.case_id,
    confidence: 0.62,
    step_id: currentStep.step_id,
    awaits_confirmation: true,
    session_id: sessionId,
    session,
    match_reason: "coverage:covered_followup:unknown",
  });
}

function factDecision(currentCase, fact, session, sessionId, matchReason, awaitsConfirmation) {
  return buildDecision({
    mode: "answer",
    approved_text_fi: fact.answer_fi,
    case_id: currentCase.case_id,
    confidence: 0.76,
    step_id: `fact:${fact.fact_id}`,
    awaits_confirmation: awaitsConfirmation,
    session_id: sessionId,
    session,
    match_reason: matchReason,
  });
}

function startCase(session, matchedCase, sessionId, matchReason) {
  const step = matchedCase.steps[0];
  session.case_id = matchedCase.case_id;
  session.step_index = 0;
  session.step_id = step.step_id;
  session.awaiting_confirmation = true;
  session.retry_count = 0;
  rememberCase(session, matchedCase.case_id);

  return stepDecision(matchedCase, step, sessionId, 0.84, session, matchReason);
}

function stepDecision(caseConfig, step, sessionId, confidence, session, matchReason) {
  return buildDecision({
    mode: "answer",
    approved_text_fi: step.approved_text_fi,
    case_id: caseConfig.case_id,
    confidence,
    step_id: step.step_id,
    awaits_confirmation: true,
    session_id: sessionId,
    session,
    match_reason: matchReason,
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
  session,
  reset_reason = null,
  match_reason = null,
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
    last_topic: session ? lastCaseId(session) : null,
    reset_reason,
    match_reason,
    coverage_tier: coverageTier(match_reason),
  };
}

function coverageTier(matchReason) {
  if (!matchReason) {
    return "unknown";
  }

  if (matchReason.includes("covered_followup")) {
    return "covered_followup";
  }

  if (matchReason.includes("approved_fact")) {
    return "approved_fact";
  }

  if (matchReason.includes("case_switch")) {
    return "case_switch";
  }

  if (matchReason.includes("out_of_coverage")) {
    return "out_of_coverage";
  }

  if (matchReason.includes("escalation")) {
    return "escalation";
  }

  if (matchReason.includes("meta")) {
    return "meta";
  }

  if (
    matchReason.includes("case_start") ||
    matchReason.includes("case_score") ||
    matchReason.includes("general_keyword")
  ) {
    return "case_start";
  }

  return "unknown";
}

function findCase(cleanTranscript) {
  const specificCases = caseContent.filter(
    (caseConfig) => caseConfig.case_id !== "general_app_help"
  );
  const scoredCases = specificCases
    .map((caseConfig) => {
      const policyScore = matchScore(cleanTranscript, caseConfig.keywords);
      const fallbackScore = matchScore(
        cleanTranscript,
        fallbackCaseKeywords[caseConfig.case_id] ?? []
      );
      const score = policyScore * 3 + fallbackScore;

      return {
        caseConfig,
        score,
        match_reason: `case_score:${caseConfig.case_id}:policy=${policyScore}:fallback=${fallbackScore}:total=${score}`,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredCases[0]) {
    return {
      caseConfig: scoredCases[0].caseConfig,
      match_reason: scoredCases[0].match_reason,
    };
  }

  const generalCase = caseContent.find((caseConfig) =>
    containsAny(cleanTranscript, caseConfig.keywords)
  );

  if (generalCase) {
    return {
      caseConfig: generalCase,
      match_reason: `general_keyword:${generalCase.case_id}`,
    };
  }

  return null;
}

function findApprovedFact(cleanTranscript, caseConfig) {
  return caseConfig.approved_facts?.find((fact) =>
    containsAny(cleanTranscript, fact.triggers ?? [])
  );
}

function resolveHarmlessMeta(cleanTranscript, session, sessionId) {
  if (containsAny(cleanTranscript, harmlessMetaMatchers.greeting)) {
    return buildDecision({
      mode: "clarify",
      approved_text_fi: "Moi. Voin auttaa tässä demossa maksun, kuitin, kirjautumisen tai aseman kanssa. Mistä aloitetaan?",
      case_id: session.case_id ?? "general_app_help",
      confidence: 0.58,
      step_id: "meta_greeting",
      awaits_confirmation: false,
      session_id: sessionId,
      session,
      match_reason: "coverage:meta:greeting",
    });
  }

  if (containsAny(cleanTranscript, harmlessMetaMatchers.capability)) {
    return buildDecision({
      mode: "clarify",
      approved_text_fi: coverageFallbackText,
      case_id: session.case_id ?? "general_app_help",
      confidence: 0.58,
      step_id: "meta_capability",
      awaits_confirmation: false,
      session_id: sessionId,
      session,
      match_reason: "coverage:meta:capability",
    });
  }

  if (containsAny(cleanTranscript, harmlessMetaMatchers.repeat) && session.case_id) {
    const currentCase = getCase(session.case_id);
    const currentStep = currentCase.steps[session.step_index] ?? currentCase.steps[0];

    return buildDecision({
      mode: "answer",
      approved_text_fi: currentStep.approved_text_fi,
      case_id: currentCase.case_id,
      confidence: 0.7,
      step_id: currentStep.step_id,
      awaits_confirmation: true,
      session_id: sessionId,
      session,
      match_reason: "coverage:meta:repeat_current_step",
    });
  }

  return null;
}

function firstStep(caseId) {
  return getCase(caseId).steps[0];
}

function getCase(caseId) {
  return caseContent.find((caseConfig) => caseConfig.case_id === caseId);
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
      last_reset_reason: null,
    });
  }

  return sessions.get(sessionId);
}

function resetActiveCase(session, reason) {
  session.case_id = null;
  session.step_index = 0;
  session.step_id = null;
  session.awaiting_confirmation = false;
  session.retry_count = 0;
  session.last_reset_reason = reason ?? null;
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
  caseDialogue,
  resolveTurn,
};
