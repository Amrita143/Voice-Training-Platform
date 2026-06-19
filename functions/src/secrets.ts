import { defineSecret } from "firebase-functions/params";

// xAI API key — server-side only. Set for prod via:
//   firebase functions:secrets:set XAI_API_KEY   (requires Blaze)
// For the emulator, it's read from functions/.secret.local
export const XAI_API_KEY = defineSecret("XAI_API_KEY");
