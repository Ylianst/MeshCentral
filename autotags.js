/**
* @description MeshCentral automatic device tags
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Generates device tags from rules in the domain's "autoTags" config section.
//
// A rule reads values from the device and turns them into tags with a template, for example "SN:{hardware.identifiers.bios_serial}".
// It can be limited with a condition ("if"), expanded over an array ("forEach") and given a color.
// Values come from the node document (a whitelist of fields), its group, the system information document the agent sends,
// and "collectors": probes the server asks the agent to run, such as reading a key from an INI file or a registry value.
//
// Config keys are lowercased when the config is loaded, so this file reads every config key in lowercase.
// Values (paths, patterns, templates) keep their case, and paths are matched case-insensitively.
//
// Tags this module adds are remembered in node.autotags, so they can be removed again when they stop applying
// without touching tags that someone set by hand.

const MAX_TAG_LENGTH = 63;          // meshuser.js only accepts tags shorter than 64 characters
const MAX_TAGS_PER_DEVICE = 100;    // cap on tags generated for one device, so a forEach over a big array can't flood the node
const MAX_FOREACH_ITEMS = 100;
const MAX_COLLECTORS = 32;
const MAX_COLLECTOR_PATHS = 10;
const MAX_COLLECTED_VALUE = 1024;
const COLLECTOR_TYPES = ['ini', 'regex', 'dir', 'fileinfo', 'registry', 'env'];
const DEFAULT_COLLECT_INTERVAL = 60;  // minutes
const MAX_COLLECT_INTERVAL = 10080;   // one week, in minutes

// Node fields rules can read. A whitelist, so secrets kept on the node (Intel AMT passwords, push messaging tokens,
// saved SSH/RDP/VNC credentials) can never be copied into a tag that every viewer of the device can see.
const NODE_FIELDS = ['name', 'rname', 'desc', 'host', 'osdesc', 'ip', 'defaultRouteIp', 'defaultRouteIp6', 'icon', 'av', 'wsc', 'lsc', 'pr', 'defender', 'lastbootuptime', 'idletime', 'users', 'lusers', 'upnusers', 'winact', 'mtype'];
const AGENT_FIELDS = ['ver', 'id', 'caps', 'core', 'tag', 'root'];
const INTELAMT_FIELDS = ['ver', 'sku', 'state', 'flags', 'uuid', 'tag', 'realm'];

// Keys never read from the system information document. BitLocker recovery keys live under these.
const BLOCKED_KEYS = ['bitlocker', 'recoverypassword'];

// Named colors a config can use instead of a hex value.
const NAMED_COLORS = { red: '#d9534f', orange: '#f0ad4e', yellow: '#f7dc6f', green: '#5cb85c', teal: '#20c997', blue: '#428bca', purple: '#8e44ad', pink: '#e83e8c', gray: '#999999', grey: '#999999', black: '#333333', white: '#ffffff' };

const compiledCache = new WeakMap(); // domain object -> compiled config, or false when there is nothing to compile

// --- Paths ---------------------------------------------------------------

// "hardware.windows.memory[0].Capacity" -> ['hardware', 'windows', 'memory', '0', 'Capacity']
function parsePath(path) {
    if ((typeof path != 'string') || (path.trim().length == 0)) { throw new Error('empty field path'); }
    const segs = path.trim().replace(/\[(\d+)\]/g, '.$1').split('.');
    for (const s of segs) { if (s.length == 0) { throw new Error('invalid field path "' + path + '"'); } }
    return segs;
}

// Find a key in an object, exact match first, then ignoring case.
function findKey(o, key) {
    if (Object.prototype.hasOwnProperty.call(o, key)) return key;
    const lk = key.toLowerCase();
    for (const k of Object.keys(o)) { if (k.toLowerCase() == lk) return k; }
    return undefined;
}

function resolve(root, segs) {
    var o = root;
    for (const s of segs) {
        if ((o == null) || (typeof o != 'object')) return undefined;
        if (BLOCKED_KEYS.indexOf(s.toLowerCase()) >= 0) return undefined;
        const k = findKey(o, s);
        if (k === undefined) return undefined;
        o = o[k];
    }
    return o;
}

// Deep copy without the blocked keys.
function safeClone(v) {
    if ((v == null) || (typeof v != 'object')) return v;
    if (Array.isArray(v)) return v.map(safeClone);
    const r = {};
    for (const k of Object.keys(v)) { if (BLOCKED_KEYS.indexOf(k.toLowerCase()) == -1) { r[k] = safeClone(v[k]); } }
    return r;
}

// --- Values ----------------------------------------------------------------

function isEmpty(v) { return (v === undefined) || (v === null) || (v === '') || (Array.isArray(v) && (v.length == 0)); }

// Turn a value into tag text. Arrays are joined with spaces, objects can't be shown.
function toText(v) {
    if (isEmpty(v)) return null;
    if (Array.isArray(v)) { const a = v.map(toText).filter(function (x) { return x != null; }); return (a.length == 0) ? null : a.join(' '); }
    if (typeof v == 'object') return null;
    return String(v);
}

// Read a time as milliseconds: a number (ms, or seconds when it is too small to be ms), "YYYYMMDD", month-day-year with
// spaces, slashes, dashes or dots ("11 12 2026", "11/12/2026", US order),
// "YYYY-MM-DD", or anything else Date can parse.
function toTime(v) {
    if (typeof v == 'number') { return (v < 100000000000) ? (v * 1000) : v; }
    if (typeof v != 'string') return NaN;
    const s = v.trim();
    var m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) { return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])).getTime(); }
    m = /^(\d{1,2})[\s\/\-.]+(\d{1,2})[\s\/\-.]+(\d{4})$/.exec(s);
    if (m) { return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])).getTime(); }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); // Date.parse would read this as UTC midnight, which is the day before west of UTC
    if (m) { return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])).getTime(); }
    if (/^\d+$/.test(s)) { return toTime(parseInt(s)); }
    return Date.parse(s);
}

function pad2(n) { return ((n < 10) ? '0' : '') + n; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Format a date with YYYY, YY, MMM (Nov), MM, M, DD, D and ddd (Thu). Anything else is copied as is.
function formatDate(t, fmt) {
    const d = new Date(t);
    const tokens = { YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).substring(2), MMM: MONTHS[d.getMonth()], MM: pad2(d.getMonth() + 1), M: String(d.getMonth() + 1), DD: pad2(d.getDate()), D: String(d.getDate()), ddd: WEEKDAYS[d.getDay()] };
    return fmt.replace(/YYYY|YY|MMM|MM|M|DD|D|ddd/g, function (x) { return tokens[x]; });
}

// Equality that ignores case for text and lets "1" match 1 and "true" match true, since config values and agent values
// don't always agree on types.
function looseEquals(a, b) {
    if ((a == null) || (b == null)) return (a == null) && (b == null);
    if ((typeof a == 'string') || (typeof b == 'string')) { return String(a).toLowerCase() === String(b).toLowerCase(); }
    return a === b;
}

// --- Templates -----------------------------------------------------------

// Filters run left to right on a placeholder's value: {path|filter|filter:arg}.
const FILTERS = {
    upper: function (v) { const t = toText(v); return (t == null) ? null : t.toUpperCase(); },
    lower: function (v) { const t = toText(v); return (t == null) ? null : t.toLowerCase(); },
    trim: function (v) { const t = toText(v); return (t == null) ? null : t.trim(); },
    default: function (v, arg) { return isEmpty(v) ? arg : v; },
    truncate: function (v, arg) { const t = toText(v), n = parseInt(arg); return ((t == null) || isNaN(n)) ? t : t.substring(0, n); },
    replace: function (v, arg) {
        const t = toText(v); if (t == null) return null;
        const i = arg.indexOf(':'); const find = (i >= 0) ? arg.substring(0, i) : arg; const repl = (i >= 0) ? arg.substring(i + 1) : '';
        return (find.length == 0) ? t : t.split(find).join(repl);
    },
    split: function (v, arg) {
        const t = toText(v); if (t == null) return null;
        const i = arg.lastIndexOf(':'); if (i < 0) return t;
        const parts = t.split(arg.substring(0, i)); var n = parseInt(arg.substring(i + 1)); if (isNaN(n)) return null;
        if (n < 0) { n = parts.length + n; }
        return parts[n];
    },
    regex: function (v, arg, f) {
        const t = toText(v); if (t == null) return null;
        const m = f.re.exec(t); if (m == null) return null;
        return (m.length > 1) ? m[1] : m[0];
    },
    first: function (v) { return Array.isArray(v) ? v[0] : v; },
    last: function (v) { return Array.isArray(v) ? v[v.length - 1] : v; },
    count: function (v) { return Array.isArray(v) ? v.length : ((v && (typeof v == 'object')) ? Object.keys(v).length : (isEmpty(v) ? 0 : 1)); },
    join: function (v, arg) { return Array.isArray(v) ? v.map(toText).filter(function (x) { return x != null; }).join(arg || ' ') : v; },
    date: function (v, arg) { const t = toTime(v); return isNaN(t) ? null : formatDate(t, arg || 'YYYY-MM-DD'); },
    days: function (v) { const t = toTime(v); return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000); }
};

function compileFilter(text) {
    const i = text.indexOf(':');
    const name = ((i >= 0) ? text.substring(0, i) : text).trim().toLowerCase();
    const arg = (i >= 0) ? text.substring(i + 1) : '';
    if (FILTERS[name] == null) { throw new Error('unknown filter "' + name + '"'); }
    const f = { name: name, arg: arg, fn: FILTERS[name] };
    if (name == 'regex') { f.re = new RegExp(arg, 'i'); }
    return f;
}

// "SN:{hardware.identifiers.bios_serial|upper}" -> list of literal strings and placeholders. "{{" and "}}" are literal braces.
function compileTemplate(text, paths) {
    if (typeof text != 'string') { throw new Error('tag must be a string'); }
    const parts = [];
    var lit = '', i = 0;
    while (i < text.length) {
        const c = text[i];
        if ((c == '{') && (text[i + 1] == '{')) { lit += '{'; i += 2; continue; }
        if ((c == '}') && (text[i + 1] == '}')) { lit += '}'; i += 2; continue; }
        if (c == '{') {
            const end = text.indexOf('}', i);
            if (end < 0) { throw new Error('unclosed "{" in "' + text + '"'); }
            const pieces = text.substring(i + 1, end).split('|');
            const segs = parsePath(pieces[0]);
            paths.push(segs);
            if (lit.length > 0) { parts.push(lit); lit = ''; }
            parts.push({ segs: segs, filters: pieces.slice(1).map(compileFilter) });
            i = end + 1;
            continue;
        }
        lit += c; i++;
    }
    if (lit.length > 0) { parts.push(lit); }
    return parts;
}

// Returns the tag text, or null when a placeholder has no value (so "SN:" is not created on a device with no serial number).
function renderTemplate(parts, ctx) {
    var out = '';
    for (const p of parts) {
        if (typeof p == 'string') { out += p; continue; }
        var v = resolve(ctx, p.segs);
        for (const f of p.filters) { v = f.fn(v, f.arg, f); }
        const t = toText(v);
        if (t == null) return null;
        out += t;
    }
    return out;
}

// --- Conditions ----------------------------------------------------------

const CONDITION_OPS = ['equals', 'notequals', 'in', 'notin', 'contains', 'matches', 'exists', 'gt', 'gte', 'lt', 'lte', 'olderthandays', 'newerthandays'];

function compileCondition(c, paths) {
    if (c == null) return null;
    if (Array.isArray(c)) { return { all: c.map(function (x) { return compileCondition(x, paths); }) }; }
    if (typeof c != 'object') { throw new Error('condition must be an object'); }
    if (c.all != null) { if (!Array.isArray(c.all)) { throw new Error('"all" must be an array'); } return { all: c.all.map(function (x) { return compileCondition(x, paths); }) }; }
    if (c.any != null) { if (!Array.isArray(c.any)) { throw new Error('"any" must be an array'); } return { any: c.any.map(function (x) { return compileCondition(x, paths); }) }; }
    if (c.not != null) { return { not: compileCondition(c.not, paths) }; }
    checkKeys(c, ['field', 'comment'].concat(CONDITION_OPS), 'condition');
    const segs = parsePath(c.field);
    paths.push(segs);
    const ops = [];
    for (const op of CONDITION_OPS) {
        if (c[op] === undefined) continue;
        const o = { op: op, value: c[op] };
        if (op == 'matches') { o.re = new RegExp(String(c[op]), 'i'); }
        if (((op == 'in') || (op == 'notin')) && !Array.isArray(c[op])) { throw new Error('"' + op + '" needs an array'); }
        ops.push(o);
    }
    if (ops.length == 0) { throw new Error('condition on "' + c.field + '" has no test (' + CONDITION_OPS.join(', ') + ')'); }
    return { segs: segs, ops: ops };
}

// An array value passes a test when any of its elements does, so "users contains bob" and "av matches defender" work.
function anyOf(v, test) { return Array.isArray(v) ? v.some(test) : test(v); }

function testOp(o, v) {
    switch (o.op) {
        case 'exists': return (!isEmpty(v)) === (o.value !== false);
        case 'equals': return anyOf(v, function (x) { return looseEquals(x, o.value); });
        case 'notequals': return !anyOf(v, function (x) { return looseEquals(x, o.value); });
        case 'in': return anyOf(v, function (x) { return o.value.some(function (y) { return looseEquals(x, y); }); });
        case 'notin': return !anyOf(v, function (x) { return o.value.some(function (y) { return looseEquals(x, y); }); });
        case 'contains': {
            if (Array.isArray(v)) { return v.some(function (x) { return looseEquals(x, o.value); }); }
            const t = toText(v); return (t != null) && (t.toLowerCase().indexOf(String(o.value).toLowerCase()) >= 0);
        }
        case 'matches': return anyOf(v, function (x) { const t = toText(x); return (t != null) && o.re.test(t); });
        case 'gt': case 'gte': case 'lt': case 'lte': {
            const a = Number(v), b = Number(o.value);
            if (isEmpty(v) || isNaN(a) || isNaN(b)) return false;
            return (o.op == 'gt') ? (a > b) : (o.op == 'gte') ? (a >= b) : (o.op == 'lt') ? (a < b) : (a <= b);
        }
        case 'olderthandays': case 'newerthandays': {
            const t = toTime(v), days = Number(o.value);
            if (isNaN(t) || isNaN(days)) return false;
            const age = (Date.now() - t) / 86400000;
            return (o.op == 'olderthandays') ? (age > days) : (age < days);
        }
    }
    return false;
}

function testCondition(c, ctx) {
    if (c == null) return true;
    if (c.all) return c.all.every(function (x) { return testCondition(x, ctx); });
    if (c.any) return c.any.some(function (x) { return testCondition(x, ctx); });
    if (c.not) return !testCondition(c.not, ctx);
    const v = resolve(ctx, c.segs);
    return c.ops.every(function (o) { return testOp(o, v); });
}

// --- Colors --------------------------------------------------------------

// Returns "#rrggbb", or null. Only hex or a known name gets through, so a color can't inject CSS into the page.
function normalizeColor(c) {
    if (typeof c != 'string') return null;
    c = c.trim().toLowerCase();
    if (NAMED_COLORS[c]) return NAMED_COLORS[c];
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    if (/^#[0-9a-f]{3}$/.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return null;
}

// --- Collectors ----------------------------------------------------------

function compileCollector(name, c) {
    if (!/^[a-z0-9_\-]{1,32}$/.test(name)) { throw new Error('collector name must be 1 to 32 letters, digits, "_" or "-"'); }
    if ((c == null) || (typeof c != 'object') || Array.isArray(c)) { throw new Error('collector must be an object'); }
    checkKeys(c, ['type', 'path', 'section', 'key', 'pattern', 'match', 'pick', 'property', 'name', 'interval', 'comment'], 'collector');
    const type = String(c.type || '').toLowerCase();
    if (COLLECTOR_TYPES.indexOf(type) == -1) { throw new Error('collector type must be one of ' + COLLECTOR_TYPES.join(', ')); }
    const r = { type: type };
    const str = function (k, max, required) {
        if (c[k] == null) { if (required) { throw new Error('collector of type "' + type + '" needs "' + k + '"'); } return; }
        if ((typeof c[k] != 'string') || (c[k].length > max)) { throw new Error('"' + k + '" must be a string of at most ' + max + ' characters'); }
        r[k] = c[k];
    };
    if (type == 'env') { str('name', 256, true); }
    else if (Array.isArray(c.path)) {
        // Several places the file can be (BoH or FoH installs, older or newer versions): tried in order, the first value found wins.
        if ((c.path.length == 0) || (c.path.length > MAX_COLLECTOR_PATHS)) { throw new Error('"path" list must have 1 to ' + MAX_COLLECTOR_PATHS + ' entries'); }
        for (const x of c.path) { if ((typeof x != 'string') || (x.length == 0) || (x.length > 1024)) { throw new Error('each "path" must be a string of at most 1024 characters'); } }
        r.path = c.path.slice();
    } else { str('path', 1024, true); }
    if (type == 'ini') { str('section', 256, false); str('key', 256, true); }
    if (type == 'regex') { str('pattern', 1024, true); new RegExp(r.pattern); }
    if (type == 'dir') {
        str('match', 1024, false); if (r.match != null) { new RegExp(r.match); }
        str('pick', 16, false); r.pick = (r.pick || 'last').toLowerCase();
        if (['first', 'last', 'newest', 'oldest', 'count'].indexOf(r.pick) == -1) { throw new Error('"pick" must be first, last, newest, oldest or count'); }
    }
    if (type == 'fileinfo') { str('property', 16, false); r.property = (r.property || 'exists').toLowerCase(); if (['exists', 'size', 'mtime'].indexOf(r.property) == -1) { throw new Error('"property" must be exists, size or mtime'); } }
    if (type == 'registry') { str('key', 256, false); }
    var interval = (c.interval == null) ? DEFAULT_COLLECT_INTERVAL : Number(c.interval);
    if (isNaN(interval) || (interval < 1)) { throw new Error('"interval" must be at least 1 (minutes)'); }
    r.interval = Math.min(Math.floor(interval), MAX_COLLECT_INTERVAL);
    return r;
}

// --- Compile -------------------------------------------------------------

// Copy with every key in lowercase, the way config.json keys arrive. Settings made in the web UI keep the case they were
// typed in ("forEach", "olderThanDays"), so everything is compiled from a lowercased copy.
function lowerKeys(v) {
    if ((v == null) || (typeof v != 'object')) return v;
    if (Array.isArray(v)) return v.map(lowerKeys);
    const r = {};
    for (const k of Object.keys(v)) { r[k.toLowerCase()] = lowerKeys(v[k]); }
    return r;
}

function checkKeys(o, known, what) {
    for (const k of Object.keys(o)) { if (known.indexOf(k) == -1) { throw new Error('unknown setting "' + k + '" in ' + what); } }
}

const TOP_KEYS = ['enabled', 'rules', 'colors', 'desktoptags', 'collect', 'uicollectors', 'comment'];
const RULE_KEYS = ['tag', 'tags', 'if', 'foreach', 'color', 'desktop', 'enabled', 'name', 'comment'];

function compile(cfg, log) {
    if (Array.isArray(cfg)) { cfg = { rules: cfg }; }
    if ((cfg == null) || (typeof cfg != 'object')) return null;
    cfg = lowerKeys(cfg);
    if (cfg.enabled === false) return null;
    const paths = [], rules = [], colors = [], collectors = {};
    const warn = function (what, ex) { if (log) { log('AutoTags: ' + what + ' ignored: ' + ((ex && ex.message) ? ex.message : ex)); } };
    for (const k of Object.keys(cfg)) { if (TOP_KEYS.indexOf(k) == -1) { warn('setting "' + k + '"', 'unknown setting (expected ' + TOP_KEYS.join(', ') + ')'); } }

    if ((cfg.collect != null) && (typeof cfg.collect == 'object')) {
        const names = Object.keys(cfg.collect);
        if (names.length > MAX_COLLECTORS) { warn('collectors beyond the first ' + MAX_COLLECTORS, 'too many collectors'); }
        for (const name of names.slice(0, MAX_COLLECTORS)) {
            try { collectors[name] = compileCollector(name, cfg.collect[name]); } catch (ex) { warn('collector "' + name + '"', ex); }
        }
    }

    const ruleList = Array.isArray(cfg.rules) ? cfg.rules : [];
    for (var i = 0; i < ruleList.length; i++) {
        const r = ruleList[i];
        try {
            if ((r == null) || (typeof r != 'object') || Array.isArray(r)) { throw new Error('rule must be an object'); }
            checkKeys(r, RULE_KEYS, 'rule');
            if (r.enabled === false) continue;
            var texts = (r.tags != null) ? r.tags : r.tag;
            if (typeof texts == 'string') { texts = [texts]; }
            if (!Array.isArray(texts) || (texts.length == 0)) { throw new Error('rule needs "tag" or "tags"'); }
            const rulePaths = [];
            const rule = { templates: texts.map(function (t) { return compileTemplate(t, rulePaths); }), cond: compileCondition(r['if'], rulePaths), color: null, foreach: null, desktop: (r.desktop === true) };
            if (r.color != null) { rule.color = normalizeColor(r.color); if (rule.color == null) { throw new Error('color must be #rgb, #rrggbb or one of ' + Object.keys(NAMED_COLORS).join(', ')); } }
            if (r.foreach != null) { rule.foreach = parsePath(r.foreach); rulePaths.push(rule.foreach); }
            rules.push(rule);
            paths.push(...rulePaths);
        } catch (ex) { warn('rule ' + (i + 1), ex); }
    }

    const colorList = Array.isArray(cfg.colors) ? cfg.colors : [];
    for (var j = 0; j < colorList.length; j++) {
        const c = colorList[j];
        try {
            if ((c == null) || (typeof c != 'object')) { throw new Error('must be an object'); }
            checkKeys(c, ['tag', 'match', 'color', 'comment'], 'color');
            const color = normalizeColor(c.color);
            if (color == null) { throw new Error('color must be #rgb, #rrggbb or one of ' + Object.keys(NAMED_COLORS).join(', ')); }
            if (typeof c.tag == 'string') { colors.push({ tag: c.tag.toLowerCase(), color: color }); }
            else if (typeof c.match == 'string') { colors.push({ re: new RegExp(c.match, 'i'), color: color }); }
            else { throw new Error('needs "tag" or "match"'); }
        } catch (ex) { warn('color ' + (j + 1), ex); }
    }

    // Tags shown in the remote desktop toolbar: true for all of them, or a list of tag names and "/regex/" patterns.
    // Rules can also add their own tags with "desktop": true.
    var desktopAll = false;
    const desktop = [];
    if (cfg.desktoptags === true) { desktopAll = true; }
    else if (Array.isArray(cfg.desktoptags)) {
        for (const d of cfg.desktoptags) {
            try {
                if (typeof d != 'string') { throw new Error('must be a string'); }
                if ((d.length > 2) && (d[0] == '/') && (d[d.length - 1] == '/')) { desktop.push({ re: new RegExp(d.substring(1, d.length - 1), 'i') }); }
                else { desktop.push({ tag: d.toLowerCase() }); }
            } catch (ex) { warn('desktopTags entry "' + d + '"', ex); }
        }
    }

    if ((rules.length == 0) && (colors.length == 0) && !desktopAll && (desktop.length == 0)) return null;

    // Paths into the system information document, so only those parts are kept in memory per agent.
    const siPaths = [];
    for (const segs of paths) {
        const root = segs[0].toLowerCase();
        if (root == 'hardware') { siPaths.push(segs); }
        else if ((root == 'sysinfo') && (segs.length > 1)) { siPaths.push(segs.slice(1)); }
        else if (root == 'sysinfo') { siPaths.push(['hardware']); siPaths.push(['pendingReboot']); }
    }
    const usesCollected = paths.some(function (segs) { return segs[0].toLowerCase() == 'collected'; });

    return { rules: rules, colors: colors, desktopAll: desktopAll, desktop: desktop, collectors: collectors, hasCollectors: Object.keys(collectors).length > 0, siPaths: siPaths, usesSysInfo: (siPaths.length > 0), usesCollected: usesCollected };
}

// Compiled rules for a domain, or null when auto tags are off. Compiled once per domain object.
function getRules(domain, log) {
    if ((domain == null) || (typeof domain != 'object')) return null;
    var c = compiledCache.get(domain);
    if (c === undefined) {
        try { c = compile(domain.autotags, log) || false; } catch (ex) { if (log) { log('AutoTags: config ignored: ' + ex); } c = false; }
        compiledCache.set(domain, c);
    }
    return c || null;
}

// --- Settings from the web UI ----------------------------------------------
//
// Besides config.json, auto tags can be set in the web UI on a device group (mesh.autotagcfg) and on a device
// (node.autotagcfg), in the same format. A device can also have tag templates (node.tagtemplates): tags such as
// "LAN:{defaultRouteIp}" typed in the device's tag editor, which work like a rule with only a "tag".
// For a device, the rules are config.json's, then its group's, then its own. Collectors with the same name are replaced
// by the later layer, so a device can override a group's collector.

const MAX_UI_CONFIG_SIZE = 32768;   // JSON length of the settings saved on one device or group
const MAX_TEMPLATES = 32;
const MAX_TEMPLATE_LENGTH = 256;
const layeredCache = new Map();     // JSON of the layers -> compiled rules, or false
const MAX_LAYERED_CACHE = 1000;

// Device fields that hold auto tag settings, or null when it has none.
function nodeLayer(node) {
    if ((node == null) || ((node.autotagcfg == null) && (node.tagtemplates == null))) return null;
    return { cfg: node.autotagcfg, templates: node.tagtemplates };
}

// Merge config layers (already lowercased) into one config.
function mergeLayers(layers) {
    const r = { rules: [], colors: [], collect: {}, desktoptags: [] };
    var desktopAll = false, any = false;
    for (const l of layers) {
        if ((l == null) || (l.enabled === false)) continue;
        any = true;
        if (Array.isArray(l.rules)) { r.rules.push(...l.rules); }
        if (Array.isArray(l.colors)) { r.colors.push(...l.colors); }
        if ((l.collect != null) && (typeof l.collect == 'object') && !Array.isArray(l.collect)) { Object.assign(r.collect, l.collect); }
        if (l.desktoptags === true) { desktopAll = true; } else if (Array.isArray(l.desktoptags)) { r.desktoptags.push(...l.desktoptags); }
    }
    if (!any) return null;
    if (desktopAll) { r.desktoptags = true; }
    return r;
}

function templatesToRules(templates) {
    if (!Array.isArray(templates)) return [];
    return templates.filter(function (t) { return typeof t == 'string'; }).map(function (t) { return { tag: t }; });
}

// Compiled rules for one device: config.json, then its group, then its own settings. Null when none apply.
function getRulesFor(domain, mesh, layer, log) {
    if ((domain == null) || (typeof domain != 'object')) return null;
    const meshCfg = (mesh != null) ? mesh.autotagcfg : null;
    const nodeCfg = (layer != null) ? layer.cfg : null;
    const templates = (layer != null) ? layer.templates : null;
    if ((meshCfg == null) && (nodeCfg == null) && !Array.isArray(templates)) return getRules(domain, log);

    const domainCfg = (domain.autotags != null) ? lowerKeys(Array.isArray(domain.autotags) ? { rules: domain.autotags } : domain.autotags) : null;
    const uiCollectors = !((domainCfg != null) && (domainCfg.uicollectors === false));
    const ui = function (c) {
        if ((c == null) || (typeof c != 'object')) return null;
        c = lowerKeys(Array.isArray(c) ? { rules: c } : c);
        if (!uiCollectors) { c = Object.assign({}, c); delete c.collect; } // collectors from the web UI are turned off in config.json
        return c;
    };
    const key = (domain.id || '') + '\n' + JSON.stringify([meshCfg, nodeCfg, templates, uiCollectors]);
    var c = layeredCache.get(key);
    if (c === undefined) {
        try {
            const merged = mergeLayers([domainCfg, ui(meshCfg), ui(nodeCfg), { rules: templatesToRules(templates) }]);
            c = compile(merged, log) || false;
        } catch (ex) { if (log) { log('AutoTags: settings ignored: ' + ex); } c = false; }
        if (layeredCache.size >= MAX_LAYERED_CACHE) { layeredCache.delete(layeredCache.keys().next().value); }
        layeredCache.set(key, c);
    }
    return c || null;
}

// Check settings typed in the web UI before they are saved. Stricter than config.json: anything that would be ignored is an error.
// Returns { errors: [...], hasCollectors, collectorTypes }.
function validateUiConfig(cfg) {
    const errors = [];
    if (cfg == null) return { errors: errors, hasCollectors: false, collectorTypes: [] };
    if ((typeof cfg != 'object')) { errors.push('Settings must be a JSON object or a list of rules.'); return { errors: errors, hasCollectors: false, collectorTypes: [] }; }
    var size = 0;
    try { size = JSON.stringify(cfg).length; } catch (ex) { errors.push('Settings can not be read.'); }
    if (size > MAX_UI_CONFIG_SIZE) { errors.push('Settings are ' + size + ' characters, the limit is ' + MAX_UI_CONFIG_SIZE + '.'); }
    const lc = lowerKeys(Array.isArray(cfg) ? { rules: cfg } : cfg);
    if (lc.uicollectors !== undefined) { errors.push('"uiCollectors" can only be set in config.json.'); }
    var compiled = null;
    try { compiled = compile(lc, function (msg) { errors.push(msg.replace(/^AutoTags: /, '')); }); } catch (ex) { errors.push(String(ex.message || ex)); }
    const types = [];
    if ((lc.collect != null) && (typeof lc.collect == 'object')) { for (const n of Object.keys(lc.collect)) { const t = lc.collect[n] && String(lc.collect[n].type || '').toLowerCase(); if (types.indexOf(t) == -1) { types.push(t); } } }
    return { errors: errors, hasCollectors: (lc.collect != null) && (Object.keys(lc.collect).length > 0), collectorTypes: types, compiled: compiled };
}

// Check tag templates typed in the device tag editor. Returns a list of errors.
function validateTemplates(templates) {
    const errors = [];
    if (templates == null) return errors;
    if (!Array.isArray(templates)) { errors.push('Templates must be a list.'); return errors; }
    if (templates.length > MAX_TEMPLATES) { errors.push('At most ' + MAX_TEMPLATES + ' tag templates.'); }
    for (const t of templates) {
        if ((typeof t != 'string') || (t.length == 0) || (t.length > MAX_TEMPLATE_LENGTH)) { errors.push('Each template must be text of at most ' + MAX_TEMPLATE_LENGTH + ' characters.'); continue; }
        if (t.indexOf(',') >= 0) { errors.push('"' + t + '": a tag can not contain a comma.'); continue; }
        try { compileTemplate(t, []); } catch (ex) { errors.push('"' + t + '": ' + ex.message); }
    }
    return errors;
}

// A tag typed in the device tag editor is a template when it has a {placeholder}.
function isTemplate(tag) { return (typeof tag == 'string') && /\{[^{}]+\}/.test(tag.split('{{').join('').split('}}').join('')); }

// Collectors read files, the registry and environment variables as SYSTEM/root, so setting them from the web UI
// takes the rights to read those through MeshCentral already: file access, and registry access for registry collectors.
function collectorRightsOk(rights, collectorTypes) {
    if (rights == 0xFFFFFFFF) return true;
    if ((rights & 8) == 0) return false;                 // MESHRIGHT_REMOTECONTROL
    if ((rights & (256 | 1024)) != 0) return false;      // MESHRIGHT_REMOTEVIEWONLY, MESHRIGHT_NOFILES
    if ((collectorTypes.indexOf('registry') >= 0) && ((rights & 0x00400000) != 0)) return false; // MESHRIGHT_NOREGISTRY
    return true;
}

// --- Context -------------------------------------------------------------

function platformOf(si, node) {
    const hw = (si && si.hardware) ? si.hardware : null;
    if (hw) { if (hw.windows) return 'windows'; if (hw.darwin) return 'macos'; if (hw.linux) return 'linux'; }
    const d = ((node && (typeof node.osdesc == 'string')) ? node.osdesc : '').toLowerCase();
    if (d.indexOf('windows') >= 0) return 'windows';
    if ((d.indexOf('mac') >= 0) || (d.indexOf('os x') >= 0) || (d.indexOf('darwin') >= 0)) return 'macos';
    if (d.indexOf('freebsd') >= 0) return 'freebsd';
    if (d.indexOf('android') >= 0) return 'android';
    return (d.length > 0) ? 'linux' : '';
}

// Keep only the parts of a system information document the rules read, so each connected agent holds a few values
// instead of the whole document. Also records the platform, which needs the full document.
function pruneSysInfo(compiled, si) {
    if ((compiled == null) || (si == null) || (typeof si != 'object')) return null;
    const out = { _platform: platformOf(si, null) };
    for (const segs of compiled.siPaths) {
        var src = si, dst = out, ok = true;
        const keys = [];
        for (const s of segs) {
            if ((src == null) || (typeof src != 'object') || (BLOCKED_KEYS.indexOf(s.toLowerCase()) >= 0)) { ok = false; break; }
            const k = findKey(src, s);
            if (k === undefined) { ok = false; break; }
            keys.push(k); src = src[k];
        }
        if (!ok) continue;
        for (var i = 0; i < keys.length - 1; i++) {
            if ((dst[keys[i]] == null) || (typeof dst[keys[i]] != 'object')) { dst[keys[i]] = {}; }
            dst = dst[keys[i]];
        }
        dst[keys[keys.length - 1]] = safeClone(src);
    }
    return out;
}

// Check what an agent sent back for its collectors: only configured names, only text, capped in size.
function cleanCollected(compiled, data) {
    if ((compiled == null) || (data == null) || (typeof data != 'object') || Array.isArray(data)) return null;
    const out = {};
    for (const name of Object.keys(compiled.collectors)) {
        const v = data[name];
        if ((typeof v == 'string') && (v.length > 0)) { out[name] = v.substring(0, MAX_COLLECTED_VALUE); }
        else if ((typeof v == 'number') || (typeof v == 'boolean')) { out[name] = String(v); }
    }
    return out;
}

function buildContext(node, si, mesh, collected) {
    const ctx = {};
    if (node) {
        for (const f of NODE_FIELDS) { if (node[f] !== undefined) { ctx[f] = node[f]; } }
        if (node.agent) { ctx.agent = {}; for (const f of AGENT_FIELDS) { if (node.agent[f] !== undefined) { ctx.agent[f] = node.agent[f]; } } }
        if (node.intelamt) { ctx.intelamt = {}; for (const f of INTELAMT_FIELDS) { if (node.intelamt[f] !== undefined) { ctx.intelamt[f] = node.intelamt[f]; } } }
        ctx.nodeid = node._id;
    }
    ctx.mesh = mesh ? { id: mesh._id, name: mesh.name, desc: mesh.desc } : {};
    ctx.group = ctx.mesh;
    ctx.sysinfo = si || {};
    ctx.hardware = (si && si.hardware) ? si.hardware : {};
    ctx.platform = (si && si._platform) ? si._platform : platformOf(null, node);
    ctx.collected = collected || {};
    return ctx;
}

// --- Evaluate ------------------------------------------------------------

function cleanTag(t) {
    if (t == null) return null;
    t = String(t).replace(/[,\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > MAX_TAG_LENGTH) { t = t.substring(0, MAX_TAG_LENGTH).trim(); }
    return (t.length == 0) ? null : t;
}

// Run the rules for one device. Returns { tags: [...], colors: { tag: '#rrggbb' }, desktop: { tag: true } }.
function computeTags(compiled, node, si, mesh, collected) {
    const tags = [], colors = {}, desktop = {};
    if (compiled == null) return { tags: tags, colors: colors, desktop: desktop };
    const ctx = buildContext(node, si, mesh, collected);
    const add = function (rule, scope) {
        if (!testCondition(rule.cond, scope)) return;
        for (const t of rule.templates) {
            const tag = cleanTag(renderTemplate(t, scope));
            if ((tag == null) || (tags.length >= MAX_TAGS_PER_DEVICE)) continue;
            if (tags.indexOf(tag) == -1) { tags.push(tag); }
            if (rule.color && (colors[tag] == null)) { colors[tag] = rule.color; }
            if (rule.desktop) { desktop[tag] = true; }
        }
    };
    for (const rule of compiled.rules) {
        if (rule.foreach == null) { add(rule, ctx); continue; }
        var items = resolve(ctx, rule.foreach);
        if (items == null) continue;
        if (!Array.isArray(items)) { items = (typeof items == 'object') ? Object.keys(items).map(function (k) { return items[k]; }) : [items]; }
        for (var i = 0; (i < items.length) && (i < MAX_FOREACH_ITEMS); i++) {
            const scope = Object.assign({}, ctx, { item: items[i], index: i });
            add(rule, scope);
        }
    }
    tags.sort();
    return { tags: tags, colors: colors, desktop: desktop };
}

// Merge generated tags into node.tags. Tags someone added by hand stay; tags added earlier by this module that no longer
// apply are removed. Also sets node.tagcolors for every tag on the node with a color, and node.desktoptags for the tags the
// remote desktop toolbar shows (true for all of them). Returns true when the node changed.
function applyTags(compiled, node, result) {
    const prevAuto = Array.isArray(node.autotags) ? node.autotags : [];
    const current = Array.isArray(node.tags) ? node.tags : [];
    const manual = [];
    for (const t of current) { if ((prevAuto.indexOf(t) == -1) && (manual.indexOf(t) == -1)) { manual.push(t); } }
    const newAuto = result.tags.filter(function (t) { return manual.indexOf(t) == -1; });
    const tags = manual.concat(newAuto);

    const colors = {};
    for (const t of tags) {
        var c = result.colors[t];
        if ((c == null) && compiled) {
            const lt = t.toLowerCase();
            for (const rc of compiled.colors) { if ((rc.tag != null) ? (rc.tag == lt) : rc.re.test(t)) { c = rc.color; break; } }
        }
        if (c != null) { colors[t] = c; }
    }

    var desktopTags = null;
    if (compiled && compiled.desktopAll) { desktopTags = true; }
    else {
        const list = tags.filter(function (t) {
            if (result.desktop && result.desktop[t]) return true;
            if (compiled == null) return false;
            const lt = t.toLowerCase();
            return compiled.desktop.some(function (d) { return (d.tag != null) ? (d.tag == lt) : d.re.test(t); });
        });
        if (list.length > 0) { desktopTags = list; }
    }

    var changed = false;
    const set = function (field, value, empty) {
        if (JSON.stringify(node[field] || null) == JSON.stringify(empty ? null : value)) return;
        if (empty) { delete node[field]; } else { node[field] = value; }
        changed = true;
    };
    set('tags', tags, tags.length == 0);
    set('autotags', newAuto, newAuto.length == 0);
    set('tagcolors', colors, Object.keys(colors).length == 0);
    set('desktoptags', desktopTags, desktopTags == null);
    return changed;
}

// Update a node's tags in place. With no rules, removes tags and colors this module added before. Returns true when the node changed.
function update(compiled, node, si, mesh, collected) {
    if ((compiled == null) && (node.autotags == null) && (node.tagcolors == null) && (node.desktoptags == null)) return false;
    return applyTags(compiled, node, computeTags(compiled, node, si, mesh, collected));
}

// After someone edits a device's tags by hand: recompute tag colors and remote desktop toolbar tags for the new list right
// away, keeping the generated tags that are still there with the colors and toolbar choice their rules gave them. Generated
// tags someone removed stay removed until the rules run again on the agent's next report. Returns true when the node changed.
function refreshTagStyles(compiled, node) {
    if ((compiled == null) && (node.autotags == null) && (node.tagcolors == null) && (node.desktoptags == null)) return false;
    const tags = Array.isArray(node.tags) ? node.tags : [];
    const auto = (Array.isArray(node.autotags) ? node.autotags : []).filter(function (t) { return tags.indexOf(t) >= 0; });
    const result = { tags: auto, colors: {}, desktop: {} };
    for (const t of auto) {
        if ((node.tagcolors != null) && (node.tagcolors[t] != null)) { result.colors[t] = node.tagcolors[t]; }
        if ((node.desktoptags === true) || (Array.isArray(node.desktoptags) && (node.desktoptags.indexOf(t) >= 0))) { result.desktop[t] = true; }
    }
    const changed = applyTags(compiled, node, result);
    if (Array.isArray(node.tags)) { node.tags.sort(); } // a hand edit keeps tags sorted
    if (Array.isArray(node.desktoptags)) { node.desktoptags.sort(); }
    return changed;
}

// Collector settings to send to the agent, or null when there are none.
function agentCollectors(compiled) { return ((compiled == null) || !compiled.hasCollectors) ? null : compiled.collectors; }

module.exports = {
    getRules: getRules,
    getRulesFor: getRulesFor,
    nodeLayer: nodeLayer,
    validateUiConfig: validateUiConfig,
    validateTemplates: validateTemplates,
    isTemplate: isTemplate,
    collectorRightsOk: collectorRightsOk,
    compile: compile,
    pruneSysInfo: pruneSysInfo,
    cleanCollected: cleanCollected,
    computeTags: computeTags,
    applyTags: applyTags,
    update: update,
    refreshTagStyles: refreshTagStyles,
    agentCollectors: agentCollectors,
    normalizeColor: normalizeColor
};
