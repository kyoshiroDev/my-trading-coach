#!/usr/bin/env python3
"""Analyse la sortie CSV de k6 (PROMPT-136) : latences p50/p95/p99 et erreurs par endpoint et par palier.

    k6 run --out csv=/tmp/k6.csv ... tools/load-tests/k6/us-open.js
    python3 tools/load-tests/analyze.py /tmp/k6.csv [STAGE_MIN] [RAMP_MIN] [TARGETS, ex. 500,1000]

Les paliers sont retrouvés à partir de l'horodatage (même découpage que `options.stages`) : seules les
requêtes du PLATEAU de chaque palier sont comptées (les rampes sont exclues).
"""
import csv
import sys
from collections import defaultdict

path = sys.argv[1]
stage_min = float(sys.argv[2]) if len(sys.argv) > 2 else 5
ramp_min = float(sys.argv[3]) if len(sys.argv) > 3 else 1
targets = [int(v) for v in (sys.argv[4] if len(sys.argv) > 4 else '100,250,500,1000').split(',')]

# Bornes [début, fin[ du plateau de chaque palier, en secondes depuis le début du test.
plateaus = []
t = 0.0
for vus in targets:
    t += ramp_min * 60
    plateaus.append((vus, t, t + stage_min * 60))
    t += stage_min * 60


def pct(values, p):
    if not values:
        return float('nan')
    values = sorted(values)
    k = min(len(values) - 1, max(0, int(round(p / 100 * (len(values) - 1)))))
    return values[k]


dur = defaultdict(list)       # (stage, name) -> [ms]
fails = defaultdict(int)      # (stage, name) -> n
status_count = defaultdict(lambda: defaultdict(int))
t0 = None
with open(path) as f:
    for row in csv.DictReader(f):
        if row['metric_name'] not in ('http_req_duration', 'http_req_failed'):
            continue
        ts = float(row['timestamp'])
        t0 = ts if t0 is None else min(t0, ts)
        row['_ts'] = ts
        # 2e passe inutile : k6 écrit dans l'ordre chronologique, t0 est la 1re ligne.
        rel = ts - t0
        stage = next((v for v, a, b in plateaus if a <= rel < b), None)
        if stage is None:
            continue
        name = row.get('name') or row.get('url')
        # Les tags personnalisés (kind) sont dans la colonne `extra_tags` : "kind=read&…".
        extra = dict(kv.split('=', 1) for kv in (row.get('extra_tags') or '').split('&') if '=' in kv)
        kind = row.get('kind') or extra.get('kind', '')
        if row['metric_name'] == 'http_req_duration':
            dur[(stage, name, kind)].append(float(row['metric_value']))
            status_count[(stage, name, kind)][row.get('status', '')] += 1
        elif float(row['metric_value']) == 1:
            fails[(stage, name, kind)] += 1

print('| Palier | Endpoint | type | req | req/s | p50 ms | p95 ms | p99 ms | erreurs | statuts |')
print('|---|---|---|---|---|---|---|---|---|---|')
by_stage = defaultdict(lambda: {'n': 0, 'f': 0, 'r': [], 'w': []})
for (stage, name, kind), values in sorted(dur.items(), key=lambda kv: (kv[0][0], kv[0][1])):
    n = len(values)
    f = fails[(stage, name, kind)]
    by_stage[stage]['n'] += n
    by_stage[stage]['f'] += f
    by_stage[stage]['r' if kind == 'read' else 'w'].extend(values)
    statuses = ' '.join(f'{s}:{c}' for s, c in sorted(status_count[(stage, name, kind)].items()))
    print(f'| {stage} | {name} | {kind} | {n} | {n / (stage_min * 60):.1f} | {pct(values, 50):.0f} | '
          f'{pct(values, 95):.0f} | {pct(values, 99):.0f} | {100 * f / n:.2f} % | {statuses} |')

print()
print('| Palier | req/s | lecture p50 | lecture p95 | lecture p99 | écriture p50 | écriture p95 | écriture p99 | erreurs |')
print('|---|---|---|---|---|---|---|---|---|')
for stage in sorted(by_stage):
    s = by_stage[stage]
    print(f"| {stage} | {s['n'] / (stage_min * 60):.0f} | {pct(s['r'], 50):.0f} | {pct(s['r'], 95):.0f} | "
          f"{pct(s['r'], 99):.0f} | {pct(s['w'], 50):.0f} | {pct(s['w'], 95):.0f} | {pct(s['w'], 99):.0f} | "
          f"{100 * s['f'] / max(1, s['n']):.2f} % |")
