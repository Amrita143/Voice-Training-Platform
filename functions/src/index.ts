/**
 * AVTP Cloud Functions entry point.
 * Initializes Admin SDK + global options, then re-exports all functions.
 * See ../../CLAUDE.md for constraints (secrets server-side, custom-token auth,
 * KB via custom search path, etc.).
 */
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Auth / user management (Phase 1)
export { login, changePassword, userAdmin } from "./auth";

// HTTP surface
export { health, api } from "./http";

// One-time superadmin bootstrap (delete after first use)
export { bootstrapSuperadmin } from "./bootstrap";

// Trainee runtime (Phase 3+) — stubs for now
export {
  mintEphemeralToken,
  searchKnowledgeBase,
  runTool,
  finalizeSession,
  usageGuard,
} from "./runtimeStubs";
