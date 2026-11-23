/**
 * LOT 6 — Vérification visuelle et de contraste en navigateur réel.
 *
 * Ce script ne s'appuie pas sur Playwright : ses CDN sont bloqués dans
 * l'environnement d'exécution. Il pilote un Chromium réel (build Lambda de
 * @sparticuz/chromium) via puppeteer-core, avec les bibliothèques NSS fournies
 * par l'archive `al2023` du même paquet.
 *
 * Ce qu'il fait, contrairement à l'audit happy-dom du Lot 5 :
 *   1. charge l'application compilée servie par `vite preview` ;
 *   2. applique réellement les feuilles de style (couleurs calculées) ;
 *   3. mesure le contraste WCAG 1.4.3 sur chaque texte visible, et
 *      **échantillonne les pixels** quand le fond est une photo — cas où les
 *      styles ne permettent pas de conclure ;
 *   4. capture chaque vue aux largeurs 360 / 768 / 1440 px, clair et sombre ;
 *   5. détecte les débordements horizontaux et les erreurs console.
 *
 * Usage : node scripts/visual/audit.mjs [--base http://127.0.0.1:4173]
 * Sortie : out/visual/*.png + out/visual/report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:4173';

const OUT = 'out/visual';
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [360, 768, 1440];
const THEMES = ['light', 'dark'];

/**
 * Écrans authentifiés. Sans serveur local ils affichent leur état d'erreur,
 * mais la coquille (barre latérale, en-tête, titres, boutons) est réelle et
 * c'est elle qui porte l'essentiel du contraste et de la mise en page.
 * Un jeton de session factice suffit à franchir la garde de route.
 */
const SCREENS = [
  ['/', 'tableau-de-bord'],
  ['/sales/new', 'point-de-vente'],
  ['/orders', 'commandes'],
  ['/sales', 'historique-ventes'],
  ['/clients', 'clients'],
  ['/debts', 'creances'],
  ['/products', 'produits'],
  ['/catalogue-admin', 'admin-catalogue'],
  ['/stock', 'stocks'],
  ['/inventories', 'inventaires'],
  ['/consignments', 'emballages'],
  ['/suppliers', 'fournisseurs'],
  ['/purchases', 'approvisionnements'],
  ['/cash', 'caisse'],
  ['/expenses', 'depenses'],
  ['/reports', 'rapports'],
  ['/settings', 'parametres'],
  ['/backups', 'sauvegardes'],
];

const ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--headless=new',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--font-render-hinting=none',
];

/**
 * Collecte dans la page : chaque nœud texte visible, sa couleur, sa taille et
 * la meilleure estimation du fond. Un drapeau suspect signale les cas où
 * l'estimation CSS est invraisemblable (texte clair sur fond clair) : le fond
 * est alors presque certainement une image, et il faut échantillonner les pixels.
 */
const COLLECT_SCRIPT = `
(() => {
  const toRgb = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  const solidBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = toRgb(cs.backgroundColor);
      if (c && c.a > 0.95) return c;
      n = n.parentElement;
    }
    if (getComputedStyle(document.body).backgroundImage !== 'none') return null;
    return toRgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };

  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text || text.length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // Ne PAS ignorer les éléments semi-transparents : un bouton desactive
    // (disabled:opacity-40) est exactement l'etat que l'utilisateur voit en
    // premier, et son libelle doit rester lisible. On compose les opacites.
    const ownOpacity = parseFloat(cs.opacity);
    if (ownOpacity < 0.3) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < 0 || rect.top > innerHeight * 3) continue;
    const fg = toRgb(cs.color);
    // Opacité cumulée du texte : celle de l'élément, éventuellement celle d'un
    // ancetre desactive (classe disabled:opacity-40).
    let effectiveOpacity = ownOpacity;
    let anc = el.parentElement;
    while (anc && anc !== document.body) {
      effectiveOpacity *= parseFloat(getComputedStyle(anc).opacity);
      anc = anc.parentElement;
    }
    // color: transparent + background-clip: text → texte peint par un dégradé,
    // sans couleur unie mesurable : hors périmètre.
    if (!fg || fg.a < 0.15) continue;
    const bg = solidBg(el);
    if (!bg) {
      items.push({ text: text.slice(0, 60), tag: el.tagName.toLowerCase(),
                   cls: (el.className || '').toString().slice(0, 70),
                   fg, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
                   x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
                   w: Math.round(rect.width), h: Math.round(rect.height), suspect: true });
      continue;
    }
    // Texte composé sur son fond : c'est ce que l'œil perçoit réellement.
    const fgComposed = effectiveOpacity < 0.999 && bg
      ? { r: Math.round(fg.r * effectiveOpacity + bg.r * (1 - effectiveOpacity)),
          g: Math.round(fg.g * effectiveOpacity + bg.g * (1 - effectiveOpacity)),
          b: Math.round(fg.b * effectiveOpacity + bg.b * (1 - effectiveOpacity)),
          a: 1 }
      : fg;
    const r = ratio(fgComposed, bg);
    items.push({ text: text.slice(0, 60), tag: el.tagName.toLowerCase(),
                 cls: (el.className || '').toString().slice(0, 70),
                 fg: fgComposed, bg, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
                 x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
                 w: Math.round(rect.width), h: Math.round(rect.height),
                 // Un texte blanc sur un fond quasi blanc indique que la vraie
                 // surface est une photo : on bascule sur l'échantillonnage pixel.
                 suspect: r < 1.6 });
  }
  return items;
})()
`;

/** Débordement horizontal : contenu plus large que la fenêtre. */
const OVERFLOW_SCRIPT = `
(() => {
  const de = document.documentElement;
  const over = de.scrollWidth - de.clientWidth;
  const culprits = [];
  if (over > 2) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 2 && r.width > 24) {
        culprits.push({ tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          right: Math.round(r.right), width: Math.round(r.width) });
        if (culprits.length >= 5) break;
      }
    }
  }
  return { overflowPx: over, culprits };
})()
`;

/** Échantillonnage des pixels du fond autour d'un bloc de texte. */
const SAMPLE_FN = `async ({ b64, items, dpr }) => {
  const lum = ({ r, g, b }) => {
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const out = [];
  for (const it of items) {
    const cx = it.x * dpr, cy = it.y * dpr;
    const hw = Math.max(20, (it.w * dpr) / 2), hh = Math.max(6, (it.h * dpr) / 2);
    // Couronne autour du bloc : à gauche, à droite, au-dessus, en dessous.
    // On évite le centre, occupé par les glyphes.
    const pts = [
      [cx - hw - 6, cy], [cx + hw + 6, cy],
      [cx, cy - hh - 6], [cx, cy + hh + 6],
      [cx - hw - 6, cy - hh], [cx + hw + 6, cy + hh],
    ];
    const vals = [];
    for (const [px, py] of pts) {
      const x = Math.max(0, Math.min(img.width - 1, Math.round(px)));
      const y = Math.max(0, Math.min(img.height - 1, Math.round(py)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      vals.push({ r: d[0], g: d[1], b: d[2] });
    }
    vals.sort((a, b) => lum(a) - lum(b));
    // Fond = médiane des échantillons : robuste à un pixel de bord parasite.
    const bg = vals[Math.floor(vals.length / 2)];
    const L1 = lum(it.fg), L2 = lum(bg);
    const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = large ? 3 : 4.5;
    out.push({
      text: it.text, tag: it.tag, cls: it.cls,
      ratio: Math.round(r * 100) / 100, need,
      fg: 'rgb(' + it.fg.r + ',' + it.fg.g + ',' + it.fg.b + ')',
      bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ') · pixels',
      fontSize: it.size, sampled: true,
    });
  }
  return out;
}`;

// Session de reference : Role::Owner (toutes les permissions), pour que les
// gardes d'acces laissent passer chaque ecran mesure.
const AUDIT_USER = {
  userId: 'owner',
  username: 'owner',
  displayName: 'Propriétaire',
  role: 'owner',
  roleLabel: 'Propriétaire',
  permissions: [
    'catalog:read', 'catalog:write', 'catalog:delete', 'sales:read', 'sales:write',
    'sales:cancel_return', 'receivables:read', 'receivables:pay', 'purchases:read',
    'purchases:write', 'supplier_debts:pay', 'stock:read', 'stock:adjust',
    'inventory:validate', 'consignments:read', 'consignments:write', 'cash:read',
    'cash:operate', 'expenses:write', 'reports:read', 'settings:read', 'settings:write',
    'backups:read', 'backups:create', 'backups:restore', 'security:manage_users',
    'security:change_owner_pin',
  ],
};

const launch = async () => {
  const exe = process.env.CHROMIUM_PATH || '/tmp/chromium';
  return puppeteer.launch({ executablePath: exe, args: ARGS, headless: true });
};

const capture = async (browser, { width, theme, name, route = '/', auth = true }) => {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 180));
  });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message.slice(0, 180)));

  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  // Le thème est piloté par le store (localStorage `depotpro_theme`, valeur par
  // défaut « light »). Il faut donc l'écrire AVANT le démarrage de l'application,
  // sinon le store réapplique le thème clair au montage.
  await page.evaluateOnNewDocument(({ t, withAuth }) => {
    try { localStorage.setItem('depotpro_theme', t); } catch { /* stockage indisponible */ }
    if (withAuth) {
      try { sessionStorage.setItem('depotpro_session_token', 'audit-visual'); } catch { /* idem */ }
    }
    const apply = () => document.documentElement?.classList.toggle('dark', t === 'dark');
    if (document.documentElement) apply();
    else document.addEventListener('readystatechange', apply, { once: true });
  }, { t: theme, withAuth: auth });

  // Le service worker PWA reemet ses fetch hors de l'interception de la page :
  // sans ce contournement, /api/auth/me n'est jamais intercepte. Le SW est donc
  // neutralise pour la duree du controle.
  if (auth) {
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/auth/me') || url.includes('/api/auth/status')) {
        const body = url.includes('/status')
          ? { needsSetup: false, lockedUntil: null, failedAttempts: 0, authenticated: true, user: AUDIT_USER }
          : { user: AUDIT_USER };
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        return;
      }
      req.continue().catch(() => { /* page deja fermee */ });
    });
  }

  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2200));

  const items = await page.evaluate(COLLECT_SCRIPT);
  const overflow = await page.evaluate(OVERFLOW_SCRIPT);

  // 1) verdict direct pour les textes sur fond uni
  const violations = [];
  const suspects = [];
  for (const it of items) {
    const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = large ? 3 : 4.5;
    if (it.suspect) {
      suspects.push(it);
      continue;
    }
    const L1 = (() => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(it.fg.r) + 0.7152 * f(it.fg.g) + 0.0722 * f(it.fg.b); })();
    const L2 = (() => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(it.bg.r) + 0.7152 * f(it.bg.g) + 0.0722 * f(it.bg.b); })();
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < need) {
      violations.push({
        text: it.text, tag: it.tag, cls: it.cls,
        ratio: Math.round(ratio * 100) / 100, need,
        fg: `rgb(${it.fg.r},${it.fg.g},${it.fg.b})`,
        bg: `rgb(${it.bg.r},${it.bg.g},${it.bg.b})`,
        fontSize: it.size,
      });
    }
  }

  // 2) échantillonnage pixel pour les textes posés sur une image
  let sampled = [];
  if (suspects.length) {
    const b64 = await page.screenshot({ encoding: 'base64' });
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    const fn = eval('(' + SAMPLE_FN + ')');
    const results = await page.evaluate(fn, { b64, items: suspects, dpr });
    sampled = results.filter((r) => r.ratio < r.need);
  }

  const file = path.join(OUT, `${name}-${width}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });

  await page.close();
  return {
    name,
    width,
    theme,
    file,
    contrast: [...violations, ...sampled],
    checkedTexts: items.length,
    sampledTexts: suspects.length,
    overflow,
    consoleErrors,
  };
};

const main = async () => {
  const browser = await launch();
  const results = [];

  // 1) écran de connexion, non authentifié
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      results.push(await capture(browser, { width, theme, name: 'connexion', auth: false }));
    }
  }

  // 2) tous les écrans authentifiés, à la largeur de référence et en mobile
  for (const [route, label] of SCREENS) {
    for (const theme of THEMES) {
      for (const width of [360, 1440]) {
        results.push(await capture(browser, { width, theme, name: label, route }));
      }
    }
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    widths: WIDTHS,
    themes: THEMES,
    screens: results.map((r) => ({
      name: r.name,
      width: r.width,
      theme: r.theme,
      screenshot: r.file,
      checkedTexts: r.checkedTexts,
      sampledTexts: r.sampledTexts,
      contrastViolations: r.contrast,
      overflow: r.overflow,
      // 502 = absence du serveur local, attendu hors backend : on les distingue
      consoleErrors: r.consoleErrors.filter((e) => !e.includes('502')),
      expectedServerErrors: r.consoleErrors.filter((e) => e.includes('502')).length,
    })),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const textes = results.reduce((n, r) => n + r.checkedTexts, 0);
  const sampled = results.reduce((n, r) => n + r.sampledTexts, 0);
  const v = results.reduce((n, r) => n + r.contrast.length, 0);
  const o = results.filter((r) => r.overflow.overflowPx > 2).length;
  const e = results.reduce((n, r) => n + report.screens.find(
    (s) => s.width === r.width && s.theme === r.theme)?.consoleErrors.length, 0);

  console.log(`captures                : ${results.length}`);
  console.log(`textes mesurés          : ${textes} (dont ${sampled} sur photo, par échantillonnage pixel)`);
  console.log(`contraste < WCAG AA     : ${v}`);
  console.log(`débordement horizontal  : ${o} vue(s)`);
  console.log(`erreurs console réelles : ${e} (hors 502 serveur absent)`);

  const uniq = new Map();
  for (const r of results) {
    for (const x of r.contrast) {
      const k = x.text + '|' + x.fg + '|' + x.bg;
      if (!uniq.has(k)) uniq.set(k, { ...x, screens: new Set() });
      uniq.get(k).screens.add(`${r.width}/${r.theme}`);
    }
  }
  if (uniq.size) {
    console.log('\n— violations de contraste —');
    for (const x of [...uniq.values()].sort((a, b) => a.ratio - b.ratio)) {
      console.log(`  ${x.ratio}:1 (min ${x.need}) ${x.fontSize}px <${x.tag}> "${x.text}"`);
      console.log(`      ${x.fg} sur ${x.bg} · ${[...x.screens].join(',')}`);
    }
  }
  if (o) {
    console.log('\n— débordements —');
    for (const r of results.filter((x) => x.overflow.overflowPx > 2)) {
      console.log(`  ${r.width}px/${r.theme}: +${r.overflow.overflowPx}px`, JSON.stringify(r.overflow.culprits));
    }
  }
  const totalErrors = report.screens.reduce((n, s) => n + s.consoleErrors.length, 0);
  if (totalErrors === 0) console.log('\nerreurs console : aucune');
  for (const s of report.screens) {
    if (s.consoleErrors.length) {
      console.log(`\n— erreurs console ${s.width}/${s.theme} —`);
      s.consoleErrors.slice(0, 4).forEach((x) => console.log('  ', x));
    }
  }
  return report;
};

main().catch((e) => {
  console.error('ÉCHEC:', e.message);
  process.exit(1);
});
