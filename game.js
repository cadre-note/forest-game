/* =====================================================================
 * 晨露森旅 — game.js（遊戲邏輯層）
 * 依賴：index.html 內的 window.UI（畫面外殼）與 data.js 的 window.GAME_DATA
 * 章節：
 *   0 工具        1 音效        2 存檔／離線收益   3 每日重置／任務   4 獎勵
 *   5 數值計算    6 精靈成長    7 召喚            8 HUD 與紅點       9 營地
 *   10 建築       11 記步數     12 任務抽屜        13 世界地圖        14 出戰選擇
 *   15 塔防戰鬥   16 奇遇步道     17 鍛造           18 精靈屋與詳情    19 進化
 *   20 事件綁定   21 啟動
 * ===================================================================== */
(function () {
  'use strict';
  var D = window.GAME_DATA, UI = window.UI;
  if (!D || !UI) { console.error('[晨露森旅] 缺少 data.js 或 index.html 的 UI 外殼'); return; }
  window.MD_HOLD_SPLASH = true;

  /* =================================================================
   * 0. 工具
   * ================================================================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var randInt = function (a, b) { return Math.floor(rand(a, b + 1)); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  var fmt = function (n) { return Math.floor(n).toLocaleString('en-US'); };
  var now = function () { return Date.now(); };
  function weighted(entries) {               // entries: [[值, 權重], ...]
    var total = 0; entries.forEach(function (e) { total += e[1]; });
    var r = Math.random() * total;
    for (var i = 0; i < entries.length; i++) { r -= entries[i][1]; if (r < 0) return entries[i][0]; }
    return entries[entries.length - 1][0];
  }
  function dayKey(t) {                       // 以每日 04:00 為界的日期字串
    var d = new Date((t || now()) - D.META.dailyResetHour * 3600000);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function deepMerge(base, over) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over || {}).forEach(function (k) {
      if (isObj(base[k]) && isObj(over[k])) out[k] = deepMerge(base[k], over[k]);
      else out[k] = over[k];
    });
    return out;
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function starsHTML(n, max) { var h = ''; for (var i = 0; i < (max || 3); i++) h += '<svg class="ico' + (i < n ? ' on' : '') + '"><use href="#i-star"/></svg>'; return h; }

  // 查表
  var PETS = {}; D.PETS.forEach(function (p) { PETS[p.id] = p; });
  var ENEMIES = {}; D.ENEMIES.forEach(function (e) { ENEMIES[e.id] = e; });
  var RECIPES = {}; D.CRAFT_RECIPES.forEach(function (r) { RECIPES[r.id] = r; });
  var QUALITY = {}; D.CRAFT_QUALITIES.forEach(function (q) { QUALITY[q.id] = q; });
  var BUILD = {}; D.CAMP_BUILDINGS.forEach(function (b) { BUILD[b.id] = b; });
  var STAGES = [];
  D.CHAPTERS.forEach(function (ch, ci) { ch.stages.forEach(function (st, si) { STAGES.push(Object.assign({ ci: ci, si: si, chapterName: ch.name }, st)); }); });
  var STAGE = function (id) { return STAGES.find(function (s) { return s.id === id; }); };
  // 精靈外觀：依進化階段換立繪與名稱；閃光以 CSS 濾鏡呈現
  function petArt(id, evo) { var st = S && S.pets[id]; evo = evo == null ? (st ? st.evo || 0 : 0) : evo; return evo > 0 ? D.ASSETS.petEvo[id][evo - 1] : D.ASSETS.pets[id]; }
  function petName(id, evo) { var st = S && S.pets[id]; evo = evo == null ? (st ? st.evo || 0 : 0) : evo; return evo > 0 ? D.EVOLUTION.forms[id][evo - 1] : PETS[id].name; }
  function isShiny(id) { return !!(S && S.pets[id] && S.pets[id].shiny); }
  var ROLE_ICON = { guardian: '#i-role-guardian', ranged: '#i-role-ranged', healer: '#i-role-healer' };
  var STAT_NAME = { hp: '生命', atk: '攻擊', def: '防禦', critRate: '暴擊率', healPct: '治療量' };
  var PCT_STATS = { critRate: 1, healPct: 1 };
  D.SUBSTAT_POOL.forEach(function (s) { STAT_NAME[s.stat] = s.name; if (s.unit === '%') PCT_STATS[s.stat] = 1; });
  function statText(k, v) { return (STAT_NAME[k] || k) + ' ' + (k === 'costDown' ? '−' + v : '+' + v + (PCT_STATS[k] ? '%' : '')); }

  /* =================================================================
   * 1. 音效（Web Audio API 即時合成，無外部音檔）
   * ================================================================= */
  var Sound = {
    ctx: null, master: null, on: true, lastHit: 0, noiseBuf: null, unlocked: false,
    ensure: function () {
      if (!this.on || !this.unlocked) return null;     // 瀏覽器規定：第一次觸碰後才能發聲
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
        var comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
        var len = this.ctx.sampleRate * 0.5, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (f, dur, o) {
      o = o || {}; var c = this.ensure(); if (!c) return;
      var t = c.currentTime + (o.at || 0);
      var osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      if (o.detune) osc.detune.value = o.detune;
      var v = o.vol == null ? 0.2 : o.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + (o.atk || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      var out = g;
      if (o.filter) { var fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.filter; g.connect(fl); out = fl; }
      out.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.05);
    },
    noise: function (dur, o) {
      o = o || {}; var c = this.ensure(); if (!c) return;
      var t = c.currentTime + (o.at || 0);
      var src = c.createBufferSource(); src.buffer = this.noiseBuf;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.freq || 1200; bp.Q.value = o.q || 1.5;
      var g = c.createGain(); var v = o.vol == null ? 0.2 : o.vol;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    },
    play: function (name) {
      if (!this.on) return;
      var T = this.tone.bind(this), N = this.noise.bind(this);
      switch (name) {
        case 'click':   N(0.05, { freq: 1700, q: 3, vol: 0.22 }); T(300, 0.09, { type: 'triangle', to: 170, vol: 0.18 }); break;      // 木頭點擊
        case 'pop':     T(420, 0.12, { to: 920, vol: 0.18 }); T(880, 0.09, { at: 0.05, to: 1320, vol: 0.09 }); break;                  // 泡泡彈跳
        case 'heart':   T(660, 0.12, { vol: 0.12 }); T(990, 0.18, { at: 0.08, vol: 0.1 }); break;
        case 'skill':   [880, 1175, 1397, 1760, 2093].forEach(function (f, i) { T(f, 0.7, { at: i * 0.05, vol: 0.06, detune: i * 4 }); });  // 大招微光
                        T(440, 0.9, { to: 880, vol: 0.06, type: 'triangle' }); break;
        case 'forge':   T(1568, 0.4, { type: 'triangle', vol: 0.16 }); T(2349, 0.3, { vol: 0.08 }); T(3136, 0.18, { vol: 0.04 }); N(0.04, { freq: 4200, vol: 0.18 }); break; // 鍛造叮噹
        case 'victory': [523, 659, 784, 1047].forEach(function (f, i) { T(f, 0.45, { at: i * 0.12, vol: 0.13, type: 'triangle' }); });   // 勝利和弦
                        [523, 659, 784, 1047].forEach(function (f) { T(f, 1.4, { at: 0.55, vol: 0.07 }); }); break;
        case 'defeat':  [392, 330, 262].forEach(function (f, i) { T(f, 0.5, { at: i * 0.18, vol: 0.09, type: 'triangle' }); }); break;
        case 'coin':    T(988, 0.08, { type: 'square', vol: 0.05, filter: 2600 }); T(1319, 0.18, { at: 0.07, type: 'square', vol: 0.05, filter: 2600 }); break;
        case 'hit':     if (performance.now() - this.lastHit < 70) return; this.lastHit = performance.now();
                        N(0.05, { freq: 700, vol: 0.09 }); T(190, 0.07, { to: 100, vol: 0.07 }); break;
        case 'shoot':   if (performance.now() - this.lastHit < 60) return; this.lastHit = performance.now();
                        T(720, 0.09, { to: 1250, vol: 0.04, type: 'triangle' }); break;
        case 'heal':    T(784, 0.25, { vol: 0.06 }); T(1047, 0.3, { at: 0.08, vol: 0.05 }); break;
        case 'deploy':  N(0.06, { freq: 900, vol: 0.14 }); T(260, 0.14, { to: 520, type: 'triangle', vol: 0.16 }); break;
        case 'step':    T(520, 0.05, { type: 'triangle', vol: 0.07 }); break;
        case 'bump':    T(150, 0.09, { type: 'square', vol: 0.05, filter: 500 }); break;
        case 'warp':    T(300, 0.35, { to: 1200, vol: 0.08 }); T(1200, 0.3, { at: 0.28, to: 420, vol: 0.05 }); break;
        case 'unlock':  T(660, 0.1, { vol: 0.12 }); T(880, 0.12, { at: 0.08, vol: 0.12 }); T(1320, 0.2, { at: 0.16, vol: 0.08 }); break;
        case 'crack':   N(0.08, { freq: 2400, q: 4, vol: 0.2 }); T(1800, 0.05, { type: 'triangle', vol: 0.06 }); break;
        case 'hatch':   [784, 988, 1175, 1568, 1976].forEach(function (f, i) { T(f, 0.4, { at: i * 0.07, vol: 0.08 }); }); break;
        case 'shock':   T(90, 0.45, { to: 48, type: 'sawtooth', vol: 0.1, filter: 380 }); N(0.3, { freq: 220, vol: 0.18 }); break;
        case 'lose':    T(330, 0.22, { to: 220, vol: 0.1, type: 'triangle' }); break;
        case 'levelup': [523, 659, 784, 1047, 1319].forEach(function (f, i) { T(f, 0.25, { at: i * 0.06, vol: 0.09, type: 'triangle' }); }); break;
        case 'evolve':  T(220, 2.4, { to: 880, vol: 0.06, type: 'triangle' });                                                        // 進化：暖光升起
                        [523, 659, 784, 988, 1175, 1319, 1568].forEach(function (f, i) { T(f, 0.5, { at: 0.3 + i * 0.28, vol: 0.05 }); }); break;
        case 'shiny':   [1568, 2093, 2637, 3136].forEach(function (f, i) { T(f, 0.35, { at: i * 0.07, vol: 0.05 }); }); break;          // 閃光
        case 'bottle':  T(380, 0.18, { to: 220, vol: 0.08 }); N(0.2, { freq: 600, q: 0.8, vol: 0.06, at: 0.05 }); break;            // 信瓶漂來
        case 'wave':    T(392, 0.2, { vol: 0.08, type: 'triangle' }); T(523, 0.3, { at: 0.12, vol: 0.08, type: 'triangle' }); break;
      }
    }
  };

  /* =================================================================
   * 2. 存檔（localStorage 自動存檔、版本遷移、離線露水→下班收成籃）
   * ================================================================= */
  var SAVE_KEY = D.META.saveKey;
  var SAVE_VERSION = 3;
  var S = null;
  var dirtyTimer = 0;

  function newPetState() {
    return { lv: 1, exp: 0, star: 1, shards: 0, evo: 0, evoPrompted: 0, branch: null, shiny: false, gear: { wrist: null, pendant: null, hair: null }, got: now() };
  }
  function newSave() {
    var pets = {};
    D.ECONOMY.newPlayer.pets.forEach(function (id) { pets[id] = newPetState(); });
    var t = now(), items = {};
    Object.keys(D.ITEMS).forEach(function (k) { items[k] = 0; });
    return {
      v: SAVE_VERSION, dataVersion: D.META.dataVersion, created: t, lastSeen: t, offlineAcc: 0,
      dew: D.ECONOMY.newPlayer.dew, coins: 0, tickets: 0,
      mats: { mat_01: 0, mat_02: 0, mat_03: 0 }, items: items,
      pets: pets, gear: [], gearSeq: 1,
      buildings: { campfire: 1, nest: 1, workshop: 1 },
      stages: {},
      summon: { pity: 0, total: 0 }, charmActive: false,
      steps: { day: dayKey(t), today: 0, dewToday: 0, lifetime: 0, claimed: [], lifeClaimed: [] },
      daily: { day: dayKey(t), prog: {}, claimed: [], chests: [], endlessRuns: 0, freeDew: false, bottles: 0 },
      endless: { best: 0, claimed: [] },
      trail: { runs: 0, active: null },
      blessing: null, basket: null,
      titles: [],
      team: D.ECONOMY.newPlayer.pets.slice(),
      settings: { sound: true, speed: 1, auto: !!(D.BATTLE_RULES.autoSkill && D.BATTLE_RULES.autoSkill.defaultOn) },
      welcomed: false
    };
  }
  function migrate(o) {
    var m = deepMerge(newSave(), o);
    if (!o.pets) m.pets = newSave().pets;
    Object.keys(m.pets).forEach(function (id) {
      if (!PETS[id]) { delete m.pets[id]; return; }
      var st = deepMerge(newPetState(), m.pets[id]);
      if (st.branch && !st.evo) st.evo = 1;          // 舊版「已轉職」= 已一階進化
      if (st.classPrompted && !st.evoPrompted) st.evoPrompted = 1;
      delete st.classPrompted;
      m.pets[id] = st;
    });
    m.gear = (m.gear || []).filter(function (g) { return RECIPES[g.recipe]; });
    m.gear.forEach(function (g) { if (!QUALITY[g.q]) g.q = 'epic'; if (g.by && !m.pets[g.by]) g.by = null; });
    Object.keys(m.mats).forEach(function (k) { if (!D.MATERIALS[k]) delete m.mats[k]; });
    Object.keys(m.items).forEach(function (k) { if (!D.ITEMS[k]) delete m.items[k]; });
    delete m.mazes;
    if (m.daily) delete m.daily.mazeReplay;
    m.v = SAVE_VERSION; m.dataVersion = D.META.dataVersion;
    return m;
  }
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') { S = newSave(); return true; }
    S = migrate(raw); return false;
  }
  function save() {
    if (!S) return;
    S.lastSeen = now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { console.warn('[晨露森旅] 存檔失敗', e); }
  }
  function markDirty() { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(save, 600); }

  function campEff() { return BUILD.campfire.levels[S.buildings.campfire - 1].effects; }
  function nestEff() { return BUILD.nest.levels[S.buildings.nest - 1].effects; }
  function workEff() { return BUILD.workshop.levels[S.buildings.workshop - 1].effects; }

  // 離線結算：未滿 1 小時直接入帳；滿 1 小時放進營火旁的「下班收成籃」，一鍵領取露水與素材
  function settleOffline() {
    var last = S.lastSeen || now();
    var hours = clamp((now() - last) / 3600000, 0, D.ECONOMY.offlineMaxHours);
    S.offlineAcc = (S.offlineAcc || 0) + hours * campEff().offlineDewPerHour;
    var gain = Math.floor(S.offlineAcc);
    S.offlineAcc -= gain;
    S.lastSeen = now();
    var BK = D.CAMP_EVENTS.basket;
    if (hours >= BK.minOfflineHours || S.basket) {
      var b = S.basket || { dew: 0, mats: 0, hours: 0 };
      b.dew += gain; b.hours = Math.min(D.ECONOMY.offlineMaxHours, b.hours + hours);
      b.mats = Math.min(BK.maxMats, Math.floor(b.hours / BK.hoursPerMat));
      S.basket = b;
      return { gain: gain, hours: hours, basket: hours >= BK.minOfflineHours };
    }
    S.dew += gain;
    return { gain: gain, hours: hours, basket: false };
  }

  /* =================================================================
   * 3. 每日重置與任務
   * ================================================================= */
  function checkDay() {
    var k = dayKey();
    if (S.daily.day === k) return false;
    S.daily = { day: k, prog: {}, claimed: [], chests: [], endlessRuns: 0, freeDew: false, bottles: 0 };
    S.steps.day = k; S.steps.today = 0; S.steps.dewToday = 0; S.steps.claimed = [];
    markDirty();
    return true;
  }
  function questUnlocked(q) { return !q.unlock || stageCleared(q.unlock.stageClear); }
  function questProg(q) { return Math.min(q.target, S.daily.prog[q.id] || 0); }
  function questClaimable(q) { return questUnlocked(q) && questProg(q) >= q.target && S.daily.claimed.indexOf(q.id) < 0; }
  function questAdd(type, n, mode) {
    D.DAILY_QUESTS.forEach(function (q) {
      if (q.type !== type) return;
      var cur = S.daily.prog[q.id] || 0;
      S.daily.prog[q.id] = mode === 'max' ? Math.max(cur, n) : cur + (n == null ? 1 : n);
    });
    markDirty(); refreshDots();
  }
  function activityNow() {
    return D.DAILY_QUESTS.reduce(function (a, q) { return a + (S.daily.claimed.indexOf(q.id) >= 0 ? q.activity : 0); }, 0);
  }

  /* =================================================================
   * 4. 獎勵（露水、星塵、葉籤、素材、道具、稱號；支援 [最少,最多] 隨機與隨機素材）
   * ================================================================= */
  function rollN(v) { return Array.isArray(v) ? randInt(v[0], v[1]) : v; }
  function grant(rew, mul) {
    mul = mul || 1; var out = [];
    if (!rew) return out;
    if (rew.dew) { var d = Math.round(rollN(rew.dew) * mul); S.dew += d; out.push({ k: 'dew', n: d }); }
    if (rew.coins) { var c = Math.round(rollN(rew.coins) * mul); S.coins += c; out.push({ k: 'coins', n: c }); }
    if (rew.summonTicket) { S.tickets += rew.summonTicket; out.push({ k: 'ticket', n: rew.summonTicket }); }
    if (rew.mats) Object.keys(rew.mats).forEach(function (m) {
      if (m === 'random') {
        var cnt = Math.max(1, Math.round(rollN(rew.mats.random) * mul)), got = {};
        for (var i = 0; i < cnt; i++) { var mm = pick(D.TRAIL.forageMatPool); got[mm] = (got[mm] || 0) + 1; }
        Object.keys(got).forEach(function (k) { S.mats[k] = (S.mats[k] || 0) + got[k]; out.push({ k: k, n: got[k] }); });
        return;
      }
      var n = Math.max(1, Math.round(rollN(rew.mats[m]) * mul)); S.mats[m] = (S.mats[m] || 0) + n; out.push({ k: m, n: n });
    });
    if (rew.items) Object.keys(rew.items).forEach(function (k) { var n = rollN(rew.items[k]); if (n > 0) { S.items[k] = (S.items[k] || 0) + n; out.push({ k: k, n: n }); } });
    if (rew.title) { if (S.titles.indexOf(rew.title) < 0) S.titles.push(rew.title); out.push({ k: 'title', n: rew.title }); }
    markDirty(); refreshHUD();
    return out;
  }
  function mergeRewards(list) {
    var map = {}, order = [];
    list.forEach(function (r) {
      if (r.k === 'title' || r.k === 'pet' || r.k === 'exp' || r.k === 'shard' || r.k === 'text') { order.push(r); return; }
      if (!map[r.k]) { map[r.k] = { k: r.k, n: 0 }; order.push(map[r.k]); }
      map[r.k].n += r.n;
    });
    return order;
  }
  function rewardChip(r, i) {
    var c = UI.tpl('reward-chip'); c.style.setProperty('--i', i || 0);
    var svg = c.querySelector('svg'), lbl = c.querySelector('span');
    var icon = { dew: '#i-dew', coins: '#i-stardust', ticket: '#i-ticket', title: '#i-flag', exp: '#i-star', text: '#i-leaf' }[r.k];
    if (D.MATERIALS[r.k] || D.ITEMS[r.k] || r.k === 'pet' || r.k === 'shard') {
      var a = el('div', 'art'); svg.replaceWith(a);
      if (r.k === 'pet' || r.k === 'shard') { UI.setArt(a, petArt(r.id), PETS[r.id].fallback); a.classList.toggle('is-shiny', !!r.shiny || isShiny(r.id)); }
      else if (D.ITEMS[r.k]) UI.setArt(a, D.ASSETS.items[r.k], D.ITEMS[r.k].fallback);
      else UI.setArt(a, D.ASSETS.materials[r.k], D.MATERIALS[r.k].fallback);
    } else if (icon) svg.querySelector('use').setAttribute('href', icon);
    lbl.textContent = r.k === 'title' || r.k === 'text' ? r.n : r.k === 'pet' ? petName(r.id) : r.k === 'shard' ? '碎片 +' + r.n : r.k === 'exp' ? 'EXP ' + fmt(r.n) : '×' + fmt(r.n);
    if (r.k === 'text') c.style.width = 'auto', c.style.padding = '0 10px';
    if (r.tag) { var t = el('span', 'rc-tag'); t.textContent = r.tag; c.appendChild(t); }
    c.title = D.ITEMS[r.k] ? D.ITEMS[r.k].name : D.MATERIALS[r.k] ? D.MATERIALS[r.k].name : '';
    return c;
  }
  function renderRewards(box, list) {
    box.innerHTML = '';
    if (!list.length) { box.appendChild(el('p', 't-small t-soft', '這次沒有額外獎勵')); return; }
    list.forEach(function (r, i) { box.appendChild(rewardChip(r, i)); });
  }
  function showRewards(title, list, snd, msg) {
    $('#rewardTitle').textContent = title;
    var m = $('#rewardMsg');
    if (!m) { m = el('p', 'reward-msg'); m.id = 'rewardMsg'; m.style.cssText = 'text-align:center;font-size:14px;line-height:1.7;margin:2px 0 6px;color:var(--ink)'; $('#rewardList').parentNode.insertBefore(m, $('#rewardList')); }
    m.textContent = msg || ''; m.style.display = msg ? '' : 'none';
    renderRewards($('#rewardList'), mergeRewards(list));
    UI.openModal('modalReward');
    Sound.play(snd || 'coin');
  }
  function costItem(key, have, need) {
    var c = UI.tpl('cost-item'), a = c.querySelector('.art');
    if (key === 'coins' || key === 'dew') {
      a.outerHTML = '<svg class="ico" style="font-size:26px"><use href="' + (key === 'coins' ? '#i-stardust' : '#i-dew') + '"/></svg>';
    } else if (D.ITEMS[key]) UI.setArt(a, D.ASSETS.items[key], D.ITEMS[key].fallback);
    else UI.setArt(a, D.ASSETS.materials[key], D.MATERIALS[key].fallback);
    c.querySelector('.t-num').textContent = need == null ? fmt(have) : fmt(have) + ' / ' + fmt(need);
    if (need != null && have < need) c.classList.add('is-short');
    c.title = D.ITEMS[key] ? D.ITEMS[key].name : D.MATERIALS[key] ? D.MATERIALS[key].name : '';
    return c;
  }
  function canPay(cost, matMul) {
    if (!cost) return true;
    if (cost.coins && S.coins < cost.coins) return false;
    if (cost.dew && S.dew < cost.dew) return false;
    var ok = true;
    Object.keys(cost.mats || {}).forEach(function (m) { if ((S.mats[m] || 0) < matNeed(cost.mats[m], matMul)) ok = false; });
    Object.keys(cost.items || {}).forEach(function (k) { if ((S.items[k] || 0) < cost.items[k]) ok = false; });
    return ok;
  }
  function pay(cost, matMul) {
    if (cost.coins) S.coins -= cost.coins;
    if (cost.dew) S.dew -= cost.dew;
    Object.keys(cost.mats || {}).forEach(function (m) { S.mats[m] -= matNeed(cost.mats[m], matMul); });
    Object.keys(cost.items || {}).forEach(function (k) { S.items[k] -= cost.items[k]; });
    markDirty(); refreshHUD();
  }
  function matNeed(n, mul) { return mul == null ? n : Math.max(1, Math.ceil(n * mul)); }
  function renderCost(box, cost, matMul) {
    box.innerHTML = '';
    if (!cost) return;
    if (cost.coins) box.appendChild(costItem('coins', S.coins, cost.coins));
    Object.keys(cost.items || {}).forEach(function (k) { box.appendChild(costItem(k, S.items[k] || 0, cost.items[k])); });
    Object.keys(cost.mats || {}).forEach(function (m) { box.appendChild(costItem(m, S.mats[m] || 0, matNeed(cost.mats[m], matMul))); });
  }

  /* =================================================================
   * 5. 數值計算（等級、星級、進化、轉職、閃光、裝備、營火即時套用）
   * ================================================================= */
  function branchOf(id, bid) { return PETS[id].classChange.branches.find(function (b) { return b.id === bid; }) || null; }
  function gearById(uid) { return S.gear.find(function (g) { return g.uid === uid; }) || null; }
  function petStats(id) {
    var P = PETS[id], st = S.pets[id], lv = st ? st.lv : 1, b = P.base, g = P.growth;
    var hp = b.hp + g.hp * (lv - 1), atk = b.atk + g.atk * (lv - 1), def = b.def + g.def * (lv - 1);
    var mul = 1 + D.STAR_RULES.statBonusPctPerStar * ((st ? st.star : 1) - 1) / 100;
    if (st && st.evo) mul *= D.EVOLUTION.stages[st.evo - 1].statMul;
    if (st && st.shiny) mul *= 1 + D.SHINY.statBonusPct / 100;
    hp *= mul; atk *= mul; def *= mul;
    var br = st && st.branch ? branchOf(id, st.branch) : null;
    if (br) { hp *= br.statMul.hp || 1; atk *= br.statMul.atk || 1; def *= br.statMul.def || 1; }
    var o = { hp: hp, atk: atk, def: def, aspd: b.aspd, range: b.range, block: b.block, cost: P.cost, critRate: b.critRate,
      critDmg: D.BATTLE_RULES.damage.baseCritDmg, healPct: 0, cdPct: 0, dmgDown: 0, aspdPct: 0 };
    if (br && br.passive) {
      if (br.passive.type === 'rangeAdd') { o.range += br.passive.add; o.critRate += br.passive.critRateAdd || 0; }
      if (br.passive.type === 'blockAdd') o.block += br.passive.add;
    }
    var hpPct = 0, atkPct = 0, defPct = 0;
    function add(k, v) {
      switch (k) {
        case 'hp': o.hp += v; break; case 'atk': o.atk += v; break; case 'def': o.def += v; break;
        case 'hpPct': hpPct += v; break; case 'atkPct': atkPct += v; break; case 'defPct': defPct += v; break;
        case 'critRate': o.critRate += v; break; case 'critDmg': o.critDmg += v; break; case 'healPct': o.healPct += v; break;
        case 'aspdPct': o.aspdPct += v; break; case 'skillCdPct': o.cdPct += v; break; case 'dmgTakenDown': o.dmgDown += v; break;
        case 'costDown': o.cost -= v; break;
      }
    }
    if (st) Object.keys(st.gear).forEach(function (slot) {
      var gi = gearById(st.gear[slot]); if (!gi) return;
      Object.keys(gi.main).forEach(function (k) { add(k, gi.main[k]); });
      gi.subs.forEach(function (sb) { add(sb.stat, sb.val); });
    });
    var cf = campEff(); hpPct += cf.teamHpPct; atkPct += cf.teamAtkPct;
    o.hp = Math.round(o.hp * (1 + hpPct / 100));
    o.atk = Math.round(o.atk * (1 + atkPct / 100));
    o.def = Math.round(o.def * (1 + defPct / 100));
    o.aspd = Math.round(o.aspd / (1 + o.aspdPct / 100) * 100) / 100;
    o.cost = Math.max(1, o.cost);
    return o;
  }
  function petSkill(id) {
    var P = PETS[id], st = S.pets[id], sk = P.skill;
    var o = { name: sk.name, desc: sk.desc, cd: sk.cd, initialCd: sk.initialCd, duration: sk.duration, target: sk.target, effects: sk.effects.map(function (e) { return Object.assign({}, e); }) };
    var br = st && st.branch ? branchOf(id, st.branch) : null;
    if (br && br.skillMod) {
      var m = br.skillMod;
      if (m.duration) o.duration = m.duration;
      if (m.cdAdd) o.cd += m.cdAdd;
      if (m.addEffects) o.effects = o.effects.concat(m.addEffects.map(function (e) { return Object.assign({}, e); }));
      if (m.effectOverride) o.effects.forEach(function (e) { if (m.effectOverride[e.type]) Object.assign(e, m.effectOverride[e.type]); });
    }
    var cdPct = petStats(id).cdPct;
    o.cd = Math.max(4, Math.round(o.cd * (1 - cdPct / 100) * 10) / 10);
    o.initialCd = Math.min(o.initialCd, o.cd);
    return o;
  }
  function elemMul(a, d) {
    if (!a || !d) return 1;
    if (D.ELEMENTS[a].strongVs === d) return D.ELEMENT_MULTIPLIER.strong;
    if (D.ELEMENTS[a].weakVs === d) return D.ELEMENT_MULTIPLIER.weak;
    return D.ELEMENT_MULTIPLIER.neutral;
  }

  /* =================================================================
   * 6. 精靈成長（經驗、升級、碎片升星、閃光、進化提醒）
   * ================================================================= */
  var evoQueue = [];
  function expNeed(lv) { return D.LEVEL_RULES.expToNext[lv - 1] || Infinity; }
  function evoNext(id) { var st = S.pets[id]; return st ? D.EVOLUTION.stages[st.evo || 0] || null : null; }
  function evoReady(id) { var st = S.pets[id], nx = evoNext(id); return !!(nx && st.lv >= nx.lv); }
  function queueEvoIfReady(id) {
    var st = S.pets[id], nx = evoNext(id);
    if (nx && st.lv >= nx.lv && (st.evoPrompted || 0) < nx.stage && evoQueue.indexOf(id) < 0) evoQueue.push(id);
  }
  function addExp(id, n) {
    var st = S.pets[id]; if (!st || n <= 0) return 0;
    var max = D.LEVEL_RULES.maxLevel, ups = 0;
    if (st.lv >= max) return 0;
    st.exp += Math.round(n);
    while (st.lv < max && st.exp >= expNeed(st.lv)) { st.exp -= expNeed(st.lv); st.lv++; ups++; }
    if (st.lv >= max) st.exp = 0;
    queueEvoIfReady(id);
    markDirty();
    return ups;
  }
  function obtainPet(id, shiny) {
    var st = S.pets[id];
    if (!st) { st = S.pets[id] = newPetState(); st.shiny = !!shiny; return { id: id, isNew: true, shiny: !!shiny }; }
    var res = { id: id, shiny: !!shiny };
    if (shiny && !st.shiny && D.SHINY.dupUpgrades) { st.shiny = true; res.shinyUp = true; }
    var R = D.STAR_RULES;
    if (st.star < R.maxStar) {
      st.shards++; res.shard = true; res.starUp = 0;
      while (st.star < R.maxStar && st.shards >= R.dupNeededForStar[st.star + 1]) { st.shards -= R.dupNeededForStar[st.star + 1]; st.star++; res.starUp = st.star; }
      return res;
    }
    res.exp = Math.round(D.RARITIES[PETS[id].rarity].dupExpAfterMaxStar * (1 + nestEff().dupExpBonusPct / 100));
    addExp(id, res.exp);
    return res;
  }

  /* =================================================================
   * 7. 召喚（開蛋動畫、保底、閃光異色、重複轉碎片自動升星）
   * ================================================================= */
  var lastSummonN = 1;
  function summonCost(n) {
    var one = nestEff().summonCostDew;
    return n === 1 ? one : Math.round(one * D.SUMMON.multiCostDew / D.SUMMON.costDew);
  }
  function rollRarity() {
    var e = nestEff(), r = D.SUMMON.rates;
    return weighted([['R', r.R - e.srRateBonus - e.ssrRateBonus], ['SR', r.SR + e.srRateBonus], ['SSR', r.SSR + e.ssrRateBonus], ['UR', r.UR]]);
  }
  function doSummon(n) {
    var useTicket = n === 1 && S.tickets > 0;
    var cost = useTicket ? 0 : summonCost(n);
    if (!useTicket && S.dew < cost) { Sound.play('bump'); UI.toast('露水不夠了，去走走路收集露水吧', 'warn'); return false; }
    if (useTicket) S.tickets--; else S.dew -= cost;
    var shinyRate = S.charmActive ? D.SHINY.charmRatePct : D.SHINY.ratePct;
    S.charmActive = false;
    var rar = [];
    for (var i = 0; i < n; i++) {
      S.summon.pity++;
      var r = rollRarity();
      if (S.summon.pity >= D.SUMMON.pitySSR && r !== 'SSR' && r !== 'UR') r = weighted([['SSR', D.SUMMON.rates.SSR], ['UR', D.SUMMON.rates.UR]]);
      if (r === 'SSR' || r === 'UR') S.summon.pity = 0;
      rar.push(r);
    }
    if (n >= D.SUMMON.multiCount && D.SUMMON.multiGuaranteeSR && rar.every(function (x) { return x === 'R'; })) rar[n - 1] = 'SR';
    var outs = rar.map(function (r) {
      var shiny = Math.random() * 100 < shinyRate;
      return Object.assign(obtainPet(pick(D.SUMMON.poolByRarity[r]), shiny), { rarity: r });
    });
    S.summon.total += n; lastSummonN = n;
    questAdd('summon', n);
    markDirty(); refreshHUD();
    playSummon(outs);
    return outs;
  }
  function playSummon(outs) {
    var stage = $('#summonStage'), box = $('#summonResults'), ribbon = $('#modalSummon .modal-title');
    box.innerHTML = ''; ribbon.textContent = '孵化中…';
    stage.dataset.best = '';
    var egg = stage.querySelector('.nest-egg'); var fresh = egg.cloneNode(true); egg.replaceWith(fresh);
    stage.classList.remove('is-hatching'); void stage.offsetWidth; stage.classList.add('is-hatching');
    $('#btnSummonAgain').disabled = true;
    UI.openModal('modalSummon');
    [0, 300, 600, 900].forEach(function (t) { setTimeout(function () { Sound.play('crack'); }, t); });
    setTimeout(function () {
      var top = outs.some(function (o) { return o.rarity === 'UR' || o.rarity === 'SSR'; }) ? 'SSR' : outs.some(function (o) { return o.rarity === 'SR'; }) ? 'SR' : 'R';
      var anyShiny = outs.some(function (o) { return o.shiny; });
      stage.dataset.best = top;
      ribbon.textContent = anyShiny ? '閃光出現了！' : outs.some(function (o) { return o.isNew; }) ? '遇見新夥伴！' : '孵化完成';
      Sound.play('hatch');
      if (anyShiny) setTimeout(function () { Sound.play('shiny'); }, 300);
      outs.forEach(function (o, i) {
        var c = petCard(o.id, { shiny: o.shiny }); c.style.setProperty('--i', i);
        if (o.isNew) c.classList.add('is-new');
        c.querySelector('.pc-lv').textContent = o.isNew ? '新夥伴' : o.shinyUp ? '變閃光' : o.starUp ? '升到 ★' + o.starUp : o.shard ? '碎片 +1' : 'EXP +' + o.exp;
        box.appendChild(c);
      });
      box.style.gridTemplateColumns = outs.length === 1 ? 'repeat(3, 1fr)' : '';
      if (outs.length === 1) box.insertBefore(el('div'), box.firstChild);
      var again = $('#btnSummonAgain'); again.disabled = false;
      again.innerHTML = '再召喚 ' + (lastSummonN === 1 && S.tickets > 0 ? '（葉籤）' : '<svg class="ico" style="font-size:14px"><use href="#i-dew"/></svg> ' + summonCost(lastSummonN));
      if (outs.some(function (o) { return o.starUp; })) setTimeout(function () { Sound.play('levelup'); }, 500);
      refreshDots();
    }, 1500);
  }

  /* =================================================================
   * 8. HUD 與紅點
   * ================================================================= */
  var hudLast = { dew: null, coins: null };
  function refreshHUD() {
    if (!S) return;
    var dv = $('#hudDewVal'), cv = $('#hudStardustVal');
    dv.textContent = fmt(S.dew); cv.textContent = fmt(S.coins);
    if (hudLast.dew != null && S.dew > hudLast.dew) bumpPill('#hudDew');
    if (hudLast.coins != null && S.coins > hudLast.coins) bumpPill('#hudStardust');
    hudLast.dew = S.dew; hudLast.coins = S.coins;
    $('#campStepVal').textContent = fmt(S.steps.today);
    $('#campStepRing').style.setProperty('--pct', clamp(S.steps.today / 10000 * 100, 0, 100));
  }
  function bumpPill(sel) { var p = $(sel); p.classList.remove('is-bump'); void p.offsetWidth; p.classList.add('is-bump'); }
  function buildingUpgradable(id) {
    var b = BUILD[id], lv = S.buildings[id]; if (lv >= b.levels.length) return false;
    var nx = b.levels[lv]; if (nx.requires && !stageCleared(nx.requires.stageClear)) return false;
    return canPay(nx.upgradeCost);
  }
  function trailUnlocked() { return stageCleared(D.TRAIL.unlock.stageClear); }
  function refreshDots() {
    if (!S) return;
    var q = D.DAILY_QUESTS.some(questClaimable);
    var act = activityNow();
    var chest = D.DAILY_ACTIVITY_CHESTS.some(function (c, i) { return act >= c.need && S.daily.chests.indexOf(i) < 0; });
    var stepD = D.STEP_MILESTONES.daily.some(function (m, i) { return S.steps.today >= m.steps && S.steps.claimed.indexOf(i) < 0; });
    var stepL = D.STEP_MILESTONES.lifetime.some(function (m, i) { return S.steps.lifetime >= m.steps && S.steps.lifeClaimed.indexOf(i) < 0; });
    UI.setDot('quests', q || chest || stepD || stepL);
    var canSummon = S.tickets > 0 || S.dew >= summonCost(1);
    UI.setDot('nest', canSummon || buildingUpgradable('nest'));
    UI.setDot('campfire', buildingUpgradable('campfire') || (campEff().dailyFreeDew > 0 && !S.daily.freeDew));
    UI.setDot('workshop', buildingUpgradable('workshop'));
    UI.setDot('pets', canSummon || Object.keys(S.pets).some(evoReady));
    var trailQuest = D.DAILY_QUESTS.find(function (x) { return x.type === 'trailRun'; });
    UI.setDot('explore', trailUnlocked() && (!!S.trail.active || (trailQuest && questProg(trailQuest) < trailQuest.target)));
    var next = STAGES.find(function (s) { return stageUnlocked(s) && !stageCleared(s.id); });
    UI.setDot('adventure', !!next);
  }

  /* =================================================================
   * 9. 營地（精靈散步、點擊跳躍冒愛心、散步回饋、漂流信瓶、下班收成籃、靜心模式）
   * ================================================================= */
  var Camp = {
    canvas: null, ctx: null, pets: [], hearts: [], sparks: [], imgs: {}, ratio: null, running: false, last: 0, W: 0, H: 0, dpr: 1, talkT: 0,
    bottleT: 0, bottleOn: false, bottleXY: null,
    AREA: { x0: 18, x1: 82, y0: 52, y1: 82 },          // 散步範圍：bg_camp.png 的百分比座標
    LINES: ['今天也一起散步吧！', '露水亮晶晶的～', '呼～草地好軟', '要去冒險了嗎？', '走了好多步，好厲害！', '營火暖暖的', '肚子有點餓了…', '嘿嘿，抓不到我～'],
    init: function () {
      this.canvas = $('#campCanvas'); this.ctx = this.canvas.getContext('2d');
      var self = this;
      var im = new Image(); im.onload = function () { self.ratio = im.naturalWidth / im.naturalHeight; self.resize(); }; im.src = D.ASSETS.backgrounds.camp;
      window.addEventListener('resize', function () { self.resize(); });
      this.canvas.addEventListener('pointerdown', function (e) { self.tap(e); });
      UI.setArt($('#campBottle .art'), D.ASSETS.props.campBottle, { color: '#CFE6EE', glyph: '瓶' });
      UI.setArt($('#campBasket .art'), D.ASSETS.props.campBasket, { color: '#C99B6C', glyph: '籃' });
      this.bottleT = rand(D.CAMP_EVENTS.bottle.firstDelaySec[0], D.CAMP_EVENTS.bottle.firstDelaySec[1]);
      this.resize(); this.sync();
    },
    resize: function () {
      var r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = r.width; this.H = r.height;
      this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
      this.placeHotspots();
    },
    rect: function () {                                // 背景圖以 cover＋置底 繪製時，圖片在畫面上的實際範圍
      var W = this.W, H = this.H;
      if (!this.ratio) return { x: 0, y: 0, w: W, h: H };
      var w = W, h = W / this.ratio; if (h < H) { h = H; w = H * this.ratio; }
      return { x: (W - w) / 2, y: H - h, w: w, h: h };
    },
    toPx: function (xp, yp) { var R = this.rect(); return [clamp(R.x + xp / 100 * R.w, this.W * 0.06, this.W * 0.94), R.y + yp / 100 * R.h]; },
    placeHotspots: function () {                       // 建築木牌、收成籃、信瓶對齊 bg_camp.png
      if (!this.W) return;
      var R = this.rect(), W = this.W, self = this;
      D.CAMP_BUILDINGS.forEach(function (b) {
        var hs = document.querySelector('.hotspot[data-building="' + b.id + '"]'); if (!hs || !b.pos) return;
        hs.style.setProperty('--x', clamp(R.x + b.pos.x / 100 * R.w, 70, W - 70) + 'px');
        hs.style.setProperty('--y', (R.y + b.pos.y / 100 * R.h) + 'px');
      });
      var bp = D.CAMP_EVENTS.basket.pos, bk = $('#campBasket'), p = this.toPx(bp.x, bp.y);
      bk.style.left = p[0] + 'px'; bk.style.top = p[1] + 'px';
      if (this.bottleXY) { var q = this.toPx(this.bottleXY[0], this.bottleXY[1]), bt = $('#campBottle'); bt.style.left = q[0] + 'px'; bt.style.top = q[1] + 'px'; }
      bk.hidden = !(S && S.basket && (S.basket.dew > 0 || S.basket.mats > 0));
    },
    img: function (id) {
      var src = petArt(id);
      if (!this.imgs[src]) { var im = new Image(); im.src = src; this.imgs[src] = im; }
      return this.imgs[src];
    },
    sync: function () {                                // 依存檔同步營地精靈
      var A = this.AREA, self = this;
      var ids = Object.keys(S.pets);
      this.pets = this.pets.filter(function (p) { return ids.indexOf(p.id) >= 0; });
      ids.forEach(function (id) {
        self.img(id);
        if (self.pets.some(function (p) { return p.id === id; })) return;
        var x = rand(A.x0 + 4, A.x1 - 4), y = rand(A.y0 + 3, A.y1 - 3);
        self.pets.push({ id: id, x: x, y: y, tx: x, ty: y, wait: rand(0.5, 2.5), walking: false, face: 1, ph: rand(0, 6.28), jump: 0, spawn: 0 });
      });
      this.placeHotspots();
    },
    start: function () { if (this.running) return; this.running = true; this.last = performance.now(); var self = this; requestAnimationFrame(function f(t) { if (!self.running) return; self.frame(t); requestAnimationFrame(f); }); },
    stop: function () { this.running = false; },
    frame: function (t) {
      var dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
      if (!this.W) this.resize();
      this.update(dt); this.draw(t / 1000);
    },
    update: function (dt) {
      var A = this.AREA;
      this.pets.forEach(function (p) {
        p.spawn = Math.min(1, p.spawn + dt * 2);
        if (p.jump > 0) p.jump = Math.max(0, p.jump - dt * 1.6);
        if (p.walking) {
          var dx = p.tx - p.x, dy = p.ty - p.y, dist = Math.hypot(dx, dy);
          var sp = 5.5 * dt;
          if (dist <= sp) { p.x = p.tx; p.y = p.ty; p.walking = false; p.wait = rand(1.2, 4.5); }
          else { p.x += dx / dist * sp; p.y += dy / dist * sp * 0.8; if (Math.abs(dx) > 0.3) p.face = dx > 0 ? 1 : -1; }
        } else {
          p.wait -= dt;
          if (p.wait <= 0) { p.tx = clamp(p.x + rand(-22, 22), A.x0, A.x1); p.ty = clamp(p.y + rand(-12, 12), A.y0, A.y1); p.walking = true; }
        }
      });
      for (var i = 0; i < this.pets.length; i++) for (var j = i + 1; j < this.pets.length; j++) {
        var a = this.pets[i], b = this.pets[j], dx = b.x - a.x, dy = (b.y - a.y) * 1.6, d = Math.hypot(dx, dy);
        if (d > 0 && d < 9) { var push = (9 - d) * 0.5 * dt * 4; a.x -= dx / d * push; b.x += dx / d * push; a.y -= dy / d * push * 0.5; b.y += dy / d * push * 0.5; }
      }
      this.pets.forEach(function (p) { p.x = clamp(p.x, A.x0, A.x1); p.y = clamp(p.y, A.y0, A.y1); });
      this.hearts = this.hearts.filter(function (h) { h.t += dt; h.y -= dt * 46; h.x += Math.sin(h.t * 6 + h.ph) * dt * 18; return h.t < 1.2; });
      this.talkT -= dt;
      // 漂流木信瓶
      var BT = D.CAMP_EVENTS.bottle;
      if (!this.bottleOn && S.daily.bottles < BT.dailyMax && !$('#app').classList.contains('is-zen')) {
        this.bottleT -= dt;
        if (this.bottleT <= 0) this.spawnBottle();
      }
    },
    size: function (p) {
      var A = this.AREA, depth = (p.y - A.y0) / (A.y1 - A.y0);
      return Math.min(this.W * 0.21, 96) * (0.82 + 0.3 * depth);
    },
    draw: function (t) {
      var c = this.ctx, dpr = this.dpr, self = this;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, this.W, this.H);
      this.pets.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (p) {
        var pos = self.toPx(p.x, p.y), x = pos[0], y = pos[1], s = self.size(p) * (0.4 + 0.6 * p.spawn);
        var breath = Math.sin(t * 2.4 + p.ph);
        var bob = p.walking ? Math.abs(Math.sin(t * 9 + p.ph)) * s * 0.06 : 0;
        var jumpH = p.jump > 0 ? Math.sin((1 - p.jump) * Math.PI) * s * 0.55 : 0;
        var shiny = isShiny(p.id);
        c.fillStyle = 'rgba(55,70,40,' + (0.26 - jumpH / s * 0.12) + ')';
        c.beginPath(); c.ellipse(x, y, s * 0.32 * (1 - jumpH / s * 0.4), s * 0.09, 0, 0, Math.PI * 2); c.fill();
        if (shiny) {                                   // 閃光：腳下暖金光暈
          var g = c.createRadialGradient(x, y - s * 0.45, s * 0.05, x, y - s * 0.45, s * 0.6);
          g.addColorStop(0, 'rgba(255,236,170,.55)'); g.addColorStop(1, 'rgba(255,236,170,0)');
          c.fillStyle = g; c.beginPath(); c.arc(x, y - s * 0.45 - jumpH, s * 0.6, 0, 7); c.fill();
        }
        var sx = 1 + breath * 0.035, sy = 1 - breath * 0.035;
        if (p.jump > 0.85) { sx *= 1.12; sy *= 0.86; }
        c.save();
        c.translate(x, y - bob - jumpH);
        c.scale(sx * p.face, sy);
        var im = self.img(p.id);
        if (shiny) c.filter = 'sepia(.35) saturate(1.35) hue-rotate(-12deg) brightness(1.08)';
        if (im && im.complete && im.naturalWidth) {
          var ar = im.naturalWidth / im.naturalHeight, w = ar >= 1 ? s : s * ar, h = ar >= 1 ? s / ar : s;
          c.drawImage(im, -w / 2, -h, w, h);
        } else self.drawFallback(c, PETS[p.id], s, p.face);
        c.restore();
        if (shiny) {                                   // 閃光：星塵小亮點
          for (var k = 0; k < 3; k++) {
            var ang = t * 1.4 + k * 2.1 + p.ph, sx2 = x + Math.cos(ang) * s * 0.42, sy2 = y - bob - jumpH - s * 0.55 + Math.sin(ang * 1.3) * s * 0.3;
            var a2 = 0.5 + 0.5 * Math.sin(t * 4 + k);
            c.fillStyle = 'rgba(255,240,180,' + a2 + ')';
            c.beginPath(); c.arc(sx2, sy2, 2.4, 0, 7); c.fill();
          }
        }
      });
      this.hearts.forEach(function (h) {
        if (h.t < 0) return;
        var a = 1 - h.t / 1.2, sc = h.s * (0.6 + Math.min(1, h.t * 4) * 0.4);
        c.save(); c.globalAlpha = a; c.translate(h.x, h.y); c.scale(sc, sc);
        c.fillStyle = h.color || '#F08B7E'; c.strokeStyle = '#B85F55'; c.lineWidth = 1.5 / sc;
        c.beginPath(); c.moveTo(0, 6); c.bezierCurveTo(-10, -2, -6, -12, 0, -6); c.bezierCurveTo(6, -12, 10, -2, 0, 6); c.closePath(); c.fill(); c.stroke();
        c.restore();
      });
    },
    drawFallback: function (c, P, s, face) {
      var col = P.fallback.color, r = s * 0.42;
      var g = c.createRadialGradient(-r * 0.3, -r * 1.3, r * 0.1, 0, -r, r * 1.1);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.35, col); g.addColorStop(1, col);
      c.fillStyle = g; c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, -r, r, r * 0.95, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#4B3F32';
      c.beginPath(); c.arc(-r * 0.3, -r * 1.05, r * 0.08, 0, 7); c.arc(r * 0.3, -r * 1.05, r * 0.08, 0, 7); c.fill();
      c.save(); c.scale(face, 1);
      c.fillStyle = '#FFFFFF'; c.font = '800 ' + Math.round(r * 0.55) + 'px ' + getComputedStyle(document.body).fontFamily;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(P.fallback.glyph, 0, -r * 0.45);
      c.restore();
    },
    hit: function (mx, my) {
      var self = this;
      return this.pets.slice().sort(function (a, b) { return b.y - a.y; }).find(function (p) {
        var pos = self.toPx(p.x, p.y), s = self.size(p);
        return Math.abs(mx - pos[0]) < s * 0.45 && my < pos[1] + s * 0.1 && my > pos[1] - s * 1.05;
      });
    },
    hop: function (p, hearts) {
      if (p.jump <= 0.2) p.jump = 1;
      p.walking = false; p.wait = rand(1, 2);
      var pos = this.toPx(p.x, p.y), s = this.size(p);
      for (var i = 0; i < (hearts || 3); i++) this.hearts.push({ x: pos[0] + rand(-s * 0.25, s * 0.25), y: pos[1] - s * 0.9, t: -i * 0.12, ph: rand(0, 6), s: rand(0.9, 1.3) });
      return { pos: pos, s: s };
    },
    tap: function (e) {
      if ($('#app').classList.contains('is-zen')) return;
      var r = this.canvas.getBoundingClientRect();
      var hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      if (!hit) return;
      var h = this.hop(hit);
      Sound.play('pop'); setTimeout(function () { Sound.play('heart'); }, 120);
      if (this.talkT <= 0 && Math.random() < 0.6) { this.talkT = 3; this.say(h.pos, h.s, pick(this.LINES)); }
    },
    say: function (pos, s, text, gift) {
      var b = el('div', 'speech' + (gift ? ' is-gift' : '')); b.textContent = text;
      b.style.left = pos[0] + 'px'; b.style.top = (pos[1] - s * 1.1) + 'px';
      $('#campPets').appendChild(b);
      setTimeout(function () { b.remove(); }, gift ? 3200 : 2200);
    },
    // 皮克敏式散步回饋：記步數兌換露水時，隨機一隻精靈跳起來冒泡，送森果或暖心短語
    walkFeedback: function () {
      if (!this.pets.length) return null;
      var WF = D.CAMP_EVENTS.walkFeedback, p = pick(this.pets), gift = Math.random() * 100 < WF.giftPct;
      var h = this.hop(p, 4);
      var self = this, list = gift ? grant(WF.gift) : [];
      setTimeout(function () { self.say(h.pos, h.s, petName(p.id) + '：' + pick(gift ? WF.giftLines : WF.lines), gift); Sound.play(gift ? 'coin' : 'heart'); }, 350);
      return { id: p.id, gift: list };
    },
    spawnBottle: function () {
      var A = D.CAMP_EVENTS.bottle.area;
      this.bottleXY = [rand(A.x0, A.x1), rand(A.y0, A.y1)];
      this.bottleOn = true;
      var bt = $('#campBottle'); bt.hidden = false;
      bt.classList.remove('is-in'); void bt.offsetWidth; bt.classList.add('is-in');
      this.placeHotspots();
      Sound.play('bottle');
    },
    openBottle: function () {
      if (!this.bottleOn) return;
      var BT = D.CAMP_EVENTS.bottle;
      this.bottleOn = false; $('#campBottle').hidden = true;
      S.daily.bottles = (S.daily.bottles || 0) + 1;
      this.bottleT = rand(BT.intervalSec[0], BT.intervalSec[1]);
      var g = weighted(BT.gifts.map(function (x) { return [x, x.weight]; }));
      showRewards('漂流木信瓶', grant(g.reward), 'pop', '「' + pick(BT.messages) + '」');
      markDirty();
    },
    openBasket: function () {
      var b = S.basket; if (!b) return;
      var mats = {}; for (var i = 0; i < b.mats; i++) { var m = pick(D.TRAIL.forageMatPool); mats[m] = (mats[m] || 0) + 1; }
      var list = grant({ dew: b.dew, mats: mats });
      var hrs = Math.round(b.hours * 10) / 10;
      S.basket = null; $('#campBasket').hidden = true;
      showRewards('下班收成籃', list, 'coin', '你離開的 ' + hrs + ' 小時裡，精靈們在營火旁幫你收集了這些。');
      markDirty(); refreshDots();
    }
  };
  function setZen(on) {
    $('#app').classList.toggle('is-zen', on);
    if (on) { UI.closeAllModals(); Sound.play('heal'); }
    else setTimeout(tryShowEvo, 600);
  }

  /* =================================================================
   * 10. 營地建築（升級、每日露水、前往）
   * ================================================================= */
  var curBuilding = null;
  var BUILD_ICON = { campfire: '#i-campfire', nest: '#i-nest', workshop: '#i-anvil' };
  function refreshBuildingLabels() {
    $('#lvCampfire').textContent = 'Lv.' + S.buildings.campfire;
    $('#lvNest').textContent = 'Lv.' + S.buildings.nest;
    $('#lvWorkshop').textContent = 'Lv.' + S.buildings.workshop;
  }
  function openBuilding(id) { curBuilding = id; renderBuilding(); UI.openModal('modalBuilding'); }
  function renderBuilding() {
    var b = BUILD[curBuilding], lv = S.buildings[curBuilding], cur = b.levels[lv - 1], nx = b.levels[lv];
    $('#buildingTitle').textContent = b.name + ' Lv.' + lv;
    $('#buildingIcon use').setAttribute('href', BUILD_ICON[curBuilding]);
    $('#buildingPips').innerHTML = b.levels.map(function (l, i) { return '<i class="' + (i < lv ? 'on' : '') + '"></i>'; }).join('');
    $('#buildingDesc').textContent = b.desc;
    $('#buildingNow').textContent = '目前：' + cur.desc;
    $('#buildingNext').textContent = nx ? '升級後：' + nx.desc : '已達最高等級';
    var costBox = $('#buildingCost'), req = $('#buildingReq'), up = $('#btnBuildingUpgrade');
    if (nx) {
      renderCost(costBox, nx.upgradeCost);
      var reqOk = !nx.requires || stageCleared(nx.requires.stageClear);
      req.textContent = reqOk ? '' : '需要先通關 ' + nx.requires.stageClear + '（普通）';
      up.disabled = !(reqOk && canPay(nx.upgradeCost));
      up.textContent = '升級';
    } else { costBox.innerHTML = ''; req.textContent = ''; up.disabled = true; up.textContent = '已滿級'; }
    var act = $('#btnBuildingAction');
    if (curBuilding === 'campfire') {
      var fd = cur.effects.dailyFreeDew;
      act.textContent = fd > 0 ? (S.daily.freeDew ? '今日已領露水' : '領取 ' + fd + ' 露水') : '記錄步數';
      act.disabled = fd > 0 && S.daily.freeDew;
    } else { act.textContent = curBuilding === 'nest' ? '前往召喚' : '前往鍛造'; act.disabled = false; }
  }
  function upgradeBuilding() {
    var b = BUILD[curBuilding], lv = S.buildings[curBuilding], nx = b.levels[lv];
    if (!nx || !canPay(nx.upgradeCost) || (nx.requires && !stageCleared(nx.requires.stageClear))) { Sound.play('bump'); return; }
    pay(nx.upgradeCost);
    S.buildings[curBuilding]++;
    Sound.play('levelup');
    UI.toast(b.name + ' 升到 Lv.' + S.buildings[curBuilding] + '！', 'good');
    markDirty(); refreshBuildingLabels(); renderBuilding(); refreshDots(); refreshHUD();
  }
  function buildingAction() {
    if (curBuilding === 'campfire') {
      var fd = campEff().dailyFreeDew;
      if (fd > 0 && !S.daily.freeDew) { S.daily.freeDew = true; UI.closeModal('modalBuilding'); showRewards('營火的禮物', grant({ dew: fd })); refreshDots(); return; }
      UI.closeModal('modalBuilding'); UI.openModal('modalSteps');
    } else if (curBuilding === 'nest') { UI.closeModal('modalBuilding'); UI.switchTab('pets'); }
    else { UI.closeModal('modalBuilding'); UI.switchTab('explore'); UI.setSubTab('explore', 'forge'); }
  }

  /* =================================================================
   * 11. 記步數（自製鍵盤、輸入今日總步數、換露水、里程碑）
   * ================================================================= */
  var stepInput = '';
  function dewForSteps(steps) { return Math.floor(steps / D.ECONOMY.stepsPerDew * (1 + campEff().stepDewBonusPct / 100)); }
  function renderSteps() {
    var big = $('#stepInputVal'), total = parseInt(stepInput, 10) || 0;
    if (stepInput) { big.textContent = fmt(total); big.classList.remove('is-empty'); }
    else { big.textContent = fmt(S.steps.today); big.classList.add('is-empty'); }
    var capped = Math.min(total, D.ECONOMY.dailyStepCap);
    var gain = stepInput && capped > S.steps.today ? dewForSteps(capped) - S.steps.dewToday : 0;
    $('#stepDewPreview').textContent = fmt(Math.max(0, gain));
    $('#stepTodayTotal').textContent = fmt(S.steps.today);
    var track = $('#stepMilestoneTrack'), ms = D.STEP_MILESTONES.daily, last = ms[ms.length - 1].steps;
    track.style.setProperty('--pct', clamp(S.steps.today / last * 100, 0, 100) + '%');
    $$('.mt-node', track).forEach(function (n) { n.remove(); });
    ms.forEach(function (m, i) {
      var reached = S.steps.today >= m.steps, claimed = S.steps.claimed.indexOf(i) >= 0;
      var n = el('button', 'mt-node' + (claimed ? ' is-claimed' : reached ? ' is-reached' : ''), '<span class="mt-gift"><svg class="ico"><use href="#i-gift"/></svg></span>' + (m.steps / 1000) + 'k');
      n.addEventListener('click', function () { claimStepMilestone('daily', i); });
      track.appendChild(n);
    });
  }
  function stepKey(k) {
    if (k === 'back') stepInput = stepInput.slice(0, -1);
    else if (k === 'clear') stepInput = '';
    else if (stepInput.length < 5) stepInput = (stepInput + k).replace(/^0+/, '');
    renderSteps();
  }
  function confirmSteps() {
    var total = parseInt(stepInput, 10) || 0, cap = D.ECONOMY.dailyStepCap;
    if (!stepInput) { UI.toast('先輸入今天的總步數喔'); Sound.play('bump'); return; }
    if (total <= S.steps.today) { UI.toast('要比今天已記錄的 ' + fmt(S.steps.today) + ' 步多才能存入喔', 'warn'); Sound.play('bump'); return; }
    var newToday = Math.min(total, cap), added = newToday - S.steps.today;
    if (added <= 0) { UI.toast('今天已經達到每日上限 ' + fmt(cap) + ' 步了', 'warn'); return; }
    S.steps.today = newToday; S.steps.lifetime += added;
    var gain = dewForSteps(newToday) - S.steps.dewToday;
    S.steps.dewToday += gain; S.dew += gain;
    questAdd('stepsInput', S.steps.today, 'max');
    stepInput = '';
    Sound.play('coin');
    UI.toast('記錄 +' + fmt(added) + ' 步，獲得 ' + fmt(gain) + ' 露水' + (total > cap ? '（已達每日上限）' : ''), 'good');
    markDirty(); refreshHUD(); renderSteps(); refreshDots();
    // 皮克敏式散步回饋：關掉彈窗後，營地精靈跳起來冒泡
    setTimeout(function () { UI.closeModal('modalSteps'); if ($('#app').dataset.tab !== 'camp') UI.switchTab('camp'); setTimeout(function () { Camp.walkFeedback(); }, 450); }, 900);
  }
  function claimStepMilestone(kind, i) {
    var list = kind === 'daily' ? D.STEP_MILESTONES.daily : D.STEP_MILESTONES.lifetime;
    var claimed = kind === 'daily' ? S.steps.claimed : S.steps.lifeClaimed;
    var cur = kind === 'daily' ? S.steps.today : S.steps.lifetime;
    var m = list[i];
    if (claimed.indexOf(i) >= 0) return;
    if (cur < m.steps) { UI.toast('還差 ' + fmt(m.steps - cur) + ' 步'); Sound.play('bump'); return; }
    claimed.push(i);
    showRewards(kind === 'daily' ? fmt(m.steps) + ' 步達成！' : m.name, grant(m.rewards));
    markDirty(); refreshDots();
    if ($('#modalSteps').classList.contains('is-open')) renderSteps();
    if ($('#modalQuests').classList.contains('is-open')) renderQuests();
  }

  /* =================================================================
   * 12. 任務抽屜
   * ================================================================= */
  function rewardText(r) {
    var p = [];
    if (r.dew) p.push('露水 ' + r.dew); if (r.coins) p.push('星塵 ' + r.coins); if (r.summonTicket) p.push('葉籤 ' + r.summonTicket);
    if (r.mats) Object.keys(r.mats).forEach(function (m) { p.push(m === 'random' ? '隨機素材' : D.MATERIALS[m].name + ' ' + r.mats[m]); });
    if (r.items) Object.keys(r.items).forEach(function (k) { p.push(D.ITEMS[k].name + ' ' + r.items[k]); });
    if (r.title) p.push('稱號「' + r.title + '」');
    return p.join('・');
  }
  function questRow(title, desc, cur, target, rewards, claimable, claimed, onClaim, extra) {
    var it = UI.tpl('quest-item');
    it.querySelector('h5').textContent = title;
    it.querySelector('p').textContent = desc;
    var bar = it.querySelector('.bar'); bar.style.setProperty('--pct', clamp(cur / target * 100, 0, 100) + '%');
    bar.querySelector('span').textContent = fmt(Math.min(cur, target)) + ' / ' + fmt(target);
    it.querySelector('.q-reward').textContent = (extra ? extra + '・' : '') + rewardText(rewards);
    var btn = it.querySelector('.btn');
    if (claimed) it.classList.add('is-claimed');
    else if (!claimable) btn.classList.add('is-disabled');
    btn.addEventListener('click', onClaim);
    return it;
  }
  var QUEST_ICON = { stepsInput: '#i-steps', battleWin: '#i-swords', summon: '#i-nest', feed: '#i-dew', craft: '#i-anvil', trailRun: '#i-tab-explore', skillCast: '#i-star', endlessWave: '#i-infinity' };
  function renderQuests() {
    checkDay();
    var act = activityNow(), maxAct = D.DAILY_ACTIVITY_CHESTS[D.DAILY_ACTIVITY_CHESTS.length - 1].need;
    $('#activityVal').textContent = act;
    $('#activityBar').style.setProperty('--pct', clamp(act / maxAct * 100, 0, 100) + '%');
    var chests = $('#activityChests'); chests.innerHTML = '';
    D.DAILY_ACTIVITY_CHESTS.forEach(function (c, i) {
      var opened = S.daily.chests.indexOf(i) >= 0, ready = act >= c.need && !opened;
      var b = el('button', 'btn btn-cream btn-round btn-sm dot-host' + (ready ? ' has-dot' : ''), '<svg class="ico"><use href="#i-chest"/></svg>');
      if (opened) b.style.opacity = '.45';
      b.title = c.need + ' 活躍';
      b.addEventListener('click', function () {
        if (opened) return;
        if (!ready) { UI.toast('活躍度達 ' + c.need + ' 可以打開'); return; }
        S.daily.chests.push(i); showRewards('活躍寶箱', grant(c.rewards)); renderQuests(); refreshDots();
      });
      chests.appendChild(b);
    });
    var ql = $('#questList'); ql.innerHTML = '';
    D.DAILY_QUESTS.forEach(function (q) {
      var unlocked = questUnlocked(q);
      var row = questRow(q.name, unlocked ? q.desc : '通關 ' + q.unlock.stageClear + ' 後解鎖', questProg(q), q.target, q.rewards,
        questClaimable(q), S.daily.claimed.indexOf(q.id) >= 0, function () {
          if (!questClaimable(q)) { Sound.play('bump'); return; }
          S.daily.claimed.push(q.id);
          showRewards(q.name, grant(q.rewards)); renderQuests(); refreshDots();
        }, '活躍 +' + q.activity);
      row.querySelector('.q-ico use').setAttribute('href', QUEST_ICON[q.type] || '#i-quest');
      if (!unlocked) row.style.opacity = '.6';
      ql.appendChild(row);
    });
    var dl = $('#stepDailyList'); dl.innerHTML = '';
    D.STEP_MILESTONES.daily.forEach(function (m, i) {
      var claimed = S.steps.claimed.indexOf(i) >= 0;
      var r = questRow(fmt(m.steps) + ' 步', '今天累積走到 ' + fmt(m.steps) + ' 步', S.steps.today, m.steps, m.rewards, S.steps.today >= m.steps, claimed, function () { claimStepMilestone('daily', i); });
      r.querySelector('.q-ico use').setAttribute('href', '#i-steps'); dl.appendChild(r);
    });
    $('#stepLifetime').textContent = fmt(S.steps.lifetime);
    var ll = $('#stepLifetimeList'); ll.innerHTML = '';
    D.STEP_MILESTONES.lifetime.forEach(function (m, i) {
      var claimed = S.steps.lifeClaimed.indexOf(i) >= 0;
      var r = questRow(m.name, '累積走到 ' + fmt(m.steps) + ' 步', S.steps.lifetime, m.steps, m.rewards, S.steps.lifetime >= m.steps, claimed, function () { claimStepMilestone('life', i); });
      r.querySelector('.q-ico use').setAttribute('href', '#i-flag'); ll.appendChild(r);
    });
  }

  /* =================================================================
   * 13. 世界地圖、關卡詳情
   * ================================================================= */
  var mapChapter = 0, mapRatio = null;
  (function probeMapBg() { var im = new Image(); im.onload = function () { mapRatio = im.naturalWidth / im.naturalHeight; if (S) renderMap(); }; im.src = D.ASSETS.backgrounds.map; })();
  function mapPoint(pos) {                         // bg_map.png 百分比 → #mapStage 內的像素座標（背景為 cover 置中）
    var scr = $('#screen-adventure'), stg = $('#mapStage');
    var W = scr.clientWidth, H = scr.clientHeight;
    if (!mapRatio || !W) return null;
    var w = W, h = W / mapRatio; if (h < H) { h = H; w = H * mapRatio; }
    var ox = (W - w) / 2, oy = (H - h) / 2;
    return { x: ox + pos.x / 100 * w - stg.offsetLeft, y: oy + pos.y / 100 * h - stg.offsetTop };
  }
  var stageSel = { id: '1-1', diff: 'normal' };
  function stageRec(id, diff) { var r = S.stages[id]; return (r && r[diff]) || { clear: false, stars: 0, best: 0 }; }
  function stageCleared(id, diff) { return stageRec(id, diff || 'normal').clear; }
  function stageUnlocked(st) { var i = STAGES.indexOf(st); return i === 0 || stageCleared(STAGES[i - 1].id); }
  function chapterAllClear(ci) { return D.CHAPTERS[ci].stages.every(function (s) { return stageCleared(s.id); }); }
  function hardUnlocked(st) { return chapterAllClear(st.ci); }
  function renderMap() {
    var ch = D.CHAPTERS[mapChapter];
    $('#chapterTitle').innerHTML = ch.name + '<small id="chapterSub">第 ' + (mapChapter + 1) + ' 章</small>';
    $('#btnChapterPrev').disabled = mapChapter === 0;
    $('#btnChapterNext').disabled = mapChapter === D.CHAPTERS.length - 1;
    var nodes = $('#mapNodes'); nodes.innerHTML = '';
    var stars = 0, lastDone = -1;
    var stList = STAGES.filter(function (s) { return s.ci === mapChapter; });
    var current = stList.find(function (s) { return stageUnlocked(s) && !stageCleared(s.id); });
    stList.forEach(function (st, i) {
      var n = UI.tpl('stage-node'), rec = stageRec(st.id, 'normal'), hrec = stageRec(st.id, 'hard');
      n.style.setProperty('--x', st.pos.x); n.style.setProperty('--y', st.pos.y);
      var mp = mapPoint(st.pos); if (mp) { n.style.left = mp.x + 'px'; n.style.top = mp.y + 'px'; }
      n.querySelector('.node-name').textContent = st.name + (hrec.clear ? ' ✦' : '');
      n.querySelector('.stars').innerHTML = starsHTML(rec.stars);
      stars += rec.stars;
      if (rec.clear) { n.classList.add('is-cleared'); lastDone = i; }
      if (st.si === 4) n.classList.add('is-boss');
      if (!stageUnlocked(st)) { n.classList.add('is-locked'); n.querySelector('.node-num').innerHTML = '<svg class="ico"><use href="#i-lock"/></svg>'; }
      else n.querySelector('.node-num').textContent = st.id;
      if (current === st) n.classList.add('is-current');
      n.addEventListener('click', function () {
        if (!stageUnlocked(st)) { Sound.play('bump'); UI.toast('先通過前一關才能前往'); return; }
        openStage(st.id);
      });
      nodes.appendChild(n);
    });
    var pts = stList.map(function (s) { return s.pos.x + ' ' + s.pos.y; });
    var done = stList.slice(0, lastDone + 2).map(function (s) { return s.pos.x + ' ' + s.pos.y; });
    $('#mapPath').innerHTML = '<path class="route" d="M' + pts.join(' L') + '" vector-effect="non-scaling-stroke"/>' +
      (done.length > 1 ? '<path class="route-done" d="M' + done.join(' L') + '" vector-effect="non-scaling-stroke"/>' : '');
    $('#mapPath').classList.toggle('has-bg', !!mapRatio);
    $('#chapterStarCount').textContent = stars + ' / ' + stList.length * 3;
    var eb = $('#btnEndless'); eb.classList.toggle('is-disabled', !stageCleared(D.ENDLESS_MODE.unlock.stageClear));
    eb.style.pointerEvents = 'auto';
    eb.innerHTML = '<svg class="ico"><use href="#i-infinity"/></svg>無盡晨霧' + (S.endless.best ? '<span class="sub">最佳 ' + S.endless.best + ' 波</span>' : '');
  }
  function openStage(id) {
    var st = STAGE(id);
    stageSel.id = id;
    if (stageSel.diff === 'hard' && !hardUnlocked(st)) stageSel.diff = 'normal';
    renderStage(); UI.openModal('modalStage');
  }
  function renderStage() {
    var st = STAGE(stageSel.id), diff = stageSel.diff, rec = stageRec(st.id, diff), mul = D.DIFFICULTY[diff].rewardMul;
    $('#stageTitle').textContent = st.id + ' ' + st.name;
    var seg = $('#stageDifficulty');
    $$('button', seg).forEach(function (b) { b.classList.toggle('is-active', b.dataset.value === diff); });
    seg.classList.toggle('is-hard-mode', diff === 'hard');
    seg.querySelector('[data-value="hard"]').textContent = hardUnlocked(st) ? '困難' : '困難（未解鎖）';
    $('#stageRecLv').textContent = st.recommendLv + (diff === 'hard' ? 6 : 0);
    $('#stageWaveCount').textContent = st.waves.length;
    $('#stageCostCap').textContent = st.costCap;
    $('#stageTip').textContent = st.tip;
    var cnt = {};
    st.waves.forEach(function (w) { w.spawns.forEach(function (s) { cnt[s.e] = (cnt[s.e] || 0) + s.n; }); });
    var box = $('#stageEnemies'); box.innerHTML = '';
    Object.keys(cnt).forEach(function (eid) {
      var E = ENEMIES[eid], c = el('div', 'enemy-chip' + (E.isBoss ? ' is-boss' : ''), '<div class="art"></div><span class="ec-n">×' + cnt[eid] + '</span>');
      UI.setArt(c.querySelector('.art'), D.ASSETS.enemies[eid], E.fallback);
      c.title = E.name; box.appendChild(c);
    });
    $$('#stageStarConds li').forEach(function (li, i) { li.classList.toggle('is-done', rec.stars > i); });
    var list = [];
    if (!rec.clear) grantPreview(st.rewards.first, mul, '首通', list);
    if (rec.stars < 3) grantPreview(st.rewards.threeStar, mul, '三星', list);
    grantPreview({ coins: st.rewards.clear.coins }, mul, '通關', list);
    list.push({ k: 'exp', n: st.rewards.clear.exp * mul, tag: '每隻' });
    renderRewards($('#stageRewards'), list);
    var sw = $('#btnSweep'); sw.hidden = rec.stars < 3;
    sw.innerHTML = '掃蕩 <span class="sub"><svg class="ico" style="font-size:14px"><use href="#i-dew"/></svg> ' + D.SWEEP.costDew + '</span>';
    var bf = D.BATTLEFIELDS[D.CHAPTERS[st.ci].battlefield];
    $('#stageTip').textContent = st.tip + (bf.weather ? '（' + bf.weather.name + '：' + bf.weather.desc + '）' : '');
  }
  function grantPreview(r, mul, tag, list) {
    if (!r) return;
    if (r.dew) list.push({ k: 'dew', n: Math.round(r.dew * mul), tag: tag });
    if (r.coins) list.push({ k: 'coins', n: Math.round(r.coins * mul), tag: tag });
    if (r.summonTicket) list.push({ k: 'ticket', n: r.summonTicket, tag: tag });
    if (r.mats) Object.keys(r.mats).forEach(function (m) { list.push({ k: m, n: Math.max(1, Math.round(r.mats[m] * mul)), tag: tag }); });
  }

  /* =================================================================
   * 14. 出戰選擇（最多 4 隻）
   * ================================================================= */
  var teamCtx = null, teamPick = [];
  function openTeam(ctx) {
    teamCtx = ctx;
    teamPick = S.team.filter(function (id) { return S.pets[id]; }).slice(0, D.BATTLE_RULES.teamSize);
    if (!teamPick.length) teamPick = Object.keys(S.pets).slice(0, D.BATTLE_RULES.teamSize);
    var info = ctx.mode === 'endless' ? '無盡晨霧・撐越久獎勵越多' : (function () { var st = STAGE(ctx.id); return st.id + ' ' + st.name + '・' + D.DIFFICULTY[ctx.diff].name + '・推薦 Lv.' + (st.recommendLv + (ctx.diff === 'hard' ? 6 : 0)); })();
    $('#teamStageInfo').textContent = info + '（最多 ' + D.BATTLE_RULES.teamSize + ' 隻）';
    renderTeam(); UI.openModal('modalTeam');
  }
  function renderTeam() {
    var slots = $('#teamSlots'); slots.innerHTML = '';
    for (var i = 0; i < D.BATTLE_RULES.teamSize; i++) {
      var id = teamPick[i], s = el('div', 'team-slot' + (id ? ' is-filled' : ''), id ? '<div class="art"></div><span class="ts-cost">' + petStats(id).cost + '</span>' : '空位');
      if (id) UI.setArt(s.querySelector('.art'), D.ASSETS.pets[id], PETS[id].fallback);
      slots.appendChild(s);
    }
    var pool = $('#teamPool'); pool.innerHTML = '';
    Object.keys(S.pets).forEach(function (id) {
      var c = petCard(id), k = teamPick.indexOf(id);
      c.appendChild(el('span', 'pick-no', k >= 0 ? String(k + 1) : ''));
      if (k >= 0) c.classList.add('is-picked');
      c.addEventListener('click', function () {
        var j = teamPick.indexOf(id);
        if (j >= 0) teamPick.splice(j, 1);
        else if (teamPick.length >= D.BATTLE_RULES.teamSize) { UI.toast('最多帶 ' + D.BATTLE_RULES.teamSize + ' 隻喔'); Sound.play('bump'); return; }
        else teamPick.push(id);
        renderTeam();
      });
      pool.appendChild(c);
    });
    $('#btnTeamGo').disabled = !teamPick.length;
  }

  /* =================================================================
   * 15. 塔防戰鬥（各章地形、多路線合流、泉水格、天氣、新機制怪、AUTO、祝福、結算）
   * ================================================================= */
  var BR = D.BATTLE_RULES;
  var B = { active: false };
  var bgRatio = {};
  Object.keys(D.BATTLEFIELDS).forEach(function (k) {
    var key = D.BATTLEFIELDS[k].bg, im = new Image();
    im.onload = function () { bgRatio[key] = im.naturalWidth / im.naturalHeight; if (B.active && B.BF && B.BF.bg === key) layoutField(); };
    im.src = D.ASSETS.backgrounds[key];
  });
  var uidSeq = 1;

  function layoutField() {
    var wrap = $('#bfWrap'), W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    var ratio = bgRatio[B.BF.bg] || 9 / 16;
    var w = W, h = W / ratio; if (h > H) { h = H; w = H * ratio; }
    var f = $('#bfield');
    f.style.setProperty('--bf-w', w + 'px'); f.style.setProperty('--bf-h', h + 'px'); f.style.setProperty('--bw', w + 'px');
    $('.bf-img', f).style.backgroundImage = 'url("' + D.ASSETS.backgrounds[B.BF.bg] + '")';
    B.W = w; B.H = h;
    B.paths = B.BF.paths.map(function (path) {
      var pts = path.map(function (p) { return [p[0] / 100 * w, p[1] / 100 * h]; }), cum = [0];
      for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts: pts, cum: cum, total: cum[cum.length - 1] };
    });
    drawBattleFallback();
    positionSpots();
  }
  function pathAt(pi, prog) {                      // 第 pi 條路徑，prog 0~1 → 像素座標與方向
    var P = B.paths[pi], s = clamp(prog, 0, 1) * P.total, i = 1;
    while (i < P.cum.length - 1 && P.cum[i] < s) i++;
    var a = P.pts[i - 1], b = P.pts[i], seg = P.cum[i] - P.cum[i - 1] || 1, t = (s - P.cum[i - 1]) / seg;
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * t, y: a[1] + dy * t, nx: -dy / len, ny: dx / len, dx: dx };
  }
  function projectOnPath(pi, x, y) {               // 點投影到路徑：回傳最近距離與 prog
    var P = B.paths[pi], best = { d: Infinity, prog: 0 };
    for (var i = 1; i < P.pts.length; i++) {
      var a = P.pts[i - 1], b = P.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      var t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1), px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { d: d, prog: (P.cum[i - 1] + Math.sqrt(L2) * t) / P.total };
    }
    return best;
  }
  function smoothPathD(pts) {
    var d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6) + ',' + (p2[0] - (p3[0] - p1[0]) / 6) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6) + ',' + p2[0] + ' ' + p2[1];
    }
    return d;
  }
  function drawBattleFallback() {                  // 背景圖未放入時的手繪戰場（與路徑座標完全對齊）
    var W = B.W, H = B.H, svg = $('#bfFallback'), tile = W * 0.17, h = '';
    h += '<defs><linearGradient id="bfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9CC9A"/><stop offset="1" stop-color="#9DB582"/></linearGradient></defs>';
    h += '<rect width="' + W + '" height="' + H + '" fill="url(#bfg)"/>';
    B.paths.forEach(function (P) {
      var d = smoothPathD(P.pts);
      h += '<path d="' + d + '" fill="none" stroke="#B49B6E" stroke-width="' + W * 0.13 + '" stroke-linecap="round" stroke-linejoin="round"/>';
      h += '<path d="' + d + '" fill="none" stroke="#DCC79C" stroke-width="' + W * 0.11 + '" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    B.BF.supportSpots.forEach(function (s) {
      var x = s.x / 100 * W - tile / 2, y = s.y / 100 * H - tile / 2;
      h += '<rect x="' + x + '" y="' + y + '" width="' + tile + '" height="' + tile + '" rx="' + tile * 0.26 + '" fill="#C2D6A2" stroke="#7C9767" stroke-width="2.5"/>';
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = h;
  }
  function buildSpots() {
    var box = $('#bfSpots'); box.innerHTML = ''; B.spots = [];
    var pad = B.BF.paintedTiles ? '' : ' is-pad';
    B.BF.guardianSpots.forEach(function (g) { B.spots.push({ id: g.id, type: 'guard', xp: g.x, yp: g.y, el: el('div', 'bf-spot is-guard'), unit: null }); });
    B.BF.supportSpots.forEach(function (s) { B.spots.push({ id: s.id, type: 'support', xp: s.x, yp: s.y, el: el('div', 'bf-spot is-support' + pad), unit: null }); });
    (B.BF.springSpots || []).forEach(function (s) { B.spots.push({ id: s.id, type: 'spring', xp: s.x, yp: s.y, heal: s.healPctPerSec, el: el('div', 'bf-spot is-spring'), unit: null }); });
    B.spots.forEach(function (sp) { box.appendChild(sp.el); sp.el.addEventListener('click', function (ev) { ev.stopPropagation(); onSpotTap(sp); }); });
    var wbox = $('#bfWeather'); if (wbox) wbox.remove();
    if (B.BF.weather) {
      var wd = el('div', 'bf-weather'); wd.id = 'bfWeather';
      for (var i = 0; i < 9; i++) { var z = el('i'); z.style.left = rand(5, 95) + '%'; z.style.top = rand(5, 85) + '%'; z.style.setProperty('--d', rand(0, 2.6) + 's'); wd.appendChild(z); }
      $('#bfield').appendChild(wd);
    }
  }
  function positionSpots() {
    if (!B.spots) return;
    var snap = BR.guardSnapPct / 100 * B.W;
    B.spots.forEach(function (sp) {
      sp.el.style.left = sp.xp + '%'; sp.el.style.top = sp.yp + '%';
      sp.x = sp.xp / 100 * B.W; sp.y = sp.yp / 100 * B.H;
      sp.progs = {};
      if (sp.type !== 'support') B.paths.forEach(function (P, pi) { var pr = projectOnPath(pi, sp.x, sp.y); if (pr.d <= snap * (sp.type === 'spring' ? 2 : 1)) sp.progs[pi] = pr.prog; });
      if (sp.unit) { sp.unit.x = sp.x; sp.unit.y = sp.y; }
    });
  }
  function spotFits(sp, role) {
    if (sp.unit) return false;
    if (sp.type === 'spring') return true;
    return (role === 'guardian') === (sp.type === 'guard');
  }

  /* ---------- 開戰 ---------- */
  function startBattle(ctx) {
    UI.closeAllModals();
    var bfKey = ctx.mode === 'endless' ? D.ENDLESS_MODE.battlefield : D.CHAPTERS[STAGE(ctx.id).ci].battlefield;
    B = { active: true, ctx: ctx, mode: ctx.mode, BF: D.BATTLEFIELDS[bfKey], t: 0, lastTs: 0, paused: false, speed: S.settings.speed || 1,
      lives: ctx.mode === 'endless' ? D.ENDLESS_MODE.lives : BR.lives, livesMax: ctx.mode === 'endless' ? D.ENDLESS_MODE.lives : BR.lives,
      energy: BR.energy.start, pets: [], enemies: [], projs: [], selected: null, totalCost: 0, loot: { coins: 0, mats: {} },
      waveShown: 0, kills: 0, team: S.team.filter(function (id) { return S.pets[id]; }).slice(0, BR.teamSize), cards: {}, uiT: 0, hintHidden: false,
      laneFlip: 0, blessing: S.blessing || null };
    if (B.blessing) { S.blessing = null; markDirty(); if (B.blessing.energy) B.energy += B.blessing.energy; }
    if (ctx.mode === 'stage') {
      B.stage = STAGE(ctx.id); B.diff = ctx.diff;
      B.queue = buildSchedule(B.stage); B.waveTotal = B.stage.waves.length;
    } else { B.diff = 'normal'; B.queue = []; B.waveTotal = 0; B.endlessWave = 0; B.nextWaveT = 4; }
    B.team.forEach(function (id) { B.cards[id] = { cdUntil: 0, deployed: null }; });
    $('#battleUnits').innerHTML = ''; $('#battleFx').innerHTML = '';
    $('#speedLabel').textContent = B.speed + '×';
    renderAutoBtn();
    var bl = $('#battleBlessing'); bl.hidden = !B.blessing; if (B.blessing) bl.textContent = '✦ ' + B.blessing.name;
    $('#dockHint').style.display = '';
    $('#dockHint').textContent = '點選下方精靈，再點發光的位置部署';
    UI.openOverlay('screen-battle');
    Camp.stop();
    requestAnimationFrame(function () {
      layoutField(); buildSpots(); positionSpots(); renderDeployBar(); renderBattleHUD();
      if (B.BF.weather) setTimeout(function () { if (B.active) banner(B.BF.weather.name + '：' + B.BF.weather.desc.split('，').pop(), false); }, 300);
      B.lastTs = performance.now();
      requestAnimationFrame(battleLoop);
    });
  }
  function renderAutoBtn() { var b = $('#btnAuto'); b.classList.toggle('is-on', !!S.settings.auto); b.setAttribute('aria-pressed', S.settings.auto ? 'true' : 'false'); }
  function buildSchedule(st) {
    var q = [], lastSpawn = 0;
    st.waves.forEach(function (w, wi) {
      var start = wi === 0 ? w.delay : lastSpawn + w.delay, maxT = start;
      w.spawns.forEach(function (sp) {
        for (var i = 0; i < sp.n; i++) {
          var tt = start + (sp.at || 0) + sp.gap * i;
          q.push({ t: tt, wave: wi + 1, e: sp.e, lane: sp.lane == null ? 1 : sp.lane, elite: !!sp.elite, hpMul: sp.hpMul || 1 });
          maxT = Math.max(maxT, tt);
        }
      });
      lastSpawn = maxT;
    });
    return q.sort(function (a, b) { return a.t - b.t; });
  }
  function queueEndlessWave() {
    var EM = D.ENDLESS_MODE, w = ++B.endlessWave, C = EM.composition;
    var n = Math.min(C.cap, C.base + Math.floor(w / 3));
    var pool = C.weights.filter(function (x) { return w >= x.fromWave; }).map(function (x) { return [x.e, x.weight]; });
    var t0 = B.t, items = [];
    for (var i = 0; i < n; i++) items.push({ t: t0 + i * 1.3, wave: w, e: weighted(pool), lane: i % 3, elite: false, hpMul: 1 });
    if (w % EM.eliteEvery === 0) items.push({ t: t0 + n * 1.3, wave: w, e: EM.eliteEnemy, lane: 1, elite: true, hpMul: 1 });
    if (w % EM.bossEvery === 0) {
      var k = w / EM.bossEvery, hm = Math.min(EM.bossHpMul.max, EM.bossHpMul.start + EM.bossHpMul.step * (k - 1));
      items.push({ t: t0 + n * 1.3 + 2, wave: w, e: EM.bossEnemies[(k - 1) % EM.bossEnemies.length], lane: 1, elite: false, hpMul: hm });
    }
    B.queue = B.queue.concat(items);
    B.nextWaveT = items[items.length - 1].t + EM.waveInterval;
  }
  function enemyMul() {
    if (B.mode === 'endless') {
      var sc = D.ENDLESS_MODE.scaling, w = Math.max(1, B.endlessWave);
      return { hp: sc.statBase * (1 + sc.hpPerWave * (w - 1)), atk: sc.statBase * (1 + sc.atkPerWave * (w - 1)), def: sc.statBase * (1 + sc.defPerWave * (w - 1)), spd: 1 };
    }
    var dm = D.DIFFICULTY[B.diff], m = B.stage.statMul;
    return { hp: m * dm.hpMul, atk: m * dm.atkMul, def: m * dm.defMul, spd: dm.speedMul };
  }
  function lanePath(lane) {
    if (B.paths.length < 2) return 0;
    if (lane === 0) return 0;
    if (lane === 2) return 1;
    B.laneFlip ^= 1; return B.laneFlip;
  }
  function spawnEnemy(item, from) {
    var E = ENEMIES[item.e], M = enemyMul(), EL = item.elite ? D.ELITE_MODIFIER : null;
    var hp = E.stats.hp * M.hp * (EL ? EL.hpMul : 1) * item.hpMul;
    var pi = from ? from.path : lanePath(item.lane);
    var en = {
      uid: uidSeq++, id: item.e, E: E, side: 'enemy', el: E.element, elite: item.elite, boss: E.isBoss, flying: !!E.flying, child: !!item.child,
      hp: hp, maxHp: hp, atk: E.stats.atk * M.atk * (EL ? EL.atkMul : 1) * (item.atkMul || 1), def: E.stats.def * M.def * (EL ? EL.defMul : 1),
      speed: E.stats.speed * M.spd, atkInt: E.stats.atkInterval, atkT: E.stats.atkInterval * 0.5,
      path: pi, prog: from ? from.prog : 0,
      lane: B.paths.length > 1 ? rand(-0.012, 0.012) : (item.lane - 1) * BR.laneOffsetPct / 100 + rand(-0.008, 0.008),
      blockedBy: null, stunT: 0, slowT: 0, slowPct: 0, defDownT: 0, defDownPct: 0,
      shockT: E.special && E.special.type === 'shockwave' ? E.special.interval * 0.6 : 0,
      sumT: E.special && E.special.type === 'summon' ? E.special.interval * 0.7 : 0,
      shield: E.special && E.special.type === 'shield' ? hp * E.special.shieldPct / 100 : 0,
      dotAcc: 0, dotShow: 0, scale: M.atk, x: 0, y: 0, coinsOverride: item.coins
    };
    if (from) en.lane += rand(-0.03, 0.03);
    var size = en.boss ? 0.27 : 0.135 * (EL ? 1.22 : 1) * (item.size || 1);
    en.dom = makeUnitDom(D.ASSETS.enemies[en.id], E.fallback, size, 'enemy' + (en.elite ? ' elite' : '') + (en.boss ? ' boss' : '') + (en.flying ? ' flying' : '') + (en.shield ? ' has-shield' : '') + ' is-spawn');
    B.enemies.push(en);
    var p = enemyPos(en); en.x = p.x; en.y = p.y;
    if (en.boss && !from) { banner(E.name + ' 出現！', true); Sound.play('shock'); }
    return en;
  }
  function makeUnitDom(src, fb, sizePct, cls, shiny) {
    var u = UI.tpl('unit'); u.className = 'unit ' + cls;
    u.style.setProperty('--w', (B.W * sizePct) + 'px');
    var a = u.querySelector('.art'); UI.setArt(a, src, fb); if (shiny) a.classList.add('is-shiny');
    $('#battleUnits').appendChild(u);
    setTimeout(function () { u.classList.remove('is-spawn'); }, 500);
    return u;
  }

  /* ---------- 部署 ---------- */
  function renderDeployBar() {
    var bar = $('#deployBar'); bar.innerHTML = '';
    B.team.forEach(function (id) {
      var P = PETS[id], c = UI.tpl('deploy-card'), st = petStats(id);
      c.dataset.el = P.element; c.dataset.id = id;
      c.querySelector('.dc-cost').textContent = st.cost;
      c.querySelector('.dc-role').textContent = D.ROLES[P.role].name;
      var a = c.querySelector('.art'); UI.setArt(a, petArt(id), P.fallback); a.classList.toggle('is-shiny', isShiny(id));
      c.addEventListener('click', function (ev) { ev.stopPropagation(); selectCard(id); });
      B.cards[id].dom = c; B.cards[id].cost = st.cost;
      bar.appendChild(c);
    });
  }
  function selectCard(id) {
    var card = B.cards[id];
    closeUnitActions();
    if (card.deployed) { UI.toast(petName(id) + ' 已經在場上了'); return; }
    if (B.t < card.cdUntil) { UI.toast('還在休息，' + Math.ceil(card.cdUntil - B.t) + ' 秒後可再上場'); Sound.play('bump'); return; }
    B.selected = B.selected === id ? null : id;
    Sound.play('click');
    updatePlacing();
  }
  function updatePlacing() {
    var f = $('#bfield');
    f.classList.toggle('is-placing', !!B.selected);
    var role = B.selected ? PETS[B.selected].role : null;
    B.spots.forEach(function (sp) {
      sp.el.classList.toggle('is-avail', !!(role && spotFits(sp, role)));
      sp.el.classList.toggle('is-used', !!sp.unit && sp.type !== 'spring');
    });
    $$('.deploy-card', $('#deployBar')).forEach(function (c) { c.classList.toggle('is-selected', c.dataset.id === B.selected); });
    var hasSpring = (B.BF.springSpots || []).length > 0;
    $('#dockHint').textContent = B.selected ? (role === 'guardian' ? '守護型：點路徑上的圓圈' : '遠程／療癒：點路旁的草地') + (hasSpring ? '（泉水格誰都能站）' : '') : '點選下方精靈，再點發光的位置部署';
  }
  function onSpotTap(sp) {
    if (!B.selected) return;
    var id = B.selected;
    if (!spotFits(sp, PETS[id].role)) { Sound.play('bump'); return; }
    var cost = B.cards[id].cost;
    if (B.energy < cost) { UI.toast('能量不足（需要 ' + cost + '）'); Sound.play('bump'); return; }
    deployPet(id, sp);
  }
  function deployPet(id, sp) {
    var P = PETS[id], st = petStats(id), sk = petSkill(id), br = S.pets[id].branch ? branchOf(id, S.pets[id].branch) : null;
    if (B.blessing && B.blessing.atkPct) st.atk = Math.round(st.atk * (1 + B.blessing.atkPct / 100));
    B.energy -= B.cards[id].cost; B.totalCost += B.cards[id].cost;
    var u = {
      uid: uidSeq++, id: id, P: P, side: 'pet', role: P.role, el: P.element, st: st, skill: sk, passive: br ? br.passive : null, trait: P.trait || null,
      hp: st.hp, maxHp: st.hp, atkT: 0.3, sp: Math.max(0, sk.cd - sk.initialCd), spot: sp, x: sp.x, y: sp.y,
      buffs: [], blocking: [], stunT: 0, cost: B.cards[id].cost, springAcc: 0
    };
    u.dom = makeUnitDom(petArt(id), P.fallback, 0.15, 'pet is-spawn' + (sp.type === 'spring' ? ' on-spring' : ''), isShiny(id));
    u.dom.addEventListener('click', function (ev) { ev.stopPropagation(); onPetTap(u); });
    sp.unit = u; B.cards[id].deployed = u; B.pets.push(u);
    B.selected = null; updatePlacing();
    Sound.play('deploy'); fxRing(u.x, u.y, B.W * 0.16, true);
    if (!B.hintHidden) { B.hintHidden = true; setTimeout(function () { if (B.active) $('#dockHint').textContent = S.settings.auto ? 'AUTO 開啟中：能量滿會自動施放大招' : '能量條滿了，點精靈施放大招！'; }, 600); setTimeout(function () { if (B.active) $('#dockHint').style.display = 'none'; }, 6000); }
  }
  function onPetTap(u) {
    if (u.dead) return;
    if (B.selected) { B.selected = null; updatePlacing(); }
    if (u.sp >= u.skill.cd) { castSkill(u); closeUnitActions(); return; }
    toggleUnitActions(u);
  }
  function toggleUnitActions(u) {
    var open = $('.unit-actions', $('#battleFx'));
    var was = open && open.dataset.uid === String(u.uid);
    closeUnitActions(); if (was) return;
    var box = el('div', 'unit-actions');
    box.dataset.uid = u.uid;
    box.style.left = u.x + 'px'; box.style.top = (u.y - B.W * 0.13) + 'px';
    box.innerHTML = '<span class="chip">' + u.skill.name + ' ' + Math.floor(u.sp / u.skill.cd * 100) + '%</span>';
    var r = el('button', 'btn btn-rose btn-sm', '撤退');
    r.addEventListener('click', function (ev) { ev.stopPropagation(); retreat(u); closeUnitActions(); });
    box.appendChild(r);
    $('#battleFx').appendChild(box);
    showRange(u);
  }
  function closeUnitActions() { $$('.unit-actions, .bf-range', $('#bfield')).forEach(function (e) { e.remove(); }); }
  function showRange(u) {
    var r = unitRadius(u); if (!r) return;
    var c = el('div', 'bf-range' + (u.role === 'healer' ? ' is-heal' : ''));
    c.style.left = u.x + 'px'; c.style.top = (u.y - B.W * 0.04) + 'px'; c.style.width = c.style.height = (r * 2) + 'px';
    $('#bfSpots').appendChild(c);
  }
  function retreat(u) {
    if (u.dead) return;
    var refund = Math.floor(u.cost * D.ECONOMY.retreatRefundPct / 100);
    B.energy = Math.min(BR.energy.max, B.energy + refund);
    removePet(u, BR.redeployCooldown);
    floatText(u.x, u.y - B.W * 0.12, '+' + refund + ' 能量', 'is-text');
  }
  function removePet(u, cd) {
    u.dead = true;
    u.blocking.forEach(function (e) { e.blockedBy = null; });
    u.blocking = [];
    u.spot.unit = null;
    B.cards[u.id].deployed = null; B.cards[u.id].cdUntil = B.t + cd;
    B.pets = B.pets.filter(function (p) { return p !== u; });
    u.dom.classList.add('is-dying'); setTimeout(function () { u.dom.remove(); }, 400);
    updatePlacing();
  }

  /* ---------- 數值輔助 ---------- */
  function unitRadius(u) { var k = BR.rangeUnitPct[u.role] || 12; return u.st.range * k / 100 * B.W; }
  function buffSum(u, type, key) { return u.buffs.reduce(function (a, b) { return a + (b.type === type ? (b[key] || 0) : 0); }, 0); }
  function auraSum(stat) { return B.pets.reduce(function (a, p) { return a + (p.passive && p.passive.type === 'auraBuff' && p.passive.stat === stat ? p.passive.pct : 0); }, 0); }
  function effDef(u) { return u.st.def * (1 + (buffSum(u, 'buff', 'pct') + auraSum('def')) / 100); }
  function effBlock(u) { return u.role === 'guardian' ? u.st.block + buffSum(u, 'block', 'add') : 0; }
  function effAspdMul(u) {
    var m = u.buffs.reduce(function (a, b) { return b.type === 'aspd' ? a * b.mul : a; }, 1);
    var w = B.BF.weather; if (w && w.element === u.el) m *= 1 + w.aspdPct / 100;
    return m;
  }
  function dmgReducePct(u) {
    return u.buffs.reduce(function (a, b) { return b.type === 'dmgReduce' ? Math.max(a, b.pct) : a; }, 0) + (u.st.dmgDown || 0) + (B.blessing && B.blessing.dmgDownPct ? B.blessing.dmgDownPct : 0);
  }
  function enemyDef(en) { return en.def * (1 - (en.defDownT > 0 ? en.defDownPct : 0) / 100); }
  function enemyPos(en) { var p = pathAt(en.path, en.prog); return { x: p.x + p.nx * en.lane * B.W, y: p.y + p.ny * en.lane * B.W, dx: p.dx }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function enemiesNear(u, r, groundOnly) { return B.enemies.filter(function (e) { return !e.dead && (!groundOnly || !e.flying) && dist(e, u) <= r; }); }
  function calcDmg(atk, def, aEl, dEl, crit, critDmg, mul) {
    var base = Math.max(atk * BR.damage.minRatio, atk - def) * (mul || 1), em = elemMul(aEl, dEl);
    base *= em;
    var isCrit = Math.random() * 100 < crit;
    if (isCrit) base *= critDmg / 100;
    return { dmg: Math.max(1, Math.round(base)), crit: isCrit, em: em };
  }
  function applyTrait(u, en) {
    var t = u.trait; if (!t || en.dead) return;
    if (t.type === 'onHitSlow') { en.slowT = Math.max(en.slowT, t.sec); en.slowPct = Math.max(en.slowPct, t.pct); }
    if (t.type === 'onHitDefDown') { en.defDownT = Math.max(en.defDownT, t.sec); en.defDownPct = Math.max(en.defDownPct, t.pct); }
  }

  /* ---------- 傷害與治療 ---------- */
  function hitEnemy(en, r, src) {
    if (en.dead) return;
    var dmg = r.dmg, cls = (r.crit ? 'is-crit ' : '') + (r.em > 1 ? 'is-strong' : r.em < 1 ? 'is-weak' : '');
    if (en.shield > 0) {                              // 護盾岩龜：護盾吸收並大幅減傷
      en.shield -= dmg;
      dmg = Math.max(1, Math.round(dmg * (1 - en.E.special.reducePct / 100)));
      cls = 'is-weak';
      if (en.shield <= 0) { en.dom.classList.remove('has-shield'); floatText(en.x, en.y - B.W * 0.16, '護盾破裂！', 'is-text'); Sound.play('crack'); }
    }
    en.hp -= dmg;
    floatNum(en.x, en.y - B.W * 0.09, dmg, cls);
    fxHit(en.x, en.y - B.W * 0.05);
    pulse(en.dom, 'is-hit');
    if (en.hp <= 0) killEnemy(en, src);
  }
  function killEnemy(en, src) {
    en.dead = true; B.kills++;
    if (en.blockedBy) { en.blockedBy.blocking = en.blockedBy.blocking.filter(function (x) { return x !== en; }); en.blockedBy = null; }
    var EL = en.elite ? D.ELITE_MODIFIER : null, sp = en.E.special;
    var coins = en.child ? (sp && sp.childCoins) || 1 : Math.round(en.E.rewards.coins * (EL ? EL.coinsMul : 1));
    B.loot.coins += coins;
    if (!en.child) en.E.rewards.drops.forEach(function (d) {
      if (Math.random() * 100 < d.chance * (EL ? EL.dropChanceMul : 1)) B.loot.mats[d.id] = (B.loot.mats[d.id] || 0) + d.n;
    });
    floatText(en.x, en.y - B.W * 0.14, '+' + coins, 'is-text');
    if (src && src.passive && src.passive.energyOnKill) B.energy = Math.min(BR.energy.max, B.energy + src.passive.energyOnKill);
    if (sp && sp.type === 'split' && !en.child) {      // 分裂果凍：分成 2 隻小果凍
      for (var i = 0; i < sp.count; i++) {
        var c = spawnEnemy({ e: en.id, lane: 1, elite: false, hpMul: sp.childHpPct / 100 * (en.maxHp / (en.E.stats.hp * enemyMul().hp)), atkMul: sp.childAtkPct / 100, child: true, size: sp.childSize }, { path: en.path, prog: Math.max(0, en.prog - 0.01 * i) });
        c.prog = Math.max(0, en.prog - 0.012 * i);
      }
      floatText(en.x, en.y - B.W * 0.2, '分裂！', 'is-text'); Sound.play('pop');
    }
    en.dom.classList.add('is-dying'); setTimeout(function () { en.dom.remove(); }, 420);
  }
  function hitPet(u, raw, opt) {
    if (u.dead) return;
    var dmg = Math.max(1, Math.round(raw * (1 - Math.min(80, dmgReducePct(u)) / 100)));
    u.hp -= dmg;
    if (!opt || !opt.quiet) { floatNum(u.x, u.y - B.W * 0.12, dmg, opt && opt.cls ? opt.cls : 'is-enemy-hit'); pulse(u.dom, 'is-hit'); }
    if (u.hp <= 0) {
      floatText(u.x, u.y - B.W * 0.16, '累倒了', 'is-text');
      Sound.play('lose');
      removePet(u, BR.downedRedeployCooldown);
    }
  }
  function healPet(u, amt, quiet) {
    if (u.dead) return;
    var real = Math.min(Math.round(amt), u.maxHp - u.hp);
    if (real <= 0) return;
    u.hp += real;
    if (!quiet) { floatNum(u.x, u.y - B.W * 0.12, real, 'is-heal'); fxHit(u.x, u.y - B.W * 0.05, true); }
  }

  /* ---------- 主動技 ---------- */
  function castSkill(u) {
    var sk = u.skill;
    u.sp = 0;
    Sound.play('skill'); questAdd('skillCast', 1);
    pulse(u.dom, 'is-casting', 600);
    var fl = el('div', 'fx-skill-flash'); fl.style.setProperty('--fx', (u.x / B.W * 100) + '%'); fl.style.setProperty('--fy', (u.y / B.H * 100) + '%');
    $('#bfield').appendChild(fl); setTimeout(function () { fl.remove(); }, 600);
    floatText(u.x, u.y - B.W * 0.17, sk.name, 'is-text');
    var radius = unitRadius(u) * (sk.target === 'enemiesInRange3Lanes' ? 1.25 : 1);
    var foes = sk.target === 'blocked' ? (u.blocking.length ? u.blocking.slice() : enemiesNear(u, unitRadius(u), true)) : enemiesNear(u, radius, u.role === 'guardian');
    var allies = sk.target === 'allAllies' ? B.pets.slice() : B.pets.filter(function (p) { return dist(p, u) <= unitRadius(u); });
    fxRing(u.x, u.y, radius * 2, true);
    sk.effects.forEach(function (e) {
      var dur = e.sec || sk.duration || 0;
      switch (e.type) {
        case 'buff': u.buffs.push({ type: 'buff', stat: e.stat, pct: e.pct, t: sk.duration }); break;
        case 'block': u.buffs.push({ type: 'block', add: e.add, t: sk.duration }); break;
        case 'aspd': u.buffs.push({ type: 'aspd', mul: e.mul, t: sk.duration }); break;
        case 'energy': B.energy = Math.min(BR.energy.max, B.energy + e.add); floatText(u.x, u.y - B.W * 0.22, '+' + e.add + ' 能量', 'is-text'); break;
        case 'heal':
          (e.target === 'self' ? [u] : e.target === 'allAllies' ? B.pets.slice() : allies).forEach(function (p) {
            healPet(p, e.maxHpPct ? p.maxHp * e.maxHpPct / 100 : u.st.atk * e.atkPct / 100 * (1 + u.st.healPct / 100));
          });
          Sound.play('heal'); break;
        case 'hot': (sk.target === 'allAllies' ? B.pets : allies).forEach(function (p) { p.buffs.push({ type: 'hot', pct: e.maxHpPct, t: dur, acc: 0 }); }); break;
        case 'dmgReduce': (sk.target === 'allAllies' ? B.pets : allies).forEach(function (p) { p.buffs.push({ type: 'dmgReduce', pct: e.pct, t: sk.duration }); }); break;
        case 'damage': foes.forEach(function (en) { hitEnemy(en, calcDmg(u.st.atk * e.atkPct / 100, enemyDef(en), u.el, en.el, u.st.critRate, u.st.critDmg), u); }); break;
        case 'knockback':
          foes.forEach(function (en) {
            if (en.dead || en.boss) return;
            if (en.blockedBy) { en.blockedBy.blocking = en.blockedBy.blocking.filter(function (x) { return x !== en; }); en.blockedBy = null; }
            en.prog = Math.max(0, en.prog - e.cells * BR.knockbackPct / 100 * B.W / B.paths[en.path].total);
          });
          break;
        case 'stun': foes.forEach(function (en) { en.stunT = Math.max(en.stunT, e.sec); }); break;
        case 'slow':
          (e.target === 'enemiesInRange' ? enemiesNear(u, unitRadius(u)) : foes).forEach(function (en) { en.slowT = Math.max(en.slowT, e.sec); en.slowPct = Math.max(en.slowPct, e.pct); });
          break;
        case 'defDown': foes.forEach(function (en) { en.defDownT = Math.max(en.defDownT, e.sec); en.defDownPct = Math.max(en.defDownPct, e.pct); }); break;
      }
    });
  }
  function autoWants(u) {                          // AUTO：有目標或有人受傷時才放，避免空放
    var sk = u.skill, types = sk.effects.map(function (e) { return e.type; });
    if (types.indexOf('energy') >= 0) return true;
    var hurt = B.pets.some(function (p) { return p.hp / p.maxHp < 0.7; });
    if (types.indexOf('heal') >= 0 || types.indexOf('hot') >= 0 || types.indexOf('dmgReduce') >= 0) { if (hurt) return true; }
    if (sk.target === 'blocked' || sk.target === 'self') return u.blocking.length > 0 || enemiesNear(u, unitRadius(u) * 1.3).length > 0;
    return enemiesNear(u, unitRadius(u) * (sk.target === 'enemiesInRange3Lanes' ? 1.25 : 1)).length > 0;
  }

  /* ---------- 主迴圈 ---------- */
  function battleLoop(ts) {
    if (!B.active) return;
    var dt = Math.min(0.05, Math.max(0, (ts - B.lastTs) / 1000));
    B.lastTs = ts;
    if (!B.paused) { for (var i = 0; i < B.speed; i++) { update(dt); if (!B.active) return; } render(dt); }
    requestAnimationFrame(battleLoop);
  }
  function update(dt) {
    B.t += dt;
    var regen = BR.energy.regenPerSec + B.pets.reduce(function (a, p) {
      return a + (p.passive && p.passive.type === 'energyRegen' ? p.passive.add : 0) + (p.trait && p.trait.type === 'energyRegen' ? p.trait.add : 0);
    }, 0);
    B.energy = Math.min(BR.energy.max, B.energy + regen * dt);

    if (B.mode === 'endless' && B.t >= B.nextWaveT && !B.queue.length) queueEndlessWave();
    while (B.queue.length && B.queue[0].t <= B.t) {
      var it = B.queue.shift();
      if (it.wave > B.waveShown) { B.waveShown = it.wave; banner('第 ' + it.wave + ' 波', false); Sound.play('wave'); }
      spawnEnemy(it);
    }

    // 精靈
    B.pets.forEach(function (u) {
      if (u.dead) return;
      u.sp = Math.min(u.skill.cd, u.sp + dt);
      if (S.settings.auto && u.sp >= u.skill.cd && autoWants(u)) { castSkill(u); }
      u.buffs = u.buffs.filter(function (b) {
        b.t -= dt;
        if (b.type === 'hot') { b.acc += dt; if (b.acc >= 1) { b.acc -= 1; healPet(u, u.maxHp * b.pct / 100); } }
        return b.t > 0;
      });
      if (u.spot.type === 'spring' && u.hp < u.maxHp) {   // 微光泉水格：每秒回血
        u.springAcc += dt;
        if (u.springAcc >= 1) { u.springAcc -= 1; healPet(u, u.maxHp * u.spot.heal / 100); }
      }
      if (u.stunT > 0) return;
      u.atkT -= dt * effAspdMul(u);
      if (u.atkT > 0) return;
      if (u.role === 'healer') {
        var r = unitRadius(u);
        var hurt = B.pets.filter(function (p) { return !p.dead && p.hp < p.maxHp && dist(p, u) <= r; }).sort(function (a, b) { return a.hp / a.maxHp - b.hp / b.maxHp; })[0];
        if (!hurt) { u.atkT = 0.25; return; }
        u.atkT = u.st.aspd;
        pulse(u.dom, 'is-attacking');
        shootProj(u, hurt, function () { healPet(hurt, u.st.atk * (1 + u.st.healPct / 100)); });
        Sound.play('heal');
        return;
      }
      var targets;
      if (u.role === 'guardian') {
        targets = u.blocking.filter(function (e) { return !e.dead; });
        if (!targets.length) targets = enemiesNear(u, unitRadius(u), true).sort(function (a, b) { return b.prog - a.prog; }).slice(0, 1);
        else targets = targets.slice(0, 1);
      } else {
        var near = enemiesNear(u, unitRadius(u)).sort(function (a, b) { return b.prog - a.prog; });
        var pv = u.passive;
        targets = pv && pv.type === 'multiTarget' ? near.slice(0, pv.targets) : pv && pv.type === 'pierce' ? near : near.slice(0, 1);
      }
      if (!targets.length) { u.atkT = 0.15; return; }
      u.atkT = u.st.aspd;
      pulse(u.dom, 'is-attacking');
      var mul = targets.length > 1 && u.passive && u.passive.dmgPct ? u.passive.dmgPct / 100 : 1;
      targets.forEach(function (en) {
        var res = calcDmg(u.st.atk, enemyDef(en), u.el, en.el, u.st.critRate, u.st.critDmg, mul);
        if (u.role === 'guardian') { hitEnemy(en, res, u); applyTrait(u, en); Sound.play('hit'); }
        else { shootProj(u, en, function () { hitEnemy(en, res, u); applyTrait(u, en); }); Sound.play('shoot'); }
      });
    });

    B.projs = B.projs.filter(function (p) { p.t -= dt; if (p.t <= 0) { p.cb(); return false; } return true; });

    // 怪物
    B.enemies.slice().forEach(function (en) {
      if (en.dead) return;
      if (en.stunT > 0) en.stunT -= dt;
      if (en.slowT > 0) { en.slowT -= dt; if (en.slowT <= 0) en.slowPct = 0; }
      if (en.defDownT > 0) { en.defDownT -= dt; if (en.defDownT <= 0) en.defDownPct = 0; }
      var bl = en.blockedBy;
      if (bl && bl.dead) { en.blockedBy = bl = null; }
      if (bl && bl.passive && bl.passive.type === 'slowBlocked') { en.slowT = Math.max(en.slowT, 0.3); en.slowPct = Math.max(en.slowPct, bl.passive.pct); }
      var rate = 1 - en.slowPct / 100, sp = en.E.special;
      if (bl && sp && sp.type === 'blockerDot') {
        en.dotAcc += sp.dmgPerSec * en.scale * dt; en.dotShow += dt;
        if (en.dotShow >= 1) { en.dotShow -= 1; var dd = Math.round(en.dotAcc); en.dotAcc = 0; hitPet(bl, dd, { cls: 'is-true' }); if (bl.dead) { en.blockedBy = null; bl = null; } }
      }
      if (sp && sp.type === 'shockwave') {
        en.shockT -= dt;
        if (en.shockT <= 0) {
          en.shockT = en.hp / en.maxHp <= sp.enrage.hpPctBelow / 100 ? sp.enrage.interval : sp.interval;
          var rad = BR.shockRadiusPct / 100 * B.W;
          fxRing(en.x, en.y, rad * 2, false); Sound.play('shock');
          B.pets.slice().forEach(function (p) {
            if (dist(p, en) > rad) return;
            var raw = Math.max(sp.dmg * en.scale * 0.15, sp.dmg * en.scale - effDef(p) * (1 - sp.defIgnorePct / 100));
            p.stunT = Math.max(p.stunT || 0, sp.stunSec);
            hitPet(p, raw * elemMul(en.el, p.el));
          });
        }
      }
      if (sp && sp.type === 'summon') {                // 古木樹樁：召喚小怪
        en.sumT -= dt;
        if (en.sumT <= 0) {
          var enr = en.hp / en.maxHp <= sp.enrage.hpPctBelow / 100;
          en.sumT = enr ? sp.enrage.interval : sp.interval;
          var cnt = enr ? sp.enrage.count : sp.count;
          for (var k = 0; k < cnt; k++) { var m = spawnEnemy({ e: sp.enemy, lane: 1, elite: false, hpMul: 1 }, { path: en.path, prog: Math.max(0, en.prog - 0.025 - k * 0.015) }); m.lane += (k - (cnt - 1) / 2) * 0.03; }
          floatText(en.x, en.y - B.W * 0.24, '召喚小栗球！', 'is-text'); Sound.play('crack');
        }
      }
      if (en.stunT > 0) return;
      if (bl) {
        en.atkT -= dt * rate;
        if (en.atkT <= 0) {
          en.atkT = en.atkInt;
          var r = calcDmg(en.atk, effDef(bl), en.el, bl.el, 0, 100);
          pulse(en.dom, 'is-attacking');
          hitPet(bl, r.dmg);
          if (bl.passive && bl.passive.type === 'reflect' && !en.dead) hitEnemy(en, { dmg: Math.max(1, Math.round(r.dmg * bl.passive.pct / 100)), crit: false, em: 1 }, bl);
        }
        return;
      }
      var P = B.paths[en.path];
      var dp = en.speed * BR.speedUnitPct / 100 * B.W / P.total * dt * rate;
      var np = en.prog + dp;
      if (!en.flying) {                               // 飛行怪無視地面阻擋
        var g = null, gp = 0;
        B.pets.forEach(function (p) {
          if (p.dead || p.role !== 'guardian' || p.stunT > 0) return;
          var sp2 = p.spot.progs && p.spot.progs[en.path];
          if (sp2 == null) return;
          if (sp2 > en.prog - 0.002 && sp2 <= np + 0.004 && p.blocking.length < effBlock(p) && (!g || sp2 < gp)) { g = p; gp = sp2; }
        });
        if (g) { en.prog = Math.min(np, gp - 0.006); en.blockedBy = g; g.blocking.push(en); en.atkT = Math.min(en.atkT, 0.6); return; }
      }
      en.prog = np;
      if (en.prog >= 1) {
        en.dead = true;
        B.lives = Math.max(0, B.lives - en.E.leakDamage);
        Sound.play('lose');
        var end = P.pts[P.pts.length - 1];
        floatText(end[0], end[1] - B.W * 0.12, '−' + en.E.leakDamage + ' ♥', 'is-text');
        en.dom.classList.add('is-dying'); setTimeout(function () { en.dom.remove(); }, 400);
      }
    });
    B.pets.forEach(function (p) { if (p.stunT > 0) p.stunT -= dt; });
    B.enemies = B.enemies.filter(function (e) { return !e.dead; });
    B.enemies.forEach(function (en) { var pp = enemyPos(en); en.x = pp.x; en.y = pp.y; });

    if (B.lives <= 0) { endBattle(false); return; }
    if (B.mode === 'stage' && !B.queue.length && !B.enemies.length) endBattle(true);
  }
  function render(dt) {
    B.enemies.forEach(function (en) {
      var d = en.dom;
      d.style.transform = 'translate3d(' + en.x + 'px,' + en.y + 'px,0)';
      d.style.zIndex = Math.round(en.y) + (en.flying ? 400 : 0);
      d.style.setProperty('--hp', clamp(en.hp / en.maxHp * 100, 0, 100) + '%');
      d.classList.toggle('is-blocked', !!en.blockedBy);
      d.classList.toggle('is-stunned', en.stunT > 0);
      d.classList.toggle('is-slowed', en.slowPct > 0);
      d.classList.toggle('is-defdown', en.defDownT > 0);
    });
    B.pets.forEach(function (u) {
      var d = u.dom;
      d.style.transform = 'translate3d(' + u.x + 'px,' + u.y + 'px,0)';
      d.style.zIndex = Math.round(u.y);
      d.style.setProperty('--hp', clamp(u.hp / u.maxHp * 100, 0, 100) + '%');
      d.style.setProperty('--sp', clamp(u.sp / u.skill.cd * 100, 0, 100) + '%');
      d.classList.toggle('skill-ready', u.sp >= u.skill.cd);
      d.classList.toggle('is-stunned', u.stunT > 0);
      d.classList.toggle('buff-def', u.buffs.some(function (b) { return b.type === 'buff' || b.type === 'dmgReduce'; }));
    });
    B.uiT -= dt;
    if (B.uiT <= 0) { B.uiT = 0.1; renderBattleHUD(); }
  }
  function renderBattleHUD() {
    var hearts = $('#battleLives');
    if (hearts.children.length !== B.livesMax) hearts.innerHTML = new Array(B.livesMax + 1).join('<svg class="ico"><use href="#i-heart"/></svg>');
    $$('.ico', hearts).forEach(function (h, i) { h.classList.toggle('is-lost', i >= B.lives); });
    $('#battleWave').textContent = Math.max(1, B.waveShown);
    $('#battleWaveTotal').textContent = B.mode === 'endless' ? '∞' : B.waveTotal;
    $('#energyOrb').style.setProperty('--pct', (B.energy / BR.energy.max * 100) + '%');
    $('#energyVal').textContent = Math.floor(B.energy);
    B.team.forEach(function (id) {
      var c = B.cards[id], d = c.dom; if (!d) return;
      var cooling = !c.deployed && B.t < c.cdUntil;
      d.classList.toggle('is-deployed', !!c.deployed);
      d.classList.toggle('is-cooling', cooling);
      d.classList.toggle('is-unaffordable', !c.deployed && !cooling && B.energy < c.cost);
      if (cooling) { var left = c.cdUntil - B.t; d.style.setProperty('--cd', left / BR.redeployCooldown * 100); d.querySelector('.dc-cd').textContent = Math.ceil(left); }
    });
  }

  /* ---------- 特效 ---------- */
  function pulse(d, cls, ms) { if (!d) return; d.classList.remove(cls); void d.offsetWidth; d.classList.add(cls); clearTimeout(d['_t' + cls]); d['_t' + cls] = setTimeout(function () { d.classList.remove(cls); }, ms || 300); }
  function floatNum(x, y, n, cls) {
    var f = UI.tpl('fx-num'); f.className = 'fx-num ' + (cls || ''); f.textContent = fmt(n);
    f.style.left = x + 'px'; f.style.top = y + 'px';
    $('#battleFx').appendChild(f); setTimeout(function () { f.remove(); }, 1000);
  }
  function floatText(x, y, t, cls) {
    var f = el('div', 'fx-num ' + (cls || '')); f.textContent = t; f.style.left = x + 'px'; f.style.top = y + 'px';
    $('#battleFx').appendChild(f); setTimeout(function () { f.remove(); }, 1000);
  }
  function fxHit(x, y, heal) { var h = el('div', 'fx-hit' + (heal ? ' is-heal' : '')); h.style.left = x + 'px'; h.style.top = y + 'px'; $('#battleFx').appendChild(h); setTimeout(function () { h.remove(); }, 380); }
  function fxRing(x, y, d, skill) { var r = el('div', 'fx-shock' + (skill ? ' is-skill' : '')); r.style.left = x + 'px'; r.style.top = (y - B.W * 0.04) + 'px'; r.style.setProperty('--d', d + 'px'); $('#battleFx').appendChild(r); setTimeout(function () { r.remove(); }, 720); }
  function shootProj(from, to, cb) {
    var p = el('div', 'fx-projectile'); p.dataset.el = from.el;
    var t = clamp(dist(from, to) / (B.W * 1.6), 0.12, 0.4);
    p.style.setProperty('--t', (t / B.speed) + 's');
    var sy = from.y - B.W * 0.08, ty = to.y - B.W * (to.flying ? 0.12 : 0.06);
    p.style.transform = 'translate(' + from.x + 'px,' + sy + 'px)';
    $('#battleFx').appendChild(p);
    requestAnimationFrame(function () { requestAnimationFrame(function () { p.style.transform = 'translate(' + to.x + 'px,' + ty + 'px)'; }); });
    B.projs.push({ t: t, cb: function () { p.remove(); cb(); } });
  }
  function banner(text, boss) {
    var b = $('#waveBanner'); $('#waveBannerText').textContent = text;
    b.classList.toggle('is-boss', !!boss);
    b.classList.remove('is-show'); void b.offsetWidth; b.classList.add('is-show');
  }

  /* ---------- 結算 ---------- */
  function endBattle(win, quiet) {
    if (!B.active) return;
    B.active = false;
    closeUnitActions();
    if (quiet) return;
    var team = B.team.slice(), list = [];
    var lootList = grant({ coins: B.loot.coins, mats: B.loot.mats });
    lootList.forEach(function (r) { r.tag = '拾取'; });
    var stars = 0, title, sub;
    if (B.mode === 'stage') {
      var st = B.stage, dm = D.DIFFICULTY[B.diff], recAll = S.stages[st.id] || (S.stages[st.id] = {});
      var rec = recAll[B.diff] || (recAll[B.diff] = { clear: false, stars: 0 });
      if (win) {
        stars = 1 + (B.lives >= B.livesMax ? 1 : 0) + (B.totalCost <= st.costCap ? 1 : 0);
        list = list.concat(tagged(grant({ coins: st.rewards.clear.coins }, dm.rewardMul), '通關'));
        if (!rec.clear) list = list.concat(tagged(grant(st.rewards.first, dm.rewardMul), '首通'));
        if (stars === 3 && rec.stars < 3) list = list.concat(tagged(grant(st.rewards.threeStar, dm.rewardMul), '三星'));
        rec.clear = true; rec.stars = Math.max(rec.stars, stars);
        var exp = Math.round(st.rewards.clear.exp * dm.rewardMul);
        var ups = 0; team.forEach(function (id) { ups += addExp(id, exp); });
        list.push({ k: 'exp', n: exp, tag: '每隻' });
        questAdd('battleWin', 1);
        if (ups) setTimeout(function () { Sound.play('levelup'); UI.toast('有夥伴升級了！', 'good'); }, 900);
        title = '守護成功';
        sub = '泉水之心 ' + B.lives + ' / ' + B.livesMax + '・部署費用 ' + B.totalCost + '（三星上限 ' + st.costCap + '）' + (rec.stars === 3 ? '・已可一鍵掃蕩' : '');
      } else { title = '差一點點'; sub = '失敗不會扣除任何資源，調整陣容再試一次吧！'; }
    } else {
      var reached = Math.max(0, B.endlessWave - 1), EM = D.ENDLESS_MODE;
      var rewardable = S.daily.endlessRuns < EM.rewards.dailyRewardRuns;
      S.daily.endlessRuns++;
      if (rewardable && reached > 0) {
        var coins = 0; for (var w = 1; w <= reached; w++) coins += EM.rewards.perWave.coinsBase + EM.rewards.perWave.coinsPerWave * w;
        list = list.concat(tagged(grant({ coins: coins }), '波數'));
        var five = Math.floor(reached / 5);
        for (var k = 0; k < five; k++) list = list.concat(tagged(grant(EM.rewards.everyFiveWaves), '每 5 波'));
        var ex = EM.rewards.perWave.exp * reached; team.forEach(function (id) { addExp(id, ex); });
        list.push({ k: 'exp', n: ex, tag: '每隻' });
      }
      if (reached > S.endless.best) S.endless.best = reached;
      EM.rewards.bestRecordMilestones.forEach(function (m) {
        if (S.endless.best >= m.wave && S.endless.claimed.indexOf(m.wave) < 0) { S.endless.claimed.push(m.wave); list = list.concat(tagged(grant(m.rewards), m.wave + ' 波紀錄')); }
      });
      questAdd('endlessWave', reached, 'max');
      stars = reached >= 20 ? 3 : reached >= 10 ? 2 : reached >= 1 ? 1 : 0;
      win = reached > 0;
      title = '撐過 ' + reached + ' 波';
      sub = '最佳紀錄 ' + S.endless.best + ' 波' + (rewardable ? '' : '・今日獎勵場次已用完（每日 ' + EM.rewards.dailyRewardRuns + ' 場）');
    }
    list = list.concat(lootList);
    markDirty(); refreshHUD(); refreshDots();
    $('#resultRibbon').textContent = title;
    $$('#resultStars .ico').forEach(function (s, i) { s.classList.remove('on'); if (i < stars) setTimeout(function () { s.classList.add('on'); }, 50); });
    $('#resultSub').textContent = sub;
    renderRewards($('#resultRewards'), mergeRewardsKeepTags(list));
    $('#btnResultNext').textContent = B.mode === 'stage' && win ? '繼續冒險' : '回地圖';
    setTimeout(function () { UI.openModal('modalBattleResult'); Sound.play(win ? 'victory' : 'defeat'); }, 500);
  }
  function tagged(list, tag) { list.forEach(function (r) { r.tag = tag; }); return list; }
  function mergeRewardsKeepTags(list) {
    var out = [], idx = {};
    list.forEach(function (r) {
      if (r.k === 'exp' || r.k === 'title' || r.k === 'shard' || r.k === 'text') { out.push(r); return; }
      if (idx[r.k] == null) { idx[r.k] = out.length; out.push({ k: r.k, n: 0, tag: r.tag }); }
      var o = out[idx[r.k]]; o.n += r.n; if (o.tag !== r.tag) o.tag = '合計';
    });
    return out;
  }
  function leaveBattle() {
    endBattle(false, true);
    UI.closeOverlay('screen-battle');
    $('#battleUnits').innerHTML = ''; $('#battleFx').innerHTML = '';
    var w = $('#bfWeather'); if (w) w.remove();
    UI.switchTab('adventure');
    renderMap();
    setTimeout(tryShowEvo, 400);
  }
  function retryBattle() { var ctx = B.ctx; endBattle(false, true); UI.closeAllModals(); startBattle(ctx); }

  // 三星關卡一鍵掃蕩：每次 3 露水，取得通關星塵、經驗與一次掉落判定（不含首通／三星獎勵）
  function doSweep() {
    var st = STAGE(stageSel.id), diff = stageSel.diff, rec = stageRec(st.id, diff), dm = D.DIFFICULTY[diff], cost = D.SWEEP.costDew;
    if (rec.stars < 3) { UI.toast('三星通關後才能掃蕩'); return; }
    if (S.dew < cost) { Sound.play('bump'); UI.toast('露水不夠了（掃蕩需要 ' + cost + ' 露水）', 'warn'); return; }
    S.dew -= cost;
    var coins = st.rewards.clear.coins * dm.rewardMul, mats = {};
    st.waves.forEach(function (w) { w.spawns.forEach(function (sp) {
      var E = ENEMIES[sp.e], EL = sp.elite ? D.ELITE_MODIFIER : null;
      for (var i = 0; i < sp.n; i++) {
        coins += E.rewards.coins * (EL ? EL.coinsMul : 1);
        E.rewards.drops.forEach(function (d) { if (Math.random() * 100 < d.chance * (EL ? EL.dropChanceMul : 1)) mats[d.id] = (mats[d.id] || 0) + d.n; });
      }
    }); });
    var list = grant({ coins: Math.round(coins), mats: mats });
    var team = S.team.filter(function (id) { return S.pets[id]; }), exp = Math.round(st.rewards.clear.exp * dm.rewardMul), ups = 0;
    team.forEach(function (id) { ups += addExp(id, exp); });
    list.push({ k: 'exp', n: exp, tag: '每隻' });
    questAdd('battleWin', 1);
    markDirty(); refreshDots(); renderStage();
    showRewards('掃蕩完成・' + st.id + ' ' + st.name, list, 'victory', ups ? '有夥伴升級了！' : '');
  }

  /* =================================================================
   * 16. 森林奇遇步道（6 層左右分支、隨機事件、旅人、祝福、終點寶箱；中途離開可續走）
   * ================================================================= */
  var TR = D.TRAIL;
  var EVT = {}; TR.events.forEach(function (e) { EVT[e.type] = e; });
  var trailBusy = false;
  function trailIcon(type) {
    return { forage: { art: D.ASSETS.materials.mat_01, fb: D.MATERIALS.mat_01.fallback },
      chest: { art: D.ASSETS.props.trailChest, fb: { color: '#C99B6C', glyph: '箱' } },
      final: { art: D.ASSETS.props.trailChest, fb: { color: '#C99B6C', glyph: '箱' } },
      traveler: { ico: '#i-steps' }, blessing: { ico: '#i-star' }, rest: { ico: '#i-leaf' } }[type];
  }
  function renderTrailEntrance() {
    var info = $('#trailInfo'), btn = $('#btnTrailStart'), act = S.trail.active, unlocked = trailUnlocked();
    info.innerHTML = '';
    var chip = function (t) { var c = el('span', 'chip'); c.textContent = t; info.appendChild(c); };
    chip('已走完 ' + (S.trail.runs || 0) + ' 次');
    if (S.blessing) { var b = el('span', 'blessing-chip'); b.textContent = '✦ ' + S.blessing.name + '：' + S.blessing.desc; info.appendChild(b); }
    if (!unlocked) { btn.innerHTML = '通關 ' + TR.unlock.stageClear + ' 後開放'; btn.classList.add('is-disabled'); }
    else if (act) { btn.classList.remove('is-disabled'); btn.innerHTML = '<svg class="ico"><use href="#i-steps"/></svg>繼續步道（第 ' + act.layer + ' / ' + TR.layers + ' 層）'; }
    else { btn.classList.remove('is-disabled'); btn.innerHTML = '<svg class="ico"><use href="#i-steps"/></svg>出發 <span class="sub"><svg class="ico" style="font-size:14px"><use href="#i-dew"/></svg> ' + TR.costDew + '</span>'; }
    renderItemBag($('#trailBag'));
  }
  function startTrail() {
    if (!trailUnlocked()) { Sound.play('bump'); UI.toast('通關 ' + TR.unlock.stageClear + '（普通）後開放'); return; }
    if (!S.trail.active) {
      if (S.dew < TR.costDew) { Sound.play('bump'); UI.toast('露水不夠了（出發需要 ' + TR.costDew + ' 露水）', 'warn'); return; }
      S.dew -= TR.costDew;
      var layers = [];
      for (var i = 0; i < TR.layers; i++) {
        layers.push([0, 1].map(function (side) {
          var e = weighted(TR.events.map(function (x) { return [x.type, x.weight]; }));
          return { type: e, revealed: Math.random() * 100 < TR.revealPct, jx: rand(-TR.layout.jitterX, TR.layout.jitterX) };
        }));
      }
      S.trail.active = { layer: 0, layers: layers, picks: [], loot: [] };
      markDirty(); refreshHUD();
    }
    trailBusy = false;
    UI.openOverlay('screen-trail');
    Camp.stop();
    requestAnimationFrame(function () { layoutTrail(); renderTrail(true); });
  }
  var trailRatio = 720 / 1290;
  (function () { var im = new Image(); im.onload = function () { trailRatio = im.naturalWidth / im.naturalHeight; }; im.src = D.ASSETS.backgrounds.trail; })();
  function layoutTrail() {
    var f = $('#trailField'), W = f.clientWidth, H = f.clientHeight; if (!W) return;
    var w = W, h = W / trailRatio; if (h > H) { h = H; w = H * trailRatio; }
    var m = $('#trailMap'); m.style.setProperty('--tm-w', w + 'px'); m.style.setProperty('--tm-h', h + 'px');
  }
  function nodePos(layer, side) {                  // layer -1 = 起點；layer = layers → 終點
    var L = TR.layout, act = S.trail.active;
    if (layer < 0) return { x: L.start.x, y: L.start.y };
    if (layer >= TR.layers) return { x: L.final.x, y: L.final.y };
    var n = act.layers[layer][side];
    return { x: (side === 0 ? L.leftX : L.rightX) + n.jx, y: L.layerY[layer] };
  }
  function renderTrail(instant) {
    var act = S.trail.active; if (!act) return;
    $('#trailLayer').textContent = '第 ' + act.layer + ' / ' + TR.layers + ' 層';
    var box = $('#trailNodes'); box.innerHTML = '';
    var lines = '', cur = act.layer, picks = act.picks;
    var prevPos = function (l) { return l === 0 ? nodePos(-1) : nodePos(l - 1, picks[l - 1]); };
    for (var l = 0; l < TR.layers; l++) [0, 1].forEach(function (side) {
      var from = l < cur ? [prevPos(l)] : l === cur ? [prevPos(l)] : [nodePos(l - 1, 0), nodePos(l - 1, 1)];
      var to = nodePos(l, side), walked = l < cur && picks[l] === side;
      from.forEach(function (fp) { lines += '<path class="' + (walked ? 'is-walked' : '') + '" d="M' + fp.x + ' ' + fp.y + ' L' + to.x + ' ' + to.y + '" vector-effect="non-scaling-stroke"/>'; });
    });
    var lastP = cur >= TR.layers ? nodePos(TR.layers - 1, picks[TR.layers - 1]) : null;
    [0, 1].forEach(function (side) { var a = nodePos(TR.layers - 1, side), f = nodePos(TR.layers); lines += '<path class="' + (lastP && picks[TR.layers - 1] === side && act.finalDone ? 'is-walked' : '') + '" d="M' + a.x + ' ' + a.y + ' L' + f.x + ' ' + f.y + '" vector-effect="non-scaling-stroke"/>'; });
    var svg = $('#trailLines'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.innerHTML = lines;
    var mk = function (pos, cls, type, show, label) {
      var n = el('button', 'trail-node ' + cls); n.style.left = pos.x + '%'; n.style.top = pos.y + '%';
      var ic = show ? trailIcon(type) : null;
      if (ic && ic.art) { var a = el('div', 'art'); n.appendChild(a); UI.setArt(a, ic.art, ic.fb); }
      else if (ic && ic.ico) n.innerHTML = '<svg class="ico"><use href="' + ic.ico + '"/></svg>';
      else if (!show) n.innerHTML = '<span class="tn-q">？</span>';
      if (label) { var t = el('span', 'tn-label'); t.textContent = label; n.appendChild(t); }
      box.appendChild(n); return n;
    };
    mk(nodePos(-1), 'is-start is-done', 'rest', false, '出發').innerHTML = '<svg class="ico"><use href="#i-tab-camp"/></svg><span class="tn-label">出發</span>';
    for (var L2 = 0; L2 < TR.layers; L2++) [0, 1].forEach(function (side) {
      var nd = act.layers[L2][side], done = L2 < cur && picks[L2] === side, skipped = L2 < cur && picks[L2] !== side, next = L2 === cur;
      var show = nd.revealed || L2 < cur;
      var n = mk(nodePos(L2, side), (done ? 'is-done' : skipped ? 'is-skipped' : next ? 'is-next' : 'is-locked'), nd.type, show, show ? EVT[nd.type].name : (next ? '未知' : ''));
      if (next) n.addEventListener('click', function () { chooseTrail(side); });
    });
    var fin = mk(nodePos(TR.layers), 'is-final' + (act.finalDone ? ' is-done' : cur >= TR.layers ? ' is-next' : ' is-locked'), 'final', true, '終點寶箱');
    if (cur >= TR.layers && !act.finalDone) fin.addEventListener('click', openFinalChest);
    var walker = $('#trailWalker'), wp = cur === 0 ? nodePos(-1) : cur > TR.layers ? nodePos(TR.layers) : nodePos(cur - 1, picks[cur - 1]);
    if (act.finalDone) wp = nodePos(TR.layers);
    if (instant) { walker.style.transition = 'none'; requestAnimationFrame(function () { walker.style.transition = ''; }); }
    walker.style.left = wp.x + '%'; walker.style.top = wp.y + '%';
    var lead = S.team.find(function (id) { return S.pets[id]; }) || Object.keys(S.pets)[0], wa = $('#trailWalker .art');
    UI.setArt(wa, petArt(lead), PETS[lead].fallback); wa.classList.toggle('is-shiny', isShiny(lead));
    renderTrailLoot();
  }
  function renderTrailLoot() {
    var box = $('#trailLoot'), act = S.trail.active; box.innerHTML = '';
    if (!act || !act.loot.length) { box.innerHTML = '<span class="t-small t-soft">一路撿到的東西會放在這裡</span>'; return; }
    mergeRewards(act.loot).forEach(function (r, i) { box.appendChild(rewardChip(r, i)); });
  }
  function chooseTrail(side) {
    var act = S.trail.active; if (!act || trailBusy) return;
    trailBusy = true;
    var nd = act.layers[act.layer][side];
    act.picks[act.layer] = side;
    var wp = nodePos(act.layer, side), walker = $('#trailWalker');
    walker.style.left = wp.x + '%'; walker.style.top = wp.y + '%';
    Sound.play('step'); setTimeout(function () { Sound.play('step'); }, 250);
    setTimeout(function () { resolveTrailEvent(nd); }, 650);
  }
  function trailEventModal(title, text, art, rewards, options) {
    $('#trailEventTitle').textContent = title;
    $('#trailEventText').textContent = text;
    var a = $('#trailEventArt'); a.classList.remove('is-shake');
    if (art && art.art) { a.style.display = ''; a.innerHTML = '<img alt="">'; UI.setArt(a, art.art, art.fb); }
    else if (art && art.ico) { a.style.display = ''; a.className = 'art trail-event-art'; a.innerHTML = '<svg class="ico" style="width:100%;height:100%"><use href="' + art.ico + '"/></svg>'; }
    else a.style.display = 'none';
    renderRewards($('#trailEventRewards'), rewards || []);
    if (!rewards) $('#trailEventRewards').innerHTML = '';
    var ob = $('#trailEventOptions'); ob.innerHTML = '';
    (options || []).forEach(function (o) {
      var b = el('button', 'btn ' + (o.cls || 'btn-cream') + ' btn-block'); b.innerHTML = o.label;
      if (o.disabled) b.classList.add('is-disabled');
      b.addEventListener('click', o.onClick); ob.appendChild(b);
    });
    $('#trailEventFoot').style.display = options && options.length ? 'none' : '';
    UI.openModal('modalTrailEvent');
  }
  function addTrailLoot(list) { var act = S.trail.active; list.forEach(function (r) { act.loot.push(r); }); markDirty(); }
  function resolveTrailEvent(nd) {
    var ev = EVT[nd.type];
    if (nd.type === 'forage' || nd.type === 'rest') {
      var got = grant(ev.reward); addTrailLoot(got); Sound.play('pop');
      trailEventModal(ev.name, ev.desc, trailIcon(nd.type), got);
    } else if (nd.type === 'chest') {
      var t = weighted(ev.table.map(function (x) { return [x, x.weight]; })), got2 = grant(t.reward); addTrailLoot(got2);
      trailEventModal(ev.name, ev.desc, trailIcon('chest'), got2);
      var art = $('#trailEventArt'); art.classList.add('is-shake'); Sound.play('crack'); setTimeout(function () { Sound.play('unlock'); }, 900);
    } else if (nd.type === 'traveler') {
      var owned = Object.keys(S.pets), pid = pick(owned), afford = S.coins >= ev.costCoins;
      trailEventModal(ev.name, ev.desc + '（' + petName(pid) + ' 的碎片 ×' + ev.shards + '）', { art: petArt(pid), fb: PETS[pid].fallback }, null, [
        { label: '交換（<svg class="ico" style="font-size:14px"><use href="#i-stardust"/></svg> ' + ev.costCoins + '）', cls: 'btn-honey', disabled: !afford, onClick: function () {
          if (S.coins < ev.costCoins) return;
          S.coins -= ev.costCoins;
          var res = obtainPet(pid, false), r = { k: 'shard', id: pid, n: ev.shards };
          addTrailLoot([r]); Sound.play('hatch');
          UI.toast(petName(pid) + (res.starUp ? ' 升到 ★' + res.starUp + '！' : res.exp ? ' 已滿星，轉為 EXP +' + res.exp : ' 碎片 +1'), 'good');
          UI.closeModal('modalTrailEvent'); afterTrailEvent();
        } },
        { label: afford ? '婉拒，收下小點心' : '星塵不夠，收下小點心', cls: 'btn-cream', onClick: function () {
          addTrailLoot(grant(ev.declineGift)); UI.closeModal('modalTrailEvent'); afterTrailEvent();
        } }
      ]);
    } else if (nd.type === 'blessing') {
      trailEventModal(ev.name, ev.desc + (S.blessing ? '（會取代目前的「' + S.blessing.name + '」）' : ''), trailIcon('blessing'), null, ev.options.map(function (o) {
        return { label: '<b>' + o.name + '</b>　<span class="sub">' + o.desc + '</span>', cls: 'btn-sage', onClick: function () {
          S.blessing = Object.assign({}, o); addTrailLoot([{ k: 'text', n: '✦ ' + o.name }]);
          Sound.play('skill'); UI.closeModal('modalTrailEvent'); afterTrailEvent();
        } };
      }));
    }
  }
  function afterTrailEvent() {
    var act = S.trail.active; if (!act) return;
    act.layer++; trailBusy = false; markDirty();
    renderTrail();
    if (act.layer >= TR.layers) setTimeout(function () { UI.toast('終點寶箱就在前面！', 'good'); }, 300);
  }
  function openFinalChest() {
    var act = S.trail.active; if (!act || act.finalDone || trailBusy) return;
    trailBusy = true;
    var wp = nodePos(TR.layers), walker = $('#trailWalker'); walker.style.left = wp.x + '%'; walker.style.top = wp.y + '%';
    setTimeout(function () {
      var t = weighted(TR.finalChest.table.map(function (x) { return [x, x.weight]; })), got = grant(t.reward);
      addTrailLoot(got); act.finalDone = true;
      S.trail.runs = (S.trail.runs || 0) + 1;
      questAdd('trailRun', 1);
      trailEventModal(TR.finalChest.name, '走完了整條森林奇遇步道！打開大寶箱看看～', trailIcon('final'), got);
      $('#trailEventArt').classList.add('is-shake'); Sound.play('crack'); setTimeout(function () { Sound.play('victory'); }, 900);
      act.layer = TR.layers + 1;
      markDirty(); renderTrail();
    }, 650);
  }
  function finishTrail() {
    var act = S.trail.active; if (!act) return;
    var loot = act.loot.slice();
    S.trail.active = null; trailBusy = false; markDirty();
    UI.closeOverlay('screen-trail');
    renderTrailEntrance(); refreshDots();
    showRewards('步道收穫總覽', loot.filter(function (r) { return r.k !== 'text'; }), 'victory', '這趟一共撿到這些（已全部收進背包）');
  }
  function onTrailEventOk() {
    UI.closeModal('modalTrailEvent');
    var act = S.trail.active; if (!act) return;
    if (act.finalDone) { finishTrail(); return; }
    afterTrailEvent();
  }

  /* =================================================================
   * 17. 鍛造工坊（三階品質、1~2 條隨機副詞條、分解）
   * ================================================================= */
  var forgeSel = 'eq_01';
  var SLOT_ICON = { wrist: '#i-role-guardian', pendant: '#i-role-healer', hair: '#i-leaf' };
  function forgeCost(r) { return { coins: r.cost.coins, mats: r.cost.mats }; }
  function forgeMatMul() { return 1 - workEff().matCostDownPct / 100; }
  function renderForge() {
    var box = $('#forgeRecipes'); box.innerHTML = '';
    D.CRAFT_RECIPES.forEach(function (r) {
      var s = UI.tpl('recipe-slot');
      s.querySelector('span').innerHTML = r.name + '<br><span class="rs-q">' + D.EQUIP_SLOTS[r.slot].name + '・適合' + D.ROLES[r.suggestRole].name + '</span>';
      UI.setArt(s.querySelector('.art'), D.ASSETS.equipment[r.asset], r.fallback);
      if (r.id === forgeSel) s.classList.add('is-active');
      s.addEventListener('click', function () { forgeSel = r.id; Sound.play('click'); renderForge(); });
      box.appendChild(s);
    });
    var r = RECIPES[forgeSel];
    UI.setArt($('#forgeArt'), D.ASSETS.equipment[r.asset], r.fallback);
    renderCost($('#forgeCost'), forgeCost(r), forgeMatMul());
    var w = workEff().qualityWeights, tot = 0; Object.keys(w).forEach(function (k) { tot += w[k]; });
    $('#forgeOdds').innerHTML = D.CRAFT_QUALITIES.map(function (q) { return '<i data-q="' + q.id + '" style="width:' + (w[q.id] / tot * 100) + '%"></i>'; }).join('');
    $('#forgeOddsLegend').innerHTML = D.CRAFT_QUALITIES.map(function (q) { return '<span>' + q.name + ' ' + w[q.id] + '%</span>'; }).join('');
    $('#btnCraft').disabled = !canPay(forgeCost(r), forgeMatMul());
    var bag = $('#matBag'); bag.innerHTML = '';
    Object.keys(D.MATERIALS).forEach(function (m) { bag.appendChild(costItem(m, S.mats[m] || 0)); });
    var inv = $('#gearInventory'); inv.innerHTML = '';
    if (!S.gear.length) inv.appendChild(el('p', 't-small', '<span style="color:#FFF8EA">還沒有裝備，先鍛造一件吧</span>'));
    sortedGear().forEach(function (g) { inv.appendChild(gearDom(g, function () { openGear(g.uid); })); });
  }
  function sortedGear(slot) {
    var order = { epic: 0, fine: 1, common: 2 };
    return S.gear.filter(function (g) { return !slot || g.slot === slot; }).sort(function (a, b) { return order[a.q] - order[b.q] || (a.uid < b.uid ? 1 : -1); });
  }
  function gearDom(g, onClick) {
    var d = UI.tpl('gear-item'), r = RECIPES[g.recipe];
    d.dataset.q = g.q;
    UI.setArt(d.querySelector('.art'), D.ASSETS.equipment[r.asset], r.fallback);
    if (g.by) { var t = el('span', 'gi-tag'); t.textContent = petName(g.by); d.appendChild(t); }
    d.addEventListener('click', onClick);
    return d;
  }
  function rollGear(r) {
    var w = workEff().qualityWeights;
    var qid = weighted(Object.keys(w).map(function (k) { return [k, w[k]]; })), q = QUALITY[qid];
    var main = {}; Object.keys(r.baseStats).forEach(function (k) { main[k] = Math.round(r.baseStats[k] * q.statMul); });
    var n = randInt(q.substats[0], q.substats[1]);
    var pool = D.SUBSTAT_POOL.filter(function (x) { return !x.roles.length || x.roles.indexOf(r.suggestRole) >= 0; });
    var subs = [], used = {};
    while (subs.length < n) {
      var avail = pool.filter(function (x) { return !used[x.stat]; }); if (!avail.length) break;
      var x = weighted(avail.map(function (a) { return [a, a.weight]; }));
      used[x.stat] = 1; subs.push({ stat: x.stat, val: randInt(x.min, x.max) });
    }
    return { uid: 'g' + (S.gearSeq++), recipe: r.id, slot: r.slot, q: qid, main: main, subs: subs, by: null, t: now() };
  }
  var crafting = false;
  function craft() {
    if (crafting) return;
    var r = RECIPES[forgeSel], cost = forgeCost(r);
    if (!canPay(cost, forgeMatMul())) { Sound.play('bump'); UI.toast('素材或星塵不足', 'warn'); return; }
    pay(cost, forgeMatMul());
    crafting = true;
    var anvil = $('#forgeAnvil'); anvil.dataset.quality = '';
    anvil.classList.remove('is-crafting'); void anvil.offsetWidth; anvil.classList.add('is-crafting');
    [0, 260, 520].forEach(function (t) { setTimeout(function () { Sound.play('forge'); }, t); });
    setTimeout(function () {
      var g = rollGear(r); S.gear.push(g);
      anvil.classList.remove('is-crafting'); anvil.dataset.quality = g.q;
      questAdd('craft', 1); markDirty();
      crafting = false;
      renderForge();
      openGear(g.uid, '鍛造完成！');
      if (g.q === 'epic') setTimeout(function () { Sound.play('hatch'); }, 200);
    }, 1500);
  }
  var gearSel = null, salvageArm = false;
  function openGear(uid, title) {
    var g = gearById(uid); if (!g) return;
    gearSel = uid; salvageArm = false;
    var r = RECIPES[g.recipe], q = QUALITY[g.q];
    $('#gearTitle').textContent = title || r.name;
    $('#gearHero').dataset.q = g.q;
    UI.setArt($('#gearArt'), D.ASSETS.equipment[r.asset], r.fallback);
    $('#gearQuality').innerHTML = '<span class="chip" style="color:' + q.color + ';border-color:' + q.color + '">' + q.name + '</span> ' + r.name + '・' + D.EQUIP_SLOTS[r.slot].name;
    $('#gearStats').innerHTML = Object.keys(g.main).map(function (k) { return '<li><span>' + (STAT_NAME[k] || k) + '</span><b>' + statText(k, g.main[k]).split(' ')[1] + '</b></li>'; }).join('') +
      g.subs.map(function (s) { return '<li class="is-sub"><span>✦ ' + (STAT_NAME[s.stat] || s.stat) + '</span><b>' + statText(s.stat, s.val).split(' ')[1] + '</b></li>'; }).join('');
    $('#gearOwner').textContent = g.by ? '目前由 ' + petName(g.by) + ' 裝備中' : '尚未裝備，可在精靈屋的「裝備」頁穿上';
    var sb = $('#btnGearSalvage'); sb.textContent = '分解'; sb.disabled = !!g.by;
    UI.openModal('modalGear');
  }
  function salvageGear() {
    var g = gearById(gearSel); if (!g || g.by) return;
    if (!salvageArm) { salvageArm = true; $('#btnGearSalvage').textContent = '再按一次確認'; Sound.play('bump'); return; }
    var r = RECIPES[g.recipe], back = {};
    Object.keys(r.cost.mats).forEach(function (m) { var n = Math.floor(r.cost.mats[m] * D.ECONOMY.equipSalvageReturnPct / 100); if (n > 0) back[m] = n; });
    S.gear = S.gear.filter(function (x) { return x.uid !== g.uid; });
    UI.closeModal('modalGear');
    var list = Object.keys(back).length ? grant({ mats: back }) : [];
    markDirty(); renderForge();
    if (list.length) showRewards('分解完成', list); else UI.toast('分解完成');
  }

  /* =================================================================
   * 18. 精靈屋（卡片、篩選、道具袋、詳情：養成／進化／裝備）
   * ================================================================= */
  var petFilter = 'all', curPet = null, gearSlot = null, pickBranch = null;
  function petCard(id, opt) {
    opt = opt || {};
    var P = PETS[id], st = S.pets[id], c = UI.tpl('pet-card'), shiny = opt.shiny != null ? opt.shiny : isShiny(id);
    c.dataset.el = P.element;
    c.querySelector('.pc-name').textContent = st ? petName(id) : P.name;
    var rb = c.querySelector('.badge-rarity'); rb.dataset.r = P.rarity; rb.textContent = P.rarity === 'UR' ? '傳說' : P.rarity;
    c.querySelector('.pc-lv').textContent = st ? 'Lv.' + st.lv : '???';
    var a = c.querySelector('.art'); UI.setArt(a, st ? petArt(id) : D.ASSETS.pets[id], P.fallback);
    if (shiny) { c.classList.add('is-shiny'); var sb = el('span', 'shiny-badge', '✦ 閃光'); c.appendChild(sb); }
    c.querySelector('.stars').innerHTML = starsHTML(st ? st.star : 0, 5);
    if (!st) c.classList.add('is-unowned');
    return c;
  }
  function renderItemBag(box) {
    if (!box) return;
    box.innerHTML = '';
    Object.keys(D.ITEMS).forEach(function (k) {
      var it = D.ITEMS[k], c = el('button', 'item-chip' + (k === 'item_shiny_charm' && S.charmActive ? ' is-active' : ''));
      var a = el('span', 'art'); c.appendChild(a); UI.setArt(a, D.ASSETS.items[k], it.fallback);
      c.appendChild(el('span', 't-num', '×' + (S.items[k] || 0)));
      c.title = it.name + '：' + it.desc;
      c.addEventListener('click', function () {
        if (k === 'item_shiny_charm') return useCharm();
        UI.toast(it.name + '：' + it.desc);
      });
      box.appendChild(c);
    });
  }
  function useCharm() {
    if (S.charmActive) { UI.toast('星願幸運草已生效：下一次召喚閃光機率 ' + D.SHINY.charmRatePct + '%'); return; }
    if (!(S.items.item_shiny_charm > 0)) { Sound.play('bump'); UI.toast('還沒有星願幸運草，去森林奇遇步道找找看'); return; }
    S.items.item_shiny_charm--; S.charmActive = true;
    Sound.play('shiny'); UI.toast('星願幸運草生效！下一次召喚每顆蛋閃光機率 ' + D.SHINY.charmRatePct + '%', 'good');
    markDirty(); renderPets(); renderTrailEntrance();
  }
  function renderPets() {
    var grid = $('#petGrid'); grid.innerHTML = '';
    D.PETS.filter(function (p) { return petFilter === 'all' || p.role === petFilter; }).forEach(function (P) {
      var c = petCard(P.id);
      if (S.pets[P.id] && evoReady(P.id)) c.classList.add('dot-host', 'has-dot');
      c.addEventListener('click', function () {
        if (!S.pets[P.id]) { Sound.play('bump'); UI.toast('還沒遇見 ' + P.name + '，到孵化巢召喚看看'); return; }
        openPet(P.id);
      });
      grid.appendChild(c);
    });
    var left = D.SUMMON.pitySSR - S.summon.pity;
    $('#pityText').textContent = '再 ' + left + ' 次必定 SSR 以上' + (S.tickets ? '・葉籤 ×' + S.tickets : '') + (S.charmActive ? '・幸運草生效中' : '');
    $('#summon1Cost').textContent = S.tickets > 0 ? '葉籤' : summonCost(1);
    $('#summon10Cost').textContent = summonCost(10);
    renderItemBag($('#petItemBag'));
  }
  function openPet(id) { curPet = id; gearSlot = null; pickBranch = null; renderPetDetail(); UI.setSubTab('petdetail', 'grow'); UI.openModal('sheetPet'); }
  function evoCost(id) {                            // 下一階進化的完整花費（一階＝晶石＋該精靈轉職素材）
    var st = S.pets[id], nx = evoNext(id); if (!nx) return null;
    var c = { coins: nx.cost.coins || 0, mats: Object.assign({}, nx.cost.mats || {}), items: Object.assign({}, nx.cost.items || {}) };
    if (nx.stage === 1) {
      var cc = PETS[id].classChange.cost;
      c.coins += cc.coins || 0;
      Object.keys(cc.mats || {}).forEach(function (m) { c.mats[m] = (c.mats[m] || 0) + cc.mats[m]; });
    }
    if (!c.coins) delete c.coins;
    return c;
  }
  function renderPetDetail() {
    var id = curPet, P = PETS[id], st = S.pets[id]; if (!st) return;
    var stats = petStats(id), sk = petSkill(id), br = st.branch ? branchOf(id, st.branch) : null;
    $('#petPortrait').dataset.el = P.element;
    var rb = $('#petRarity'); rb.dataset.r = P.rarity; rb.textContent = P.rarity === 'UR' ? '傳說' : P.rarity;
    var eb = $('#petElement'); eb.dataset.el = P.element; eb.textContent = D.ELEMENTS[P.element].name;
    $('#petRole').textContent = D.ROLES[P.role].name;
    $('#petShiny').hidden = !st.shiny;
    var pa = $('#petArt'); UI.setArt(pa, petArt(id), P.fallback); pa.classList.toggle('is-shiny', !!st.shiny);
    $('#petClassName').textContent = (st.evo ? ['一階進化', '最終形態'][st.evo - 1] : '初始形態') + (br ? '・' + br.name : '') + (evoReady(id) ? '・可以進化了！' : '');
    $('#petName').textContent = petName(id);
    var max = st.lv >= D.LEVEL_RULES.maxLevel, need = expNeed(st.lv);
    $('#petExpBar').style.setProperty('--pct', max ? '100%' : clamp(st.exp / need * 100, 0, 100) + '%');
    $('#petExpText').textContent = max ? '已滿級' : fmt(st.exp) + ' / ' + fmt(need);
    $$('[data-feed]').forEach(function (b) { b.disabled = max; });
    UI.setArt($('#feedBerryArt'), D.ASSETS.items.item_exp_berry, D.ITEMS.item_exp_berry.fallback);
    $('#feedBerryCount').textContent = S.items.item_exp_berry || 0;
    $('#btnFeedBerry').disabled = max || !(S.items.item_exp_berry > 0);
    $('#petStars').innerHTML = starsHTML(st.star, 5);
    var R = D.STAR_RULES, nxt = R.dupNeededForStar[st.star + 1];
    $('#petDupCount').textContent = st.star >= R.maxStar ? '—' : st.shards;
    $('#petDupNeed').textContent = st.star >= R.maxStar ? '滿星' : nxt;
    var su = $('#btnStarUp'); su.textContent = '自動'; su.disabled = true; su.title = '重複召喚或旅人交換的碎片會自動升星';
    var vals = { hp: fmt(stats.hp), atk: fmt(stats.atk), def: fmt(stats.def), aspd: stats.aspd + 's', range: P.role === 'guardian' ? '近身' : stats.range, blockcost: (P.role === 'guardian' ? stats.block : 0) + ' / ' + stats.cost };
    $$('#petStats [data-stat]').forEach(function (b) { b.textContent = vals[b.dataset.stat]; });
    $('#petSkillName').textContent = sk.name;
    $('#petSkillCd').textContent = '能量 ' + sk.cd + ' 秒充滿' + (sk.duration ? '・持續 ' + sk.duration + ' 秒' : '') + (P.trait ? '・特性：' + P.trait.desc : '');
    $('#petSkillDesc').textContent = P.skill.desc + (br ? '（路線強化：' + br.desc + '）' : '');
    // 進化頁
    var track = $('#evoTrack'); track.innerHTML = '';
    [0, 1, 2].forEach(function (k) {
      if (k) track.appendChild(el('span', 'evo-arrow', '▶'));
      var step = el('div', 'evo-step' + (st.evo === k ? ' is-current' : k > st.evo ? ' is-future' : ''));
      var a = el('div', 'art'); step.appendChild(a); UI.setArt(a, petArt(id, k), P.fallback); a.classList.toggle('is-shiny', !!st.shiny && k <= st.evo);
      step.appendChild(el('span', '', (k > st.evo ? '？？？' : petName(id, k)) + '<br><small class="t-soft">' + (k ? 'Lv.' + D.EVOLUTION.stages[k - 1].lv : '初始') + '</small>'));
      track.appendChild(step);
    });
    var nx = evoNext(id), lvOk = nx && st.lv >= nx.lv;
    $('#classLockText').textContent = !nx ? '已是最終形態「' + petName(id) + '」' + (br ? '・路線：' + br.name : '') :
      nx.stage === 1 ? (lvOk ? '一階進化：選一條轉職路線（擇一，無法重選）' : 'Lv.' + nx.lv + ' 可一階進化並選擇轉職路線（目前 Lv.' + st.lv + '）') :
      (lvOk ? '二階進化：成為最終形態，全屬性共 +25%' : 'Lv.' + nx.lv + ' 可二階進化（目前 Lv.' + st.lv + '）');
    var grid = $('#branchGrid'); grid.style.display = (nx && nx.stage === 1) || br ? '' : 'none';
    $$('#branchGrid .branch-card').forEach(function (c, i) {
      var b = P.classChange.branches[i];
      c.querySelector('h5').textContent = b.name; c.querySelector('p').textContent = b.desc;
      c.classList.toggle('is-locked', !lvOk && !br);
      c.classList.toggle('is-chosen', !!br && br.id === b.id);
      c.classList.toggle('is-picked', !br && pickBranch === i);
      c.onclick = function () { if (br || !lvOk) { Sound.play('bump'); return; } pickBranch = i; Sound.play('click'); renderPetDetail(); };
    });
    var cost = evoCost(id);
    renderCost($('#classCost'), cost);
    $('#classCost').previousElementSibling.style.display = cost ? '' : 'none';
    var cc = $('#btnClassChange');
    cc.style.display = nx ? '' : 'none';
    if (nx) {
      cc.textContent = nx.stage === 1 ? '一階進化' : '二階進化';
      cc.disabled = !lvOk || (nx.stage === 1 && pickBranch == null) || !canPay(cost);
    }
    // 裝備頁
    $$('#equipSlots .equip-slot').forEach(function (s) {
      var slot = s.dataset.slot, g = gearById(st.gear[slot]);
      s.innerHTML = '';
      s.classList.toggle('is-filled', !!g); s.classList.toggle('is-target', gearSlot === slot);
      s.dataset.q = g ? g.q : '';
      if (g) { var a = el('div', 'art'); s.appendChild(a); UI.setArt(a, D.ASSETS.equipment[RECIPES[g.recipe].asset], RECIPES[g.recipe].fallback); s.appendChild(el('span', 'es-name', QUALITY[g.q].name + D.EQUIP_SLOTS[slot].name)); }
      else s.innerHTML = '<svg class="ico"><use href="' + SLOT_ICON[slot] + '"/></svg>' + D.EQUIP_SLOTS[slot].name;
      s.onclick = function () { gearSlot = gearSlot === slot ? null : slot; Sound.play('click'); renderPetDetail(); };
    });
    var picker = $('#gearPicker'); picker.innerHTML = '';
    if (!gearSlot) { $('#gearPickerLabel').textContent = '點選欄位後，從下方挑選裝備'; return; }
    var list = sortedGear(gearSlot);
    $('#gearPickerLabel').textContent = D.EQUIP_SLOTS[gearSlot].name + '：' + (list.length ? '點裝備穿上，穿上後數值立即更新' : '還沒有這種裝備，到探索 › 鍛造工坊打造');
    if (st.gear[gearSlot]) {
      var un = el('button', 'gear-item is-unequip', '卸下');
      un.addEventListener('click', function () { unequip(id, gearSlot); });
      picker.appendChild(un);
    }
    list.forEach(function (g) {
      if (g.uid === st.gear[gearSlot]) return;
      var d = gearDom(g, function () { equip(id, g.uid); });
      d.title = g.subs.map(function (s) { return statText(s.stat, s.val); }).join('、');
      picker.appendChild(d);
    });
  }
  function equip(id, uid) {
    var g = gearById(uid); if (!g) return;
    if (g.by && S.pets[g.by]) S.pets[g.by].gear[g.slot] = null;
    var st = S.pets[id], old = gearById(st.gear[g.slot]);
    if (old) old.by = null;
    st.gear[g.slot] = uid; g.by = id;
    Sound.play('pop'); UI.toast('穿上 ' + QUALITY[g.q].name + RECIPES[g.recipe].name, 'good');
    markDirty(); renderPetDetail();
  }
  function unequip(id, slot) {
    var st = S.pets[id], g = gearById(st.gear[slot]);
    if (g) g.by = null; st.gear[slot] = null;
    Sound.play('click'); markDirty(); renderPetDetail();
  }
  function feed(mode) {
    var id = curPet, st = S.pets[id]; if (!st || st.lv >= D.LEVEL_RULES.maxLevel) return;
    var per = D.ECONOMY.dewToExp, dew;
    if (mode === 'max') dew = Math.ceil((expNeed(st.lv) - st.exp) / per); else dew = parseInt(mode, 10);
    if (S.dew <= 0) { Sound.play('bump'); UI.toast('露水不夠了，去走走路吧', 'warn'); return; }
    dew = Math.min(dew, S.dew);
    S.dew -= dew;
    var ups = addExp(id, dew * per);
    questAdd('feed', 1);
    afterFeed(id, ups, '餵了 ' + dew + ' 露水（EXP +' + dew * per + '）');
  }
  function feedBerry() {
    var id = curPet, st = S.pets[id]; if (!st || st.lv >= D.LEVEL_RULES.maxLevel) return;
    if (!(S.items.item_exp_berry > 0)) { Sound.play('bump'); UI.toast('沒有元氣森果了，步道與信瓶都撿得到'); return; }
    S.items.item_exp_berry--;
    var ups = addExp(id, D.ITEMS.item_exp_berry.expGain);
    questAdd('feed', 1);
    afterFeed(id, ups, '吃了一顆元氣森果（EXP +' + D.ITEMS.item_exp_berry.expGain + '）');
  }
  function afterFeed(id, ups, msg) {
    Sound.play(ups ? 'levelup' : 'pop');
    UI.toast(ups ? petName(id) + ' 升到 Lv.' + S.pets[id].lv + '！' : msg, ups ? 'good' : '');
    markDirty(); refreshHUD(); renderPetDetail(); renderPets(); refreshDots();
    if (ups && evoQueue.length) setTimeout(function () { UI.closeModal('sheetPet'); }, 350);
  }

  /* =================================================================
   * 19. 進化（Lv.10 一階＋選轉職路線、Lv.30 二階；暖光閃耀揭曉）
   * ================================================================= */
  var evoPetId = null, evoPick = null, evoMode = 'choose';
  function anyModalOpen() { return !!$('.modal-wrap.is-open'); }
  function tryShowEvo() {
    if (!evoQueue.length || anyModalOpen() || $('.overlay-screen.is-open') || $('#app').classList.contains('is-zen')) return;
    var id = evoQueue.shift(), st = S.pets[id], nx = evoNext(id);
    if (!st || !nx || st.lv < nx.lv) return tryShowEvo();
    st.evoPrompted = nx.stage; markDirty();
    openEvo(id);
  }
  function openEvo(id) {
    var st = S.pets[id], nx = evoNext(id), P = PETS[id]; if (!nx) return;
    evoPetId = id; evoPick = null; evoMode = 'choose';
    var stage = $('#evoStage'); stage.classList.remove('is-evolving', 'is-revealed');
    var oa = $('#classArt'); UI.setArt(oa, petArt(id), P.fallback); oa.classList.toggle('is-shiny', !!st.shiny);
    var na = $('#evoNewArt'); UI.setArt(na, petArt(id, nx.stage), P.fallback); na.classList.toggle('is-shiny', !!st.shiny);
    $('#evoTitle').textContent = nx.stage === 1 ? '一階進化' : '二階進化';
    $('#evoChoose').classList.remove('is-hidden'); $('#evoResult').classList.add('is-hidden');
    $('#classIntro').textContent = petName(id) + ' 到達 Lv.' + st.lv + '，' + (nx.stage === 1 ? '可以進化並選擇轉職路線了！' : '可以進化成最終形態了！');
    var bgrid = $('#classBranches'); bgrid.style.display = nx.stage === 1 ? '' : 'none';
    $$('#classBranches .branch-card').forEach(function (c, i) {
      var b = P.classChange.branches[i];
      c.querySelector('h5').textContent = b.name; c.querySelector('p').textContent = b.desc;
      c.classList.remove('is-picked');
      c.onclick = function () { evoPick = i; Sound.play('click'); $$('#classBranches .branch-card').forEach(function (x, j) { x.classList.toggle('is-picked', j === i); }); updateEvoBtn(); };
    });
    renderCost($('#classModalCost'), evoCost(id));
    $('#btnClassLater').style.display = '';
    updateEvoBtn();
    UI.openModal('modalClass');
    Sound.play('unlock');
  }
  function updateEvoBtn() {
    var nx = evoNext(evoPetId), ok = canPay(evoCost(evoPetId)), b = $('#btnClassConfirm');
    b.textContent = ok ? '開始進化' : '素材不足';
    b.disabled = !ok || (nx && nx.stage === 1 && evoPick == null);
  }
  function doEvolve(id, branchIdx) {
    var P = PETS[id], st = S.pets[id], nx = evoNext(id);
    if (!st || !nx || st.lv < nx.lv) return false;
    if (nx.stage === 1 && branchIdx == null) return false;
    var cost = evoCost(id);
    if (!canPay(cost)) { Sound.play('bump'); UI.toast('素材、晶石或星塵不足', 'warn'); return false; }
    pay(cost);
    var fromEvo = st.evo || 0;
    if (nx.stage === 1) st.branch = P.classChange.branches[branchIdx].id;
    st.evo = nx.stage; st.evoPrompted = Math.max(st.evoPrompted || 0, nx.stage);
    markDirty();
    playEvolve(id, fromEvo);
    return true;
  }
  function playEvolve(id, fromEvo) {             // 暖光閃耀揭曉動畫
    var P = PETS[id], st = S.pets[id], br = st.branch ? branchOf(id, st.branch) : null;
    if (!$('#modalClass').classList.contains('is-open')) {
      UI.setArt($('#classArt'), petArt(id, fromEvo), P.fallback);
      UI.openModal('modalClass');
    }
    evoMode = 'anim';
    UI.setArt($('#evoNewArt'), petArt(id), P.fallback);
    $('#classArt').classList.toggle('is-shiny', !!st.shiny); $('#evoNewArt').classList.toggle('is-shiny', !!st.shiny);
    $('#evoChoose').classList.add('is-hidden'); $('#evoResult').classList.add('is-hidden');
    $('#evoTitle').textContent = '進化中…';
    $('#btnClassLater').style.display = 'none';
    var b = $('#btnClassConfirm'); b.disabled = true; b.textContent = '…';
    var stage = $('#evoStage'); stage.classList.remove('is-evolving', 'is-revealed'); void stage.offsetWidth; stage.classList.add('is-evolving');
    Sound.play('evolve');
    setTimeout(function () {
      stage.classList.add('is-revealed');
      Sound.play('hatch'); setTimeout(function () { Sound.play('victory'); }, 250);
      $('#evoTitle').textContent = '進化成功！';
      $('#evoResultName').textContent = petName(id);
      $('#evoResultText').textContent = (st.evo === 2 ? '成為最終形態，全屬性共 +25%' : '全屬性 +10%') + (br ? '・路線「' + br.name + '」' : '');
      $('#evoResult').classList.remove('is-hidden');
      evoMode = 'done'; b.disabled = false; b.textContent = '太好了！';
      Camp.sync(); renderPets(); refreshDots();
      if ($('#sheetPet').classList.contains('is-open')) renderPetDetail();
    }, 2600);
  }

  /* =================================================================
   * 20. 事件綁定
   * ================================================================= */
  function bind() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('.btn,.tab,.hotspot,.stage-node,.trail-node,.pet-card,.recipe-slot,.gear-item,.equip-slot,.seg > button,.hud-pill,.camp-float,.branch-card,.mt-node,.item-chip')) Sound.play('click');
    }, true);
    var unlockAudio = function () { Sound.unlocked = true; Sound.ensure(); };
    var appEl = $('#app'); appEl.addEventListener('scroll', function () { appEl.scrollTop = 0; appEl.scrollLeft = 0; });
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { document.addEventListener(t, unlockAudio, { once: true, passive: true, capture: true }); });

    document.addEventListener('md:tab', function (e) {
      var t = e.detail.tab;
      if (t === 'camp') { Camp.resize(); Camp.sync(); Camp.start(); } else Camp.stop();
      if (t === 'adventure') renderMap();
      if (t === 'explore') { renderTrailEntrance(); renderForge(); }
      if (t === 'pets') renderPets();
    });
    document.addEventListener('md:subtab', function (e) {
      if (e.detail.group === 'petfilter') { petFilter = e.detail.name; renderPets(); }
      if (e.detail.group === 'explore') { if (e.detail.name === 'forge') renderForge(); else renderTrailEntrance(); }
      if (e.detail.group === 'quest') renderQuests();
    });
    document.addEventListener('md:modal-open', function (e) {
      var id = e.detail.id;
      if (id === 'modalSteps') { checkDay(); stepInput = ''; renderSteps(); }
      if (id === 'modalQuests') renderQuests();
      if (id === 'modalPause') B.paused = true;
    });
    document.addEventListener('md:modal-close', function (e) {
      var id = e.detail.id;
      if (id === 'modalPause') B.paused = false;
      if (id === 'modalSummon') { renderPets(); Camp.sync(); refreshDots(); }
      if (id === 'sheetPet') renderPets();
      if (id === 'modalReward' && $('#screen-explore').classList.contains('is-active')) renderTrailEntrance();
      setTimeout(tryShowEvo, 250);
    });
    document.addEventListener('md:building', function (e) { openBuilding(e.detail.id); });
    document.addEventListener('md:key', function (e) { stepKey(e.detail.key); });
    document.addEventListener('md:sound', function (e) { Sound.on = e.detail.on; S.settings.sound = e.detail.on; markDirty(); if (e.detail.on) Sound.play('pop'); });
    document.addEventListener('md:overlay', function (e) {
      if (!e.detail.open && e.detail.id === 'screen-battle' && B.active) endBattle(false, true);
      if (!e.detail.open && e.detail.id === 'screen-trail') renderTrailEntrance();
      if (!e.detail.open && !$('.overlay-screen.is-open') && $('#app').dataset.tab === 'camp') Camp.start();
    });

    $('#btnStepConfirm').addEventListener('click', confirmSteps);
    $('#btnBuildingUpgrade').addEventListener('click', upgradeBuilding);
    $('#btnBuildingAction').addEventListener('click', buildingAction);
    $('#hudStardust').addEventListener('click', function () { UI.toast('星塵：戰鬥、任務取得，用來升級建築與鍛造'); });

    // 營地小奇遇與靜心模式
    $('#campBottle').addEventListener('click', function () { Camp.openBottle(); });
    $('#campBasket').addEventListener('click', function () { Camp.openBasket(); });
    $('#btnZen').addEventListener('click', function () { setZen(true); });
    $('#zenExit').addEventListener('click', function () { setZen(false); });

    // 地圖、關卡、掃蕩
    $('#btnChapterPrev').addEventListener('click', function () { mapChapter = Math.max(0, mapChapter - 1); renderMap(); });
    $('#btnChapterNext').addEventListener('click', function () { mapChapter = Math.min(D.CHAPTERS.length - 1, mapChapter + 1); renderMap(); });
    $('#btnEndless').addEventListener('click', function () {
      if (!stageCleared(D.ENDLESS_MODE.unlock.stageClear)) { Sound.play('bump'); UI.toast('通關 ' + D.ENDLESS_MODE.unlock.stageClear + ' 後解鎖無盡晨霧'); return; }
      openTeam({ mode: 'endless' });
    });
    $('#stageDifficulty').addEventListener('change', function (e) {
      var v = e.detail.value, st = STAGE(stageSel.id);
      if (v === 'hard' && !hardUnlocked(st)) { Sound.play('bump'); UI.toast('通關本章全部普通關卡後解鎖困難'); v = 'normal'; }
      stageSel.diff = v; renderStage();
    });
    $('#btnStageStart').addEventListener('click', function () { UI.closeModal('modalStage'); openTeam({ mode: 'stage', id: stageSel.id, diff: stageSel.diff }); });
    $('#btnSweep').addEventListener('click', doSweep);
    $('#btnTeamGo').addEventListener('click', function () {
      if (!teamPick.length) return;
      S.team = teamPick.slice(); markDirty();
      startBattle(teamCtx);
    });

    // 戰鬥
    $('#btnSpeed').addEventListener('click', function () { B.speed = B.speed === 1 ? 2 : 1; S.settings.speed = B.speed; $('#speedLabel').textContent = B.speed + '×'; markDirty(); });
    $('#btnAuto').addEventListener('click', function () { S.settings.auto = !S.settings.auto; renderAutoBtn(); markDirty(); UI.toast(S.settings.auto ? 'AUTO 開啟：能量滿會自動施放大招' : 'AUTO 關閉：點精靈手動施放'); });
    $('#bfield').addEventListener('click', function () { if (B.selected) { B.selected = null; updatePlacing(); } closeUnitActions(); });
    $('#btnBattleRetry').addEventListener('click', retryBattle);
    $('#btnBattleQuit').addEventListener('click', function () { UI.closeAllModals(); leaveBattle(); });
    $('#btnResultRetry').addEventListener('click', function () { UI.closeAllModals(); startBattle(B.ctx); });
    $('#btnResultNext').addEventListener('click', function () {
      var ctx = B.ctx; UI.closeAllModals(); leaveBattle();
      if (ctx.mode === 'stage') { var st = STAGE(ctx.id), nx = STAGES[STAGES.indexOf(st) + 1]; if (nx) { mapChapter = nx.ci; renderMap(); } }
    });
    window.addEventListener('resize', function () {
      if (B.active) layoutField();
      if ($('#screen-trail').classList.contains('is-open')) layoutTrail();
      if ($('#app').dataset.tab === 'adventure') renderMap();
    });

    // 森林奇遇步道
    $('#btnTrailStart').addEventListener('click', startTrail);
    $('#btnTrailBack').addEventListener('click', function () {
      if (S.trail.active && S.trail.active.finalDone) { finishTrail(); return; }
      UI.closeOverlay('screen-trail');
      if (S.trail.active) UI.toast('步道進度已保存，隨時可以回來繼續');
    });
    $('#btnTrailEventOk').addEventListener('click', onTrailEventOk);

    // 鍛造
    $('#btnCraft').addEventListener('click', craft);
    $('#btnGearSalvage').addEventListener('click', salvageGear);

    // 精靈屋、召喚、進化
    $$('[data-summon]').forEach(function (b) { b.addEventListener('click', function () { doSummon(parseInt(b.dataset.summon, 10)); }); });
    $('#btnSummonAgain').addEventListener('click', function () { doSummon(lastSummonN); });
    $$('[data-feed]').forEach(function (b) { b.addEventListener('click', function () { feed(b.dataset.feed); }); });
    $('#btnFeedBerry').addEventListener('click', feedBerry);
    $('#btnClassChange').addEventListener('click', function () {
      var nx = evoNext(curPet); if (!nx) return;
      if (nx.stage === 1 && pickBranch == null) return;
      var id = curPet; UI.closeModal('sheetPet');
      setTimeout(function () { if (doEvolve(id, pickBranch)) pickBranch = null; }, 250);
    });
    $('#btnClassConfirm').addEventListener('click', function () {
      if (evoMode === 'done') { UI.closeModal('modalClass'); return; }
      if (evoMode !== 'choose') return;
      var nx = evoNext(evoPetId); if (!nx) return;
      if (nx.stage === 1 && evoPick == null) return;
      doEvolve(evoPetId, evoPick);
    });
    $('#btnClassLater').addEventListener('click', function () { UI.closeModal('modalClass'); UI.toast('之後可在精靈屋的「進化」頁進化'); });

    // 存檔時機
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { save(); Camp.stop(); if (B.active && !B.paused) UI.openModal('modalPause'); }
      else { welcomeBack(); if ($('#app').dataset.tab === 'camp' && !$('.overlay-screen.is-open')) Camp.start(); }
    });
    window.addEventListener('pagehide', save);
    setInterval(function () { if (document.hidden) return; save(); if (checkDay()) { refreshDots(); UI.toast('新的一天，每日任務已更新', 'good'); } }, 15000);
  }
  function welcomeBack() {
    if (!S) return;
    var off = settleOffline(); checkDay();
    Camp.placeHotspots();
    if (off.basket) UI.toast('營火旁出現了下班收成籃，點一下領取', 'good');
    else if (off.gain > 0) UI.toast('離線收穫 ' + off.gain + ' 露水', 'good');
    refreshHUD(); refreshDots(); save();
  }

  /* =================================================================
   * 21. 啟動
   * ================================================================= */
  function renderAll() {
    refreshHUD(); refreshBuildingLabels(); refreshDots();
    renderMap(); renderTrailEntrance(); renderForge(); renderPets();
  }
  function init() {
    var isNew = load();
    Sound.on = S.settings.sound !== false;
    $('#btnSound').setAttribute('aria-pressed', Sound.on ? 'true' : 'false');
    var off = isNew ? { gain: 0 } : settleOffline();
    checkDay();
    Object.keys(S.pets).forEach(queueEvoIfReady);
    save();
    bind();
    Camp.init();
    renderAll();
    Camp.start();
    setTimeout(function () {
      UI.hideSplash();
      if (!S.welcomed) {
        S.welcomed = true; markDirty();
        var starter = D.ECONOMY.newPlayer.pets.map(function (id) { return { k: 'pet', id: id, n: 1, tag: '夥伴' }; });
        showRewards('歡迎來到晨露森旅', [{ k: 'dew', n: D.ECONOMY.newPlayer.dew, tag: '新手禮' }].concat(starter), 'hatch');
        setTimeout(function () { UI.toast('點左上角「今日步數」記錄步數換露水', 'good'); }, 2400);
      } else if (off.basket) {
        UI.toast('營火旁出現了下班收成籃，點一下領取', 'good');
      } else if (off.gain > 0) {
        UI.toast('離線收穫 ' + off.gain + ' 露水', 'good');
      }
    }, 650);
  }

  // 測試與除錯用（不影響遊戲）
  window.MorningDew = {
    get save() { return S; }, get battle() { return B; },
    step: function (sec, dt) { dt = dt || 0.05; for (var t = 0; t < sec && B.active; t += dt) update(dt); if (B.active) render(dt); },
    deploy: function (id, spotId) { var sp = B.spots.find(function (s) { return s.id === spotId; }); B.selected = id; onSpotTap(sp); },
    cast: function (id) { var u = B.pets.find(function (p) { return p.id === id; }); if (u) { u.sp = u.skill.cd; castSkill(u); } },
    spawn: function (eid, lane) { return spawnEnemy({ e: eid, lane: lane == null ? 1 : lane, elite: false, hpMul: 1 }); },
    startBattle: startBattle, doSummon: doSummon, craft: craft, feed: function (id, m) { curPet = id; feed(m); },
    startTrail: startTrail, chooseTrail: chooseTrail, openFinalChest: openFinalChest,
    addExp: addExp, petStats: petStats, equip: equip, openPet: openPet, openEvo: openEvo, doEvolve: doEvolve, tryShowEvo: tryShowEvo,
    walkFeedback: function () { return Camp.walkFeedback(); }, spawnBottle: function () { Camp.spawnBottle(); }, settleOffline: settleOffline, welcomeBack: welcomeBack,
    sweep: function (id, diff) { stageSel.id = id; stageSel.diff = diff || 'normal'; doSweep(); },
    saveNow: save,
    reset: function () { localStorage.removeItem(SAVE_KEY); location.reload(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
