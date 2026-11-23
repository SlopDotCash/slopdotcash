// spec/backend/bindingConsent.md, "Authorization stores a consent the attester can still submit and never edits an earlier one"
export const writes = ["payment_binding_authorizations", "security_case_access_log"] as const;
