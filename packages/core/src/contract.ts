// The ONLY place that knows sealedtip method names and argument shapes (S-6.2).
import type { Programme, ProgrammeStats, Tip, TipPublic } from "./types.js";

export interface ViewClient {
  getProgramme(id: number): Promise<Programme | null>;
  listProgrammes(fromIndex?: number, limit?: number): Promise<Programme[]>;
  getProgrammeStats(id: number): Promise<ProgrammeStats>;
  getTipPublic(id: number): Promise<TipPublic | null>;
  getTipForPanel(id: number): Promise<Tip | null>;
}

export const createViewClient = (_rpcUrl: string, _contractId: string): ViewClient => {
  throw new Error("not implemented: S-6.2");
};
