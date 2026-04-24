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
    "cases",
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
    cases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["case_id", "keywords", "steps"],
        properties: {
          case_id: {
            type: "string",
            enum: [
              "general_app_help",
              "station_or_service_find",
              "payment_or_card_issue",
              "receipt_or_transaction_issue",
              "technical_update_or_login_issue",
            ],
          },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "step_id",
                "approved_text_fi",
                "retry_text_fi",
                "clarify_text_fi",
              ],
              properties: {
                step_id: { type: "string" },
                approved_text_fi: { type: "string" },
                retry_text_fi: { type: "string" },
                clarify_text_fi: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = {
  behaviorPolicySchema,
};
