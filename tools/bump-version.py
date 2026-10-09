import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VERSIONED_FILES = [
    'styles.css',
    'firebase-config.js',
    'icons.js',
    'app.js',
    'budget.js',
    'recurring.js',
    'debts.js',
    'accounts.js',
    'ai.js',
    'scan.js',
    'home.js',
    'start.js',
]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def app_version():
    m = re.search(r'const APP_VERSION = (\d+);', read('app.js'))
    if not m:
        raise SystemExit('app.js icinde APP_VERSION bulunamadi.')
    return int(m.group(1))


def versions_in_html():
    html = read('index.html')
    out = {}
    for name in VERSIONED_FILES:
        m = re.search(rf'(?:src|href)="{re.escape(name)}\?v=(\d+)"', html)
        if m:
            out[name] = int(m.group(1))
    return out


def versions_in_sw():
    sw = read('sw.js')
    cache = re.search(r"const CACHE = 'butce-v(\d+)';", sw)
    out = {'CACHE': int(cache.group(1))} if cache else {}
    for name in VERSIONED_FILES:
        m = re.search(rf"'\./{re.escape(name)}\?v=(\d+)'", sw)
        if m:
            out[name] = int(m.group(1))
    return out


def validate(expected=None):
    expected = app_version() if expected is None else expected
    html_versions = versions_in_html()
    sw_versions = versions_in_sw()
    versions = {'app.js:APP_VERSION': app_version()}
    versions.update({f'index.html:{k}': v for k, v in html_versions.items()})
    versions.update({f'sw.js:{k}': v for k, v in sw_versions.items()})
    missing = (
        [f'index.html:{name}' for name in VERSIONED_FILES if name not in html_versions]
        + [f'sw.js:{name}' for name in VERSIONED_FILES if name not in sw_versions]
        + (['sw.js:CACHE'] if 'CACHE' not in sw_versions else [])
    )
    wrong = {k: v for k, v in versions.items() if v != expected}
    if missing or wrong:
        if missing:
            print('Eksik surum referanslari:')
            for item in missing:
                print(f'  - {item}')
        if wrong:
            print(f'Surum uyusmazligi (beklenen {expected}):')
            for key, value in sorted(wrong.items()):
                print(f'  - {key}: {value}')
        raise SystemExit(1)
    print(f'Surum tutarli: {expected}')


def bump(target=None):
    v = target or app_version() + 1
    write('app.js', re.sub(r'const APP_VERSION = \d+;', f'const APP_VERSION = {v};', read('app.js')))

    html = read('index.html')
    for name in VERSIONED_FILES:
        html = re.sub(rf'((?:src|href)="{re.escape(name)})(?:\?v=\d+)?"', rf'\1?v={v}"', html)
    write('index.html', html)

    sw = read('sw.js')
    sw = re.sub(r"const CACHE = 'butce-v\d+';", f"const CACHE = 'butce-v{v}';", sw)
    for name in VERSIONED_FILES:
        sw = re.sub(rf"'\./{re.escape(name)}(?:\?v=\d+)?'", f"'./{name}?v={v}'", sw)
    write('sw.js', sw)

    validate(v)


def main():
    parser = argparse.ArgumentParser(description='Butcem yayin surumunu tek yerden artirir ve dogrular.')
    parser.add_argument('--check', action='store_true', help='Sadece surum tutarliligini kontrol et.')
    parser.add_argument('--set', type=int, help='Belirli bir surume ayarla.')
    args = parser.parse_args()
    if args.check:
        validate()
    else:
        bump(args.set)


if __name__ == '__main__':
    main()
