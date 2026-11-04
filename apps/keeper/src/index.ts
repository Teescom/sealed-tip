// Keeper (S-9.x): heartbeat every KEEPER_HEARTBEAT_S; watch switch_triggered; re-seal K_switch to non-recused panel.
// Trusted in the hackathon build; production plan: run inside a TEE (VERIFY OutLayer).
import { startHeartbeat } from "./heartbeat.js";
import { watchTriggers } from "./watch.js";

startHeartbeat();
watchTriggers();
