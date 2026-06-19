// Trainee-runtime functions — implemented in Phase 3 (and 5/7). Stubs for now.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { XAI_API_KEY } from "./secrets";

const ni = (name: string): never => {
  throw new HttpsError("unimplemented", `${name} is not implemented yet.`);
};

export const mintEphemeralToken = onCall({ secrets: [XAI_API_KEY] }, () =>
  ni("mintEphemeralToken")
);
export const searchKnowledgeBase = onCall({ secrets: [XAI_API_KEY] }, () =>
  ni("searchKnowledgeBase")
);
export const runTool = onCall(() => ni("runTool"));
export const finalizeSession = onCall(() => ni("finalizeSession"));
export const usageGuard = onCall(() => ni("usageGuard"));
