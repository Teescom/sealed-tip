// Factory for DemoContext (P11) supporting both seeded testnet and offline simulation
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { x25519PublicKey } from "@sealedtip/crypto";

import { loadEnv, parseDotEnv, workspaceRoot } from "../lib/env.js";
import { fromHex, toHex } from "../lib/keys.js";
import type { DemoConfig, DemoContext, PanelMemberConfig } from "./types.js";

const DEFAULT_MEMBERS = [
  { account: "panel1.st-hack-f8d075.testnet", secretSeed: "11".repeat(32) },
  { account: "panel2.st-hack-f8d075.testnet", secretSeed: "22".repeat(32) },
  { account: "panel3.st-hack-f8d075.testnet", secretSeed: "33".repeat(32) },
];

export const createDemoContext = async (overrideEnv?: Record<string, string>): Promise<DemoContext> => {
  const root = workspaceRoot();
  const envPath = join(root, ".env");
  const examplePath = join(root, ".env.example");

  let envMap: Record<string, string> = {};
  if (existsSync(envPath)) {
    try {
      envMap = loadEnv(root).env;
    } catch {
      envMap = parseDotEnv(readFileSync(examplePath, "utf8"));
    }
  } else if (existsSync(examplePath)) {
    envMap = parseDotEnv(readFileSync(examplePath, "utf8"));
  }

  if (overrideEnv) {
    Object.assign(envMap, overrideEnv);
  }

  const network = envMap.NEAR_NETWORK || "testnet";
  const rpcUrl = envMap.NEAR_RPC_URL || "https://rpc.testnet.near.org";
  const sealedtipContract = envMap.SEALEDTIP_CONTRACT || "sealedtip.st-hack-f8d075.testnet";
  const tokenContract = envMap.TOKEN_CONTRACT || "tusdc.st-hack-f8d075.testnet";
  const panelDao = envMap.PANEL_DAO || "sealedtip-panel.sputnik-v2.testnet";
  const funderAccount = envMap.FUNDER_ACCOUNT || "funder.st-hack-f8d075.testnet";
  const keeperAccount = envMap.KEEPER_ACCOUNT || "keeper.st-hack-f8d075.testnet";
  const apiUrl = envMap.NEXT_PUBLIC_API_URL || "http://localhost:8787";

  const panelMembers: PanelMemberConfig[] = [];
  for (let i = 1; i <= 3; i++) {
    const rawAcc = envMap[`PANEL_${i}_ACCOUNT`];
    const account = rawAcc && rawAcc.length > 0 ? rawAcc : DEFAULT_MEMBERS[i - 1]!.account;
    const rawSecret = envMap[`PANEL_${i}_X25519_SECRET`];
    const secretHex = rawSecret && rawSecret.length === 64 ? rawSecret : DEFAULT_MEMBERS[i - 1]!.secretSeed;
    const secretBytes = fromHex(secretHex, `PANEL_${i}`);
    const pubKey = await x25519PublicKey(secretBytes);
    panelMembers.push({
      account,
      x25519Secret: secretBytes,
      x25519SecretHex: secretHex,
      x25519PublicKey: pubKey,
      x25519PublicKeyHex: toHex(pubKey),
    });
  }

  const rawKeeperSecret = envMap.KEEPER_X25519_SECRET;
  const keeperSecretHex = rawKeeperSecret && rawKeeperSecret.length === 64 ? rawKeeperSecret : "44".repeat(32);
  const keeperSecretBytes = fromHex(keeperSecretHex, "KEEPER");
  const keeperX25519Pub = await x25519PublicKey(keeperSecretBytes);

  const config: DemoConfig = {
    network,
    rpcUrl,
    sealedtipContract,
    tokenContract,
    panelDao,
    funderAccount,
    panelMembers,
    keeperAccount,
    keeperX25519Pub,
    keeperX25519Secret: keeperSecretBytes,
    keeperX25519SecretHex: keeperSecretHex,
    apiUrl,
  };

  return {
    config,
    programmeId: 1,
    programmeTitle: "Road contract fraud — Fictional State",
    scopeUri: "https://cleanroads.example.org/procurement-rules",
    funderAccount,
    rawFiles: [],
    cleanedFiles: [],
    recusedPanelMembers: [panelMembers[2]!.account],
    activePanelMembers: [panelMembers[0]!.account, panelMembers[1]!.account],
    state: {},
  };
};
