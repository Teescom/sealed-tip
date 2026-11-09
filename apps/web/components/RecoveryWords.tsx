// Show 24 words once, with save-offline warning (S-10.4)
export interface RecoveryWordsProps {
  words: string[];
}

export function RecoveryWords({ words }: RecoveryWordsProps) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 text-amber-200">
      <div className="mb-2 font-semibold text-amber-300">
        Recovery Words (Save Offline Now)
      </div>
      <p className="mb-3 text-xs text-amber-400">
        You have no account. These 24 words are your ONLY key to check status, check in with the dead man's switch, and claim your reward. Never share them with anyone.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 font-mono text-sm">
        {words.map((w, i) => (
          <div key={i} className="rounded bg-black/40 px-2 py-1 text-center border border-amber-800/30">
            <span className="text-amber-500 text-xs mr-1">{i + 1}.</span> {w}
          </div>
        ))}
      </div>
    </div>
  );
}
