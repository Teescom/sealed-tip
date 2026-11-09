// Shared types for PRD §8 acceptance test script (P11: S-11.1..S-11.9)
import type { BundleReport, TipBundle } from "@sealedtip/core";
import type { TipsterKeys, RedactionBundle } from "@sealedtip/crypto";

export interface PanelMemberConfig {
  account: string;
  x25519Secret: Uint8Array;
  x25519SecretHex: string;
  x25519PublicKey: Uint8Array;
  x25519PublicKeyHex: string;
}

export interface DemoConfig {
  network: string;
  rpcUrl: string;
  sealedtipContract: string;
  tokenContract: string;
  panelDao: string;
  funderAccount: string;
  panelMembers: PanelMemberConfig[];
  keeperAccount: string;
  keeperX25519Pub: Uint8Array;
  keeperX25519Secret: Uint8Array;
  keeperX25519SecretHex: string;
  apiUrl: string;
}

export interface FictionalRawFile {
  name: string;
  mime: string;
  raw: Buffer;
}

export interface CleanedExhibitFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export interface DemoContext {
  config: DemoConfig;
  programmeId: number;
  programmeTitle: string;
  scopeUri: string;
  funderAccount: string;
  rawFiles: FictionalRawFile[];
  cleanedFiles: CleanedExhibitFile[];
  cleaningReport?: BundleReport;
  redactionBundle?: RedactionBundle;
  recusedPanelMembers: string[];
  activePanelMembers: string[];
  tipsterKeys?: TipsterKeys;
  recoveryWords?: string[];
  tipBundle?: TipBundle;
  evidenceCiphertext?: Uint8Array;
  symmetricKeyK?: Uint8Array;
  evidenceHash?: Uint8Array;
  evidenceCid?: string;
  tipId?: number;
  claimDestinationAccount?: string;
  switchTipId?: number;
  switchTipsterKeys?: TipsterKeys;
  switchRecoveryWords?: string[];
  releasedKeyCids?: string[];
  state: Record<string, unknown>;
}
