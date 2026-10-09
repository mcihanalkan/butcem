import re, json, sys
from pathlib import Path

# Uygulamada kullanılan ikonları tek dosyada (icons.js) toplar.
# Kaynak: npm'deki lucide-static paketinin icons/ klasörü (npm pack lucide-static → aç).
# Kullanım: python tools/build-icons.py <lucide-static/icons klasörü>
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('C:/Users/HP/AppData/Local/Temp/lucide_icons')
OUT = Path(__file__).resolve().parent.parent / 'icons.js'

UI = ['house', 'lock', 'delete', 'cloud-upload', 'list', 'target', 'credit-card', 'chart-column', 'settings', 'plus', 'chevron-left', 'chevron-right',
      'chevron-down', 'x', 'arrow-up-down', 'arrow-down-left', 'arrow-up-right', 'check', 'triangle-alert', 'circle-alert',
      'info', 'clock', 'calendar', 'repeat', 'trash-2', 'pencil', 'search', 'refresh-cw', 'cloud', 'cloud-off', 'log-out',
      'download', 'upload', 'file-spreadsheet', 'tags', 'wallet', 'landmark', 'banknote', 'circle-check', 'skip-forward',
      'undo-2', 'send', 'arrow-right', 'bell', 'scan-search', 'chart-no-axes-combined', 'gauge', 'lightbulb', 'message-circle',
      'circle-plus', 'ellipsis', 'sliders-horizontal', 'arrow-left-right', 'circle-pause', 'hand-coins', 'receipt', 'percent',
      'mic', 'flag', 'chart-line', 'calendar-days', 'file-text', 'printer', 'trending-down', 'badge-percent', 'party-popper', 'arrow-up', 'arrow-down', 'minus']

# emoji → ikon (varsayılan kategoriler ve eski kayıtlar için)
EMOJI = {
  '🛒': 'shopping-cart', '🍽️': 'utensils', '☕': 'coffee', '🍔': 'sandwich', '🥖': 'croissant', '🍕': 'pizza', '🥗': 'salad',
  '🍰': 'cake-slice', '🍺': 'beer', '🚌': 'bus', '🚇': 'train-front', '⛽': 'fuel', '🚕': 'car-taxi-front', '🚗': 'car',
  '🏍️': 'bike', '🚲': 'bike', '✈️': 'plane', '🏨': 'hotel', '🏠': 'house', '🏢': 'building-2', '💡': 'lightbulb',
  '🚿': 'droplet', '🔥': 'flame', '🌐': 'wifi', '📱': 'smartphone', '📺': 'tv', '🎵': 'music', '👕': 'shirt',
  '👟': 'footprints', '👜': 'shopping-bag', '💇': 'scissors', '💄': 'brush', '🏥': 'hospital', '💊': 'pill',
  '🦷': 'stethoscope', '👓': 'glasses', '🏋️': 'dumbbell', '⚽': 'volleyball', '📚': 'library', '📖': 'book-open',
  '✏️': 'pencil', '🎓': 'graduation-cap', '🎉': 'party-popper', '🎬': 'clapperboard', '🎮': 'gamepad-2', '🎨': 'palette',
  '🎁': 'gift', '🤲': 'hand-heart', '🐾': 'paw-print', '🧸': 'baby', '👶': 'baby', '🛋️': 'sofa', '🧹': 'spray-can',
  '💻': 'laptop', '🔧': 'wrench', '🛡️': 'shield', '🧾': 'receipt', '💳': 'credit-card', '🏦': 'landmark', '🚬': 'cigarette',
  '💼': 'briefcase', '🧑‍💻': 'laptop-minimal', '👛': 'wallet', '🏆': 'trophy', '🏘️': 'building', '📈': 'trending-up',
  '🏷️': 'tag', '🔄': 'rotate-ccw', '💰': 'piggy-bank', '💵': 'banknote', '🪙': 'coins', '➕': 'circle-plus', '📦': 'package',
  '❤️': 'heart', '⭐': 'star', '🕌': 'landmark', '🎂': 'cake', '💍': 'gem', '🌱': 'sprout', '🧳': 'luggage', '🏧': 'banknote',
  '🎯': 'target', '❔': 'circle-help',
}
# Kategori formundaki ikon seçici
PICKER = ['shopping-cart', 'utensils', 'coffee', 'sandwich', 'croissant', 'pizza', 'salad', 'cake-slice', 'beer', 'wine',
          'bus', 'train-front', 'fuel', 'car-taxi-front', 'car', 'bike', 'plane', 'hotel', 'luggage', 'house', 'building-2',
          'lightbulb', 'droplet', 'flame', 'wifi', 'smartphone', 'tv', 'music', 'shirt', 'footprints', 'shopping-bag', 'scissors',
          'brush', 'hospital', 'pill', 'stethoscope', 'glasses', 'dumbbell', 'volleyball', 'library', 'book-open', 'pencil',
          'graduation-cap', 'party-popper', 'clapperboard', 'gamepad-2', 'palette', 'gift', 'hand-heart', 'paw-print', 'baby',
          'sofa', 'spray-can', 'laptop', 'wrench', 'shield', 'receipt', 'credit-card', 'landmark', 'cigarette', 'briefcase',
          'laptop-minimal', 'wallet', 'trophy', 'building', 'trending-up', 'tag', 'rotate-ccw', 'piggy-bank', 'banknote', 'coins',
          'circle-plus', 'package', 'heart', 'star', 'cake', 'gem', 'sprout', 'phone', 'mail', 'film', 'headphones', 'camera',
          'flower-2', 'tree-pine', 'umbrella', 'zap', 'key-round', 'hammer', 'ticket', 'store', 'utensils-crossed', 'ice-cream-cone']

names = sorted(set(UI + list(EMOJI.values()) + PICKER))
icons, missing = {}, []
for n in names:
    f = SRC / f'{n}.svg'
    if not f.exists():
        missing.append(n); continue
    svg = f.read_text(encoding='utf-8')
    inner = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
    inner = re.sub(r'\s+', ' ', inner).replace('> <', '><').strip()
    icons[n] = inner
if missing:
    print('EKSIK:', missing); sys.exit(1)

js = f"""'use strict';
/* Çizgisel ikonlar (Lucide, ISC lisansı — https://lucide.dev). Bu dosya tools/build-icons.py ile üretilir. */
const ICONS = {json.dumps(icons, ensure_ascii=False, indent=0)};
// Eski kayıtlardaki emojiler ve varsayılan kategoriler için karşılık gelen ikon
const EMOJI_ICON = {json.dumps(EMOJI, ensure_ascii=False)};
const ICON_PICKER = {json.dumps(PICKER)};

// ikon('house') → <svg> ; boyut piksel
function icon(name, size = 20, cls = '') {{
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="i ${{cls}}" width="${{size}}" height="${{size}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{body}}</svg>`;
}}

// Kategori/hesap simgesi: "lc:isim" → ikon; bilinen emoji → karşılığı olan ikon; diğerleri olduğu gibi
function glyph(value, size = 20) {{
  const v = String(value || '');
  if (v.startsWith('lc:')) return icon(v.slice(3), size) || esc(v);
  if (EMOJI_ICON[v]) return icon(EMOJI_ICON[v], size);
  return `<span class="emo">${{esc(v)}}</span>`;
}}
"""
OUT.write_text(js, encoding='utf-8')
print(len(icons), 'ikon,', OUT.stat().st_size // 1024, 'KB')
