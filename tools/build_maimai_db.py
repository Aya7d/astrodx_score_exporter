"""
Maimai DX Offline Database Builder & Merger
Compiles raw maimai dataset (data/maimai_data.json) into a compact, optimized
offline database (src/data/maimai_db.json) covering all versions and regions.
"""

import json
import os

def build_database():
    data_path = os.path.join('data', 'maimai_data.json')
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Source dataset not found: {data_path}")

    with open(data_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    db = {}
    for s in raw.get('songs', []):
        title = s.get('title')
        if not title:
            continue
        song_id = s.get('songId') or ''
        version = s.get('version') or ''
        genre = s.get('category') or ''

        if title not in db:
            db[title] = {
                'songId': song_id,
                'version': version,
                'genre': genre,
                'sheets': []
            }

        for sh in s.get('sheets', []):
            stype = sh.get('type', 'dx')
            diff = sh.get('difficulty', 'master')
            lvl = str(sh.get('level', '')).strip()
            notes = (sh.get('noteCounts') or {}).get('total') or 0

            regions = sh.get('regions') or {}
            in_intl = bool(regions.get('intl', True))
            in_jp = bool(regions.get('jp', True))
            in_cn = bool(regions.get('cn', False))

            intl_ov = (sh.get('regionOverrides') or {}).get('intl') or {}
            intl_lvl = str(intl_ov.get('level') or lvl).strip()
            intl_notes = (intl_ov.get('noteCounts') or {}).get('total') or notes

            sheet_obj = {
                'type': stype,
                'diff': diff,
                'level': lvl,
                'notes': notes,
                'inIntl': in_intl,
                'inJp': in_jp,
                'inCn': in_cn,
                'intlLevel': intl_lvl,
                'intlNotes': intl_notes
            }

            # Merge without losing distinct chart variants
            exists = False
            for ex in db[title]['sheets']:
                if ex['type'] == stype and ex['diff'] == diff:
                    if notes > 0 and ex['notes'] == 0:
                        ex['notes'] = notes
                    if intl_notes > 0 and ex['intlNotes'] == 0:
                        ex['intlNotes'] = intl_notes
                    ex['inIntl'] = ex['inIntl'] or in_intl
                    ex['inJp'] = ex['inJp'] or in_jp
                    ex['inCn'] = ex.get('inCn', False) or in_cn
                    exists = True
                    break
            if not exists:
                db[title]['sheets'].append(sheet_obj)

    out_dir = os.path.join('src', 'data')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'maimai_db.json')

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, separators=(',', ':'))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"Generated {out_path} successfully!")
    print(f"Total songs: {len(db)}, Total sheets: {sum(len(v['sheets']) for v in db.values())}, Size: {size_kb:.1f} KB")

if __name__ == '__main__':
    build_database()
