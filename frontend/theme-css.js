// theme-css.js — THE single source of truth for turning a tournament's stored
// theme colours into CSS. Shared by browser and server, the same
// dual-environment pattern as settings-defaults.js:
//   - Browser: loaded before tt-common.js; defines the globals used by each
//     page's applyThemeColors() when settings change without a reload.
//   - Server: api/server.js require()s it from the read-only /frontend mount
//     and serves the result at /theme.css, so a branded page is branded in its
//     FIRST paint instead of flashing the stock palette first.
//
// Both halves must derive light-mode colours identically — if they drift, a
// page changes appearance the moment its JS runs, which is the exact bug this
// file exists to remove.

function ttHexToHsl(hex) {
  var r = parseInt(hex.slice(1, 3), 16) / 255,
      g = parseInt(hex.slice(3, 5), 16) / 255,
      b = parseInt(hex.slice(5, 7), 16) / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, s = 0, h = 0;
  if (max !== min) {
    var d = max - min;
    s = d / (l > 0.5 ? 2 - max - min : max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function ttHslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  var r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var hue = function (t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue(h + 1 / 3); g = hue(h); b = hue(h - 1 / 3);
  }
  return '#' + [r, g, b].map(function (x) {
    return Math.round(x * 255).toString(16).padStart(2, '0');
  }).join('');
}

// Dark-mode colours are bright (high L). Light mode drops lightness ~40% so
// they still carry contrast on white.
function ttLightModeColor(hex) {
  var hsl = ttHexToHsl(hex);
  return ttHslToHex(hsl[0], hsl[1], Math.max(10, hsl[2] - 40));
}

// Which stored colour drives which custom properties.
var TT_THEME_VAR_MAP = {
  accent:      ['--gold', '--gold-lt'],
  interactive: ['--blue', '--blue-lt'],
  winColor:    ['--win-color'],
  loseColor:   ['--lose-color'],
};

var TT_HEX_RE = /^#[0-9a-fA-F]{6}$/;

// The full stylesheet for one tournament's branding: the dark/default values,
// the light-mode overrides, and the logo scale. Returns '' when a tournament
// has no branding at all, so an unbranded install serves an empty file rather
// than a pile of no-op rules.
//
// MUST be linked after base.css — these are plain `:root` and `body.light`
// rules of equal specificity, so they win on order alone.
function ttThemeCss(tc, scales, defaultScale) {
  tc = tc || {};
  var root = [], light = [];
  Object.keys(TT_THEME_VAR_MAP).forEach(function (key) {
    var v = tc[key];
    if (!TT_HEX_RE.test(v || '')) return;   // never interpolate unvalidated text
    var lc = ttLightModeColor(v);
    TT_THEME_VAR_MAP[key].forEach(function (prop) {
      root.push(prop + ':' + v + ';');
      light.push(prop + ':' + lc + ';');
    });
  });
  var s = (scales && (scales[tc.logoScale] || scales[defaultScale])) || null;
  if (s) {
    root.push('--logo-h:' + s.h + ';--logo-maxw:' + s.maxw + ';');
    root.push('--logo-h-sm:' + s.hSm + ';--logo-maxw-sm:' + s.maxwSm + ';');
  }
  if (!root.length) return '';
  return ':root{' + root.join('') + '}\n'
    + (light.length ? 'body.light{' + light.join('') + '}\n' : '');
}

if (typeof module !== 'undefined') {
  module.exports = {
    ttHexToHsl, ttHslToHex, ttLightModeColor, ttThemeCss,
    TT_THEME_VAR_MAP, TT_HEX_RE,
  };
}
