const fs = require("node:fs");
const path = require("node:path");
const behaviorPolicy = require("./generated/behavior-policy.json");

const draftsDir = path.join(__dirname, "case-drafts");
const outputPath = path.join(__dirname, "generated", "case-dialogue.json");

function main() {
  const drafts = fs
    .readdirSync(draftsDir)
    .filter((fileName) => fileName.endsWith(".yaml") || fileName.endsWith(".yml"))
    .sort()
    .map((fileName) => {
      const filePath = path.join(draftsDir, fileName);
      return parseCaseDraft(fs.readFileSync(filePath, "utf8"), fileName);
    });

  const caseDialogue = {
    dialogue_version: "2026-04-27-poc-1f",
    generated_from: {
      behavior_policy_version: behaviorPolicy.policy_version,
      draft_dir: "apps/realtime/backend/case-drafts",
    },
    cases: drafts.map(expandDraft),
  };

  validateCaseDialogue(caseDialogue);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(caseDialogue, null, 2)}\n`);
  console.log(`Compiled case dialogue to ${outputPath}`);
}

function parseCaseDraft(rawYaml, fileName) {
  const draft = {};
  let currentArrayKey = null;
  let currentStep = null;

  for (const rawLine of rawYaml.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      currentArrayKey = null;
      currentStep = null;
      const [key, rawValue] = splitKeyValue(line, fileName);

      if (rawValue === "") {
        draft[key] = [];
        currentArrayKey = key;
      } else {
        draft[key] = parseScalar(rawValue);
      }

      continue;
    }

    if (!currentArrayKey) {
      throw new Error(`${fileName}: nested value without a parent key: ${line}`);
    }

    if (indent === 2 && line.startsWith("- ")) {
      const item = line.slice(2).trim();

      if (currentArrayKey === "steps") {
        currentStep = {};
        draft.steps.push(currentStep);

        if (item) {
          const [key, rawValue] = splitKeyValue(item, fileName);
          currentStep[key] = parseScalar(rawValue);
        }
      } else {
        draft[currentArrayKey].push(parseScalar(item));
      }

      continue;
    }

    if (indent === 4 && currentArrayKey === "steps" && currentStep) {
      const [key, rawValue] = splitKeyValue(line, fileName);
      currentStep[key] = parseScalar(rawValue);
      continue;
    }

    throw new Error(`${fileName}: unsupported YAML shape near: ${line}`);
  }

  return draft;
}

function splitKeyValue(line, fileName) {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex === -1) {
    throw new Error(`${fileName}: expected key/value line: ${line}`);
  }

  return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
}

function parseScalar(rawValue) {
  return rawValue.replace(/^["']|["']$/g, "");
}

function expandDraft(draft) {
  const steps = requiredArray(draft, "steps").map((step) => ({
    step_id: requiredString(step, "step_id", draft.case_id),
    approved_text_fi: joinSentences([
      requiredString(step, "action", draft.case_id),
      step.confirmation,
    ]),
    retry_text_fi: requiredString(step, "retry_hint", draft.case_id),
    clarify_text_fi: requiredString(step, "clarify_hint", draft.case_id),
  }));

  return {
    case_id: requiredString(draft, "case_id", "draft"),
    intent: requiredString(draft, "intent", draft.case_id),
    goal: requiredString(draft, "goal", draft.case_id),
    keywords: requiredArray(draft, "triggers"),
    facts: requiredArray(draft, "facts"),
    retry_guidance: requiredString(draft, "retry_guidance", draft.case_id),
    clarify_guidance: requiredString(draft, "clarify_guidance", draft.case_id),
    escalate_when: requiredString(draft, "escalate_when", draft.case_id),
    steps,
  };
}

function joinSentences(parts) {
  return parts
    .filter(Boolean)
    .map((part) => part.trim())
    .join(" ")
    .replace(/\s+/g, " ");
}

function requiredString(source, key, context) {
  if (typeof source[key] !== "string" || !source[key].trim()) {
    throw new Error(`${context}: missing required string "${key}"`);
  }

  return source[key].trim();
}

function requiredArray(source, key) {
  if (!Array.isArray(source[key]) || source[key].length === 0) {
    throw new Error(`Missing required non-empty array "${key}"`);
  }

  return source[key];
}

function validateCaseDialogue(caseDialogue) {
  const caseIds = new Set();

  for (const caseConfig of caseDialogue.cases) {
    if (caseIds.has(caseConfig.case_id)) {
      throw new Error(`Duplicate case_id: ${caseConfig.case_id}`);
    }

    caseIds.add(caseConfig.case_id);

    for (const step of caseConfig.steps) {
      for (const key of ["approved_text_fi", "retry_text_fi", "clarify_text_fi"]) {
        if (!step[key].includes("?")) {
          throw new Error(`${caseConfig.case_id}/${step.step_id}: ${key} must ask a question`);
        }
      }
    }
  }
}

main();
