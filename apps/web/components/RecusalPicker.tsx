// Exclude panel members (≥2 must remain) (S-10.4)
export interface RecusalPickerProps {
  panel: string[];
  value: string[];
  onChange: (v: string[]) => void;
}

export function RecusalPicker({ panel, value, onChange }: RecusalPickerProps) {
  const toggle = (member: string) => {
    if (value.includes(member)) {
      onChange(value.filter((m) => m !== member));
    } else {
      if (panel.length - (value.length + 1) < 2) {
        alert("At least 2 non-recused panel members must remain to receive the sealed tip.");
        return;
      }
      onChange([...value, member]);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4">
      <div className="mb-1 font-semibold text-neutral-200">Panel Recusal</div>
      <p className="mb-3 text-xs text-neutral-400">
        Exclude panel members with conflicts of interest. Recused members receive no encryption keys. At least 2 non-recused members must remain.
      </p>
      <div className="space-y-2">
        {panel.map((member) => {
          const isRecused = value.includes(member);
          return (
            <div
              key={member}
              className={`flex items-center justify-between p-2 rounded border text-sm transition-colors ${
                isRecused
                  ? "border-red-800/50 bg-red-950/30 text-red-300"
                  : "border-neutral-800 bg-neutral-950/40 text-neutral-300"
              }`}
            >
              <span className="font-mono">{member}</span>
              <button
                type="button"
                onClick={() => toggle(member)}
                className={`text-xs px-2 py-1 rounded font-medium ${
                  isRecused
                    ? "bg-red-800/40 text-red-200 hover:bg-red-800/60"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {isRecused ? "Recused (Excluded)" : "Active"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
