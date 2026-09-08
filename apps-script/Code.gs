/**
 * ══════════════════════════════════════════════════════════════════════
 *  SHORTS FR — stockage du profil dans une Google Sheet
 * ══════════════════════════════════════════════════════════════════════
 *  Petite API JSON au-dessus d'une feuille de calcul. Le client garde son
 *  localStorage comme cache de travail (un feed vertical ne peut pas
 *  attendre 500 ms d'aller-retour à chaque « j'aime ») et pousse ici des
 *  deltas ; au démarrage il tire l'état distant et fusionne.
 *
 *  Points d'attention volontaires :
 *   · Apps Script ne répond PAS aux requêtes préalables CORS (OPTIONS).
 *     Le client envoie donc du `text/plain` pour rester une « simple
 *     request » et ne jamais déclencher de préflight. Ne pas « corriger »
 *     ça en application/json : tout casserait.
 *   · Une cellule Sheets est limitée à 50 000 caractères → les grosses
 *     valeurs (liste des vidéos vues) sont découpées en morceaux.
 *   · LockService sérialise les écritures concurrentes.
 *   · La clé API YouTube ne transite jamais ici : elle reste dans le
 *     navigateur. Cette feuille ne contient que le profil.
 *   · Pas d'authentification : l'URL /exec est le secret. Elle contient un
 *     identifiant long et non devinable (`/macros/s/AKfycb…/exec`), et rien
 *     de destructeur n'est exposé — `resetProfile()` ne s'exécute que depuis
 *     l'éditeur. Traiter cette URL comme un mot de passe : ne pas la publier.
 *
 *  DÉPLOIEMENT
 *   1. script.google.com → Nouveau projet → coller ce fichier
 *   2. Renseigner SHEET_ID ci-dessous
 *   3. Déployer → Nouveau déploiement → type « Application web »
 *        Exécuter en tant que : moi
 *        Qui a accès       : tout le monde
 *   4. Copier l'URL .../exec dans les réglages de l'application
 * ══════════════════════════════════════════════════════════════════════
 */

/** ID de la feuille (dans son URL : /spreadsheets/d/<ID>/edit). */
var SHEET_ID = 'METTRE_ICI_L_ID_DE_LA_FEUILLE';

var VERSION = 1;
var CHUNK = 40000;   // marge sous la limite de 50 000 caractères par cellule

/* Colonnes des onglets tabulaires : première colonne = identifiant. */
var TABLES = {
  channels     : ['channelId', 'title', 'uploads', 'score', 'lang', 'lastPulled', 'discoveredAt'],
  subscriptions: ['channelId', 'title', 'thumb', 'uploads', 'addedAt', 'lastSeenAt', 'newCount'],
  topics       : ['key', 'kind', 'label', 'enabled', 'weight'],
  liked        : ['videoId', 'title', 'channelId', 'likedAt'],
};

/* ─────────────────────────── Points d'entrée ─────────────────────────── */

function doGet(e) {
  return handle((e && e.parameter) || {});
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  /* Les paramètres d'URL restent acceptés : pratique pour tester au navigateur. */
  if (e && e.parameter) for (var k in e.parameter) if (!(k in body)) body[k] = e.parameter[k];
  return handle(body);
}

function handle(req) {
  try {
    var action = req.action || 'ping';
    if (action === 'ping') {
      /* `ping` doit prouver quelque chose. Une réponse vide validait le
         déploiement mais pas SHEET_ID ni les autorisations : le test passait
         alors que rien ne pouvait être écrit. On touche donc réellement la
         feuille — ce qui crée aussi les onglets au premier appel. */
      var p = load();
      return json({ ok: true, version: VERSION, url: book().getUrl(), counts: {
        kv: Object.keys(p.kv).length, channels: p.channels.length,
        subscriptions: p.subscriptions.length, topics: p.topics.length, liked: p.liked.length,
      } });
    }
    if (action === 'load') return json({ ok: true, version: VERSION, profile: load() });
    if (action === 'save') return json(save(req.patch || {}));
    /* Pas de `reset` ici : c'est la seule opération destructrice, et sans
       jeton elle serait à la portée de quiconque connaît l'URL. Elle reste
       disponible en lançant resetProfile() depuis l'éditeur Apps Script. */
    return json({ ok: false, error: 'unknownAction: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ─────────────────────────── Accès à la feuille ─────────────────────────── */

function book() {
  if (!SHEET_ID || SHEET_ID.indexOf('METTRE_ICI') === 0)
    throw new Error('SHEET_ID non renseigné dans Code.gs');
  return SpreadsheetApp.openById(SHEET_ID);
}

/** Récupère un onglet, en le créant avec ses en-têtes s'il manque. */
function tab(name, headers) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ─────────────────────────── Lecture ─────────────────────────── */

function load() {
  var out = { kv: {}, updatedAt: {} };

  /* — onglet kv : [key, value, updatedAt], valeurs longues découpées en key#0, key#1… — */
  var kvSheet = tab('kv', ['key', 'value', 'updatedAt']);
  var rows = kvSheet.getDataRange().getValues();
  var chunks = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0] || '');
    if (!key) continue;
    var hash = key.indexOf('#');
    if (hash > 0) {
      var base = key.substring(0, hash), idx = parseInt(key.substring(hash + 1), 10) || 0;
      if (!chunks[base]) chunks[base] = [];
      chunks[base][idx] = String(rows[i][1] || '');
      out.updatedAt[base] = Math.max(out.updatedAt[base] || 0, +rows[i][2] || 0);
    } else {
      chunks[key] = [String(rows[i][1] || '')];
      out.updatedAt[key] = +rows[i][2] || 0;
    }
  }
  for (var base in chunks) {
    var raw = chunks[base].join('');
    try { out.kv[base] = JSON.parse(raw); } catch (e) { out.kv[base] = null; }
  }

  /* — onglets tabulaires — */
  for (var name in TABLES) {
    var headers = TABLES[name];
    var sh = tab(name, headers);
    var data = sh.getDataRange().getValues();
    var list = [];
    for (var r = 1; r < data.length; r++) {
      if (!data[r][0]) continue;
      var obj = {};
      for (var c = 0; c < headers.length; c++) obj[headers[c]] = data[r][c];
      list.push(obj);
    }
    out[name] = list;
  }
  return out;
}

/* ─────────────────────────── Écriture ─────────────────────────── */

function save(patch) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var now = Date.now();
    var wrote = { kv: 0, rows: 0, removed: 0 };

    if (patch.kv) wrote.kv = writeKV(patch.kv, now);

    for (var name in TABLES) {
      var upserts = patch[name] || [];
      var removes = patch['remove_' + name] || [];
      if (!upserts.length && !removes.length) continue;
      var res = writeTable(name, TABLES[name], upserts, removes);
      wrote.rows += res.wrote;
      wrote.removed += res.removed;
    }
    return { ok: true, version: VERSION, wrote: wrote, at: now };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Une écriture par cellule coûterait un appel Sheets par ligne : avec 300
 * chaînes dans le pool, l'exécution dépasserait la minute et taperait dans
 * les quotas Apps Script. On lit tout, on modifie en mémoire, on réécrit
 * en un seul setValues().
 */
function writeKV(kv, now) {
  var sh = tab('kv', ['key', 'value', 'updatedAt']);
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];

  var kept = [], rowOf = {};
  for (var i = 0; i < rows.length; i++) {
    var k = String(rows[i][0] || '');
    if (!k) continue;
    rowOf[k] = kept.length;
    kept.push(rows[i]);
  }

  var n = 0;
  for (var key in kv) {
    var raw = JSON.stringify(kv[key]);
    var parts = [];
    if (raw.length <= CHUNK) parts.push([key, raw]);
    else for (var p = 0; p * CHUNK < raw.length; p++)
      parts.push([key + '#' + p, raw.substr(p * CHUNK, CHUNK)]);

    /* Les morceaux devenus inutiles sont marqués pour suppression : une
       valeur qui rétrécit ne doit pas laisser de résidus lus au chargement. */
    var live = {};
    for (var j = 0; j < parts.length; j++) live[parts[j][0]] = 1;
    var prefix = key + '#';
    for (var name in rowOf) {
      if (name !== key && name.indexOf(prefix) !== 0) continue;
      if (!live[name]) kept[rowOf[name]] = ['', '', ''];
    }

    for (var j2 = 0; j2 < parts.length; j2++) {
      var nm = parts[j2][0], val = parts[j2][1];
      var line = [nm, val, now];
      if (nm in rowOf && kept[rowOf[nm]][0] === nm) kept[rowOf[nm]] = line;
      else { rowOf[nm] = kept.length; kept.push(line); }
      n++;
    }
  }

  var out = [];
  for (var r = 0; r < kept.length; r++) if (kept[r][0]) out.push(kept[r]);
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, 3).setValues(out);
  return n;
}

function writeTable(name, headers, upserts, removes) {
  var sh = tab(name, headers);
  var w = headers.length;
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, w).getValues() : [];

  var rm = {};
  for (var i = 0; i < removes.length; i++) rm[String(removes[i])] = 1;

  var kept = [], rowOf = {};
  for (var r = 0; r < rows.length; r++) {
    var id = String(rows[r][0] || '');
    if (!id || rm[id]) continue;
    rowOf[id] = kept.length;
    kept.push(rows[r]);
  }

  var wrote = 0;
  for (var u = 0; u < upserts.length; u++) {
    var obj = upserts[u] || {};
    var oid = String(obj[headers[0]] || '');
    if (!oid) continue;
    var line = [];
    for (var c = 0; c < w; c++) {
      var v = obj[headers[c]];
      line.push(v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
    }
    if (oid in rowOf) kept[rowOf[oid]] = line;
    else { rowOf[oid] = kept.length; kept.push(line); }
    wrote++;
  }

  if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, w).setValues(kept);
  return { wrote: wrote, removed: Object.keys(rm).length };
}

/** Vide la feuille. À lancer depuis l'éditeur Apps Script uniquement. */
function resetProfile() {
  var ss = book();
  var names = ['kv'];
  for (var n in TABLES) names.push(n);
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    if (sh) ss.deleteSheet(sh);
  }
  load();   // recrée les onglets vides avec leurs en-têtes
  return { ok: true, reset: names };
}

/* ─────────────────────────── Aides à installer ───────────────────────────
   À lancer une fois depuis l'éditeur Apps Script (bouton « Exécuter »)
   pour créer les onglets et vérifier les droits.                          */
function setup() {
  var p = load();
  Logger.log('Onglets prêts. Clés kv : %s', Object.keys(p.kv).join(', ') || '(aucune)');
  Logger.log('URL de la feuille : %s', book().getUrl());
}
