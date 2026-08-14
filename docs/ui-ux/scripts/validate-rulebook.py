#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rules_path = root / 'ui-ux-rules.json'
markdown_path = root / 'UI_UX_FRONTEND_PRODUCT_ENGINEERING_RULEBOOK.md'

data = json.loads(rules_path.read_text(encoding='utf-8'))
rules = data['rules']
assert data['metadata']['rule_count'] == 1000
assert data['metadata']['chapter_count'] == 50
assert len(rules) == 1000
ids = [rule['id'] for rule in rules]
assert ids == [f'UXR-{i:04d}' for i in range(1, 1001)]
assert len(set(ids)) == 1000
assert {rule['chapter'] for rule in rules} == set(range(1, 51))
assert all(rule['priority'] in {'P0', 'P1', 'P2', 'P3'} for rule in rules)
assert all(rule['level'] in {'MUST', 'MUST NOT', 'SHOULD', 'SHOULD NOT', 'MAY'} for rule in rules)
assert all(rule['automation'] in {'AUTO', 'SEMI', 'MANUAL'} for rule in rules)
markdown = markdown_path.read_text(encoding='utf-8')
for rule_id in ids:
    assert re.search(rf'^### {re.escape(rule_id)}\b', markdown, re.MULTILINE), rule_id
print('Rulebook validation passed: 50 chapters, 1,000 sequential rules, Markdown/JSON parity.')
