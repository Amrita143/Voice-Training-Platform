// A userid maps to a hidden internal email for Firebase Auth. Users never see
// or type this — they log in with just their userid + password.
export const USERID_EMAIL_DOMAIN = "astra-voice-training.local";

export const useridToEmail = (userid: string): string =>
  `${String(userid).trim().toLowerCase()}@${USERID_EMAIL_DOMAIN}`;
