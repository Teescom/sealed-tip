"""tools/roadmap.py: update ROADMAP.md task rows and recompute header progress.

Recount only (maintainer, after each merge):  python3 tools/roadmap.py ROADMAP.md
Update rows:  python3 tools/roadmap.py ROADMAP.md ID STATUS DATE "notes" [ID STATUS DATE "notes" ...]
STATUS: todo | wip | done | blocked | deferred | cut
"""
import re, sys
ICON = {"todo": "⬜", "wip": "🟡", "done": "✅", "blocked": "🔴", "deferred": "⏸", "cut": "⛔"}
path, args = sys.argv[1], sys.argv[2:]
text = open(path, encoding="utf-8").read()
for i in range(0, len(args), 4):
    tid, st, date, note = args[i:i + 4]
    pat = re.compile(r"^(\| " + re.escape(tid) + r" \|.*?)\| [⬜🟡✅🔴⏸⛔] \|[^|]*\|[^|]*\|$", re.M)
    if not pat.search(text):
        sys.exit(f"task not found: {tid}")
    text = pat.sub(lambda m: f"{m.group(1)}| {ICON[st]} | {date} | {note} |", text, count=1)
rows = re.findall(r"^\| [A-Z]-\d+\.\d+ \| ([MSC]) \|.*\| ([⬜🟡✅🔴⏸⛔]) \|[^|]*\|[^|]*\|$", text, re.M)
live = [(p, s) for p, s in rows if s != "⛔"]
must = [s for p, s in live if p == "M"]
done_m = sum(s == "✅" for s in must); done_all = sum(s == "✅" for _, s in live)
n = {k: sum(p == k for p, _ in live) for k in "MSC"}
text = re.sub(r"\| \*\*Must progress\*\* \|.*\|", f"| **Must progress** | {done_m} / {len(must)} Must tasks done ({round(100*done_m/len(must))}%) |", text)
text = re.sub(r"\| \*\*Overall progress\*\* \|.*\|", f"| **Overall progress** | {done_all} / {len(live)} tasks done ({round(100*done_all/len(live))}%) — {n['M']} Must · {n['S']} Should · {n['C']} Could |", text)
open(path, "w", encoding="utf-8").write(text)
print(f"Must {done_m}/{len(must)} · overall {done_all}/{len(live)}")
