// Verified enclave panel (quote, nonce, signature) (S-10.4)
export interface AttestationPanelProps {
  bundleHash: string;
  model?: string | undefined;
  nonce?: string | undefined;
}

export function AttestationPanel({ bundleHash, model, nonce }: AttestationPanelProps) {
  return (
    <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 p-4 text-sky-200 text-xs">
      <div className="mb-1 font-semibold text-sky-300 flex items-center gap-1.5">
        <span>🔒 Verified TEE Attestation</span>
      </div>
      <p className="text-sky-400 mb-2">
        Verified against the NEAR AI Cloud Intel TDX hardware attestation quote. Text never touches un-attested servers.
      </p>
      <div className="font-mono space-y-1 text-[11px] text-sky-300 break-all">
        <div>
          <span className="text-sky-500">Hash: </span>
          {bundleHash}
        </div>
        {model && (
          <div>
            <span className="text-sky-500">Model: </span>
            {model}
          </div>
        )}
        {nonce && (
          <div>
            <span className="text-sky-500">Nonce: </span>
            {nonce.slice(0, 16)}…
          </div>
        )}
      </div>
    </div>
  );
}
