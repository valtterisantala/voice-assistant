const fs = require("node:fs");
const path = require("node:path");
const { behaviorPolicySchema } = require("./policy-schema");

loadLocalEnv();

const repoRoot = path.join(__dirname, "..", "..", "..");
const specPath = path.join(repoRoot, "docs", "behavior-spec.md");
const outputPath = path.join(__dirname, "generated", "behavior-policy.json");
const compileModel = process.env.OPENAI_POLICY_COMPILE_MODEL ?? "gpt-4.1";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to compile the behavior policy.");
  }

  const spec = fs.readFileSync(specPath, "utf8");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: compileModel,
      input: [
        {
          role: "system",
          content:
            "Compile the human behavior spec into deterministic behavior-only runtime JSON. Do not include case dialogue, case keywords, case steps, or approved response text. Return JSON only.",
        },
        {
          role: "user",
          content: spec,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "behavior_policy",
          strict: true,
          schema: behaviorPolicySchema,
        },
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(payload, null, 2));
  }

  const policy = extractJson(payload);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(policy, null, 2)}\n`);
  console.log(`Compiled behavior policy to ${outputPath}`);
}

function extractJson(payload) {
  if (payload.output_text) {
    return JSON.parse(payload.output_text);
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return JSON.parse(content.text);
      }
    }
  }

  throw new Error("Could not find structured JSON output in Responses payload.");
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, "..", ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
