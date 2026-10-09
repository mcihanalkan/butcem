# Sürüm numarasını her yerde birlikte artırır: index.html (?v=), sw.js (önbellek adı + dosya listesi), app.js (APP_VERSION).
# Kullanım: python tools/bump-version.py
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
app = (root / 'app.js').read_text(encoding='utf-8')
v = int(re.search(r'const APP_VERSION = (\d+);', app).group(1)) + 1

(root / 'app.js').write_text(re.sub(r'const APP_VERSION = \d+;', f'const APP_VERSION = {v};', app), encoding='utf-8')

html = (root / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'(src|href)="((?:styles\.css|[a-z-]+\.js))(?:\?v=\d+)?"', lambda m: f'{m.group(1)}="{m.group(2)}?v={v}"', html)
(root / 'index.html').write_text(html, encoding='utf-8')

sw = (root / 'sw.js').read_text(encoding='utf-8')
sw = re.sub(r"const CACHE = 'butce-v\d+';", f"const CACHE = 'butce-v{v}';", sw)
sw = re.sub(r"'\./((?:styles\.css|[a-z-]+\.js))(?:\?v=\d+)?'", lambda m: f"'./{m.group(1)}?v={v}'", sw)
(root / 'sw.js').write_text(sw, encoding='utf-8')

print(f'Sürüm {v}')
