const behaviorPolicySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "policy_version",
    "max_steps_per_turn",
    "tone",
    "natural_fillers_allowed",
    "short_turn_seconds",
    "confirmation_required_after_step",
    "allowed_followup_types",
    "escalation_keywords",
  ],
  properties: {
    policy_version: { type: "string" },
    max_steps_per_turn: { type: "integer" },
    tone: { type: "string" },
    natural_fillers_allowed: { type: "boolean" },
    short_turn_seconds: { type: "integer" },
    confirmation_required_after_step: { type: "boolean" },
    allowed_followup_types: {
      type: "array",
      items: {
        type: "string",
        enum: ["yes", "no", "unclear", "cannot_find", "escalate"],
      },
    },
    escalation_keywords: {
      type: "array",
      items: { type: "string" },
    },
  },
};

module.exports = {
  behaviorPolicySchema,
};
