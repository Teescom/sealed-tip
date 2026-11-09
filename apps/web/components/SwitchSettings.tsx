// Dead man's switch; raw opt-in with warning (S-10.4)
export interface SwitchSettingsProps {
  value: { interval: string; grace: string; includesRaw: boolean };
  onChange?: (v: { interval: string; grace: string; includesRaw: boolean }) => void;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}

export function SwitchSettings({
  value,
  onChange,
  enabled = false,
  onToggle,
}: SwitchSettingsProps) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-neutral-200">Dead Man's Switch</span>
        {onToggle && (
          <button
            type="button"
            onClick={() => onToggle(!enabled)}
            className={`text-xs px-3 py-1 rounded font-medium ${
              enabled
                ? "bg-amber-600 text-white"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {enabled ? "Armed" : "Disabled"}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-400 mb-3">
        If you fail to check in within the interval plus grace period, the switch triggers and the keeper releases the encryption key to non-recused panel members.
      </p>
      {enabled && onChange && (
        <div className="space-y-3 pt-2 border-t border-neutral-800">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-neutral-300 mb-1">Check-in Interval (days)</label>
              <input
                type="number"
                min="1"
                value={value.interval}
                onChange={(e) => onChange({ ...value, interval: e.target.value })}
                className="w-full bg-black/50 border border-neutral-700 rounded px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-neutral-300 mb-1">Grace Period (days)</label>
              <input
                type="number"
                min="0"
                value={value.grace}
                onChange={(e) => onChange({ ...value, grace: e.target.value })}
                className="w-full bg-black/50 border border-neutral-700 rounded px-2 py-1 text-white"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={value.includesRaw}
              onChange={(e) => onChange({ ...value, includesRaw: e.target.checked })}
              className="mt-0.5"
            />
            <div className="text-xs text-neutral-300">
              <span className="font-medium">Include uncleaned raw originals in exhibit</span>
              <p className="text-amber-400/90 text-[11px] mt-0.5">
                Warning: Raw originals contain unstripped metadata. Opting in gives the panel these files at triage as well.
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
