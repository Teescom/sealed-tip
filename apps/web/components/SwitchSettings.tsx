// Dead man's switch; raw opt-in with warning (S-10.4)
export interface SwitchSettingsProps { value: { interval: string; grace: string; includesRaw: boolean } }

export function SwitchSettings(_props: SwitchSettingsProps) {
  return null; // TODO(S-10.4)
}
