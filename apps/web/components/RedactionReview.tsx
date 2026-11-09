// Accept/edit AI redaction suggestions (S-10.4)
export interface RedactionReviewProps {
  suggestions: { span: string; reason: string; replacement: string }[];
  onAccept?: (idx: number) => void;
  onReject?: (idx: number) => void;
}

export function RedactionReview({ suggestions, onAccept, onReject }: RedactionReviewProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 text-purple-200 text-sm">
      <div className="mb-1 font-semibold text-purple-300">AI Redaction Suggestions</div>
      <p className="mb-3 text-xs text-purple-400">
        Review flagged identity-revealing phrases identified by the attested NEAR AI enclave.
      </p>
      <div className="space-y-2">
        {suggestions.map((s, idx) => (
          <div key={idx} className="rounded bg-black/40 p-2 border border-purple-900/30 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-red-400 font-mono line-through">"{s.span}"</span>
              <span className="text-emerald-400 font-mono font-medium">→ "{s.replacement}"</span>
            </div>
            <div className="text-neutral-400 mt-1 italic">{s.reason}</div>
            {(onAccept || onReject) && (
              <div className="mt-2 flex gap-2 justify-end">
                {onReject && (
                  <button
                    type="button"
                    onClick={() => onReject(idx)}
                    className="px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded hover:bg-neutral-700"
                  >
                    Keep Original
                  </button>
                )}
                {onAccept && (
                  <button
                    type="button"
                    onClick={() => onAccept(idx)}
                    className="px-2 py-0.5 bg-purple-700 text-white rounded hover:bg-purple-600"
                  >
                    Accept Replacement
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
