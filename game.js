/* =====================================================================
 * 晨露森旅 — game.js（遊戲邏輯層）
 * 依賴：index.html 內的 window.UI（畫面外殼）與 data.js 的 window.GAME_DATA
 * 章節：
 *   0 工具        1 音效        2 存檔／離線收益   3 每日重置／任務   4 獎勵
 *   5 數值計算    6 精靈成長    7 召喚            8 HUD 與紅點       9 營地
 *   10 建築       11 記步數     12 任務抽屜        13 世界地圖        14 出戰選擇
 *   15 塔防戰鬥   16 迷宮       17 鍛造           18 精靈屋與詳情    19 轉職
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
  var MAZE = function (id) { return D.MAZE_MAPS.find(function (m) { return m.id === id; }); };
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
        case 'wave':    T(392, 0.2, { vol: 0.08, type: 'triangle' }); T(523, 0.3, { at: 0.12, vol: 0.08, type: 'triangle' }); break;
      }
    }
  };

  /* =================================================================
   * 2. 存檔（localStorage 自動存檔、版本遷移、離線露水）
   * ================================================================= */
  var SAVE_KEY = D.META.saveKey;
  var SAVE_VERSION = 2;
  var S = null;
  var dirtyTimer = 0;

  function newPetState() {
    return { lv: 1, exp: 0, star: 1, shards: 0, branch: null, classPrompted: false, gear: { wrist: null, pendant: null, hair: null }, got: now() };
  }
  function newSave() {
    var pets = {};
    D.ECONOMY.newPlayer.pets.forEach(function (id) { pets[id] = newPetState(); });
    var t = now();
    return {
      v: SAVE_VERSION, dataVersion: D.META.dataVersion, created: t, lastSeen: t, offlineAcc: 0,
      dew: D.ECONOMY.newPlayer.dew, coins: 0, tickets: 0,
      mats: { mat_01: 0, mat_02: 0, mat_03: 0 },
      pets: pets, gear: [], gearSeq: 1,
      buildings: { campfire: 1, nest: 1, workshop: 1 },
      stages: {}, mazes: {},
      summon: { pity: 0, total: 0 },
      steps: { day: dayKey(t), today: 0, dewToday: 0, lifetime: 0, claimed: [], lifeClaimed: [] },
      daily: { day: dayKey(t), prog: {}, claimed: [], chests: [], endlessRuns: 0, freeDew: false, mazeReplay: [] },
      endless: { best: 0, claimed: [] },
      titles: [],
      team: D.ECONOMY.newPlayer.pets.slice(),
      settings: { sound: true, speed: 1 },
      welcomed: false
    };
  }
  function migrate(o) {
    var m = deepMerge(newSave(), o);
    if (!o.pets) m.pets = newSave().pets;
    Object.keys(m.pets).forEach(function (id) {
      if (!PETS[id]) { delete m.pets[id]; return; }
      m.pets[id] = deepMerge(newPetState(), m.pets[id]);
    });
    m.gear = (m.gear || []).filter(function (g) { return RECIPES[g.recipe]; });
    m.gear.forEach(function (g) { if (!QUALITY[g.q]) g.q = 'epic'; if (g.by && !m.pets[g.by]) g.by = null; });
    Object.keys(m.mats).forEach(function (k) { if (!D.MATERIALS[k]) delete m.mats[k]; });
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

  function settleOffline() {
    var last = S.lastSeen || now();
    var hours = clamp((now() - last) / 3600000, 0, D.ECONOMY.offlineMaxHours);
    S.offlineAcc = (S.offlineAcc || 0) + hours * campEff().offlineDewPerHour;
    var gain = Math.floor(S.offlineAcc);
    S.offlineAcc -= gain;
    S.dew += gain;
    S.lastSeen = now();
    return { gain: gain, hours: hours };
  }

  /* =================================================================
   * 3. 每日重置與任務
   * ================================================================= */
  function checkDay() {
    var k = dayKey();
    if (S.daily.day === k) return false;
    S.daily = { day: k, prog: {}, claimed: [], chests: [], endlessRuns: 0, freeDew: false, mazeReplay: [] };
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
   * 4. 獎勵
   * ================================================================= */
  function grant(rew, mul) {
    mul = mul || 1; var out = [];
    if (!rew) return out;
    if (rew.dew) { var d = Math.round(rew.dew * mul); S.dew += d; out.push({ k: 'dew', n: d }); }
    if (rew.coins) { var c = Math.round(rew.coins * mul); S.coins += c; out.push({ k: 'coins', n: c }); }
    if (rew.summonTicket) { S.tickets += rew.summonTicket; out.push({ k: 'ticket', n: rew.summonTicket }); }
    if (rew.mats) Object.keys(rew.mats).forEach(function (m) { var n = Math.max(1, Math.round(rew.mats[m] * mul)); S.mats[m] = (S.mats[m] || 0) + n; out.push({ k: m, n: n }); });
    if (rew.title) { if (S.titles.indexOf(rew.title) < 0) S.titles.push(rew.title); out.push({ k: 'title', n: rew.title }); }
    markDirty(); refreshHUD();
    return out;
  }
  function mergeRewards(list) {
    var map = {}, order = [];
    list.forEach(function (r) {
      if (r.k === 'title' || r.k === 'pet' || r.k === 'exp') { order.push(r); return; }
      if (!map[r.k]) { map[r.k] = { k: r.k, n: 0 }; order.push(map[r.k]); }
      map[r.k].n += r.n;
    });
    return order;
  }
  function rewardChip(r, i) {
    var c = UI.tpl('reward-chip'); c.style.setProperty('--i', i || 0);
    var svg = c.querySelector('svg'), lbl = c.querySelector('span');
    var icon = { dew: '#i-dew', coins: '#i-stardust', ticket: '#i-ticket', title: '#i-flag', exp: '#i-star' }[r.k];
    if (D.MATERIALS[r.k] || r.k === 'pet') {
      var a = el('div', 'art'); svg.replaceWith(a);
      if (r.k === 'pet') UI.setArt(a, D.ASSETS.pets[r.id], PETS[r.id].fallback);
      else UI.setArt(a, D.ASSETS.materials[r.k], D.MATERIALS[r.k].fallback);
    } else if (icon) svg.querySelector('use').setAttribute('href', icon);
    lbl.textContent = r.k === 'title' ? r.n : r.k === 'pet' ? PETS[r.id].name : r.k === 'exp' ? 'EXP ' + fmt(r.n) : '×' + fmt(r.n);
    if (r.tag) { var t = el('span', 'rc-tag'); t.textContent = r.tag; c.appendChild(t); }
    return c;
  }
  function renderRewards(box, list) {
    box.innerHTML = '';
    if (!list.length) { box.appendChild(el('p', 't-small t-soft', '這次沒有額外獎勵')); return; }
    list.forEach(function (r, i) { box.appendChild(rewardChip(r, i)); });
  }
  function showRewards(title, list, snd) {
    $('#rewardTitle').textContent = title;
    renderRewards($('#rewardList'), mergeRewards(list));
    UI.openModal('modalReward');
    Sound.play(snd || 'coin');
  }
  function costItem(matOrKey, have, need) {
    var c = UI.tpl('cost-item'), a = c.querySelector('.art');
    if (matOrKey === 'coins' || matOrKey === 'dew') {
      a.outerHTML = '<svg class="ico" style="font-size:26px"><use href="' + (matOrKey === 'coins' ? '#i-stardust' : '#i-dew') + '"/></svg>';
    } else UI.setArt(a, D.ASSETS.materials[matOrKey], D.MATERIALS[matOrKey].fallback);
    c.querySelector('.t-num').textContent = need == null ? fmt(have) : fmt(have) + ' / ' + fmt(need);
    if (need != null && have < need) c.classList.add('is-short');
    return c;
  }
  function canPay(cost, matMul) {
    if (!cost) return true;
    if (cost.coins && S.coins < cost.coins) return false;
    var ok = true;
    Object.keys(cost.mats || {}).forEach(function (m) { if ((S.mats[m] || 0) < matNeed(cost.mats[m], matMul)) ok = false; });
    return ok;
  }
  function pay(cost, matMul) {
    if (cost.coins) S.coins -= cost.coins;
    Object.keys(cost.mats || {}).forEach(function (m) { S.mats[m] -= matNeed(cost.mats[m], matMul); });
    markDirty(); refreshHUD();
  }
  function matNeed(n, mul) { return mul == null ? n : Math.max(1, Math.ceil(n * mul)); }
  function renderCost(box, cost, matMul) {
    box.innerHTML = '';
    if (!cost) return;
    if (cost.coins) box.appendChild(costItem('coins', S.coins, cost.coins));
    Object.keys(cost.mats || {}).forEach(function (m) { box.appendChild(costItem(m, S.mats[m] || 0, matNeed(cost.mats[m], matMul))); });
  }

  /* =================================================================
   * 5. 數值計算（等級、星級、轉職、裝備、營火即時套用）
   * ================================================================= */
  function branchOf(id, bid) { return PETS[id].classChange.branches.find(function (b) { return b.id === bid; }) || null; }
  function gearById(uid) { return S.gear.find(function (g) { return g.uid === uid; }) || null; }
  function petStats(id) {
    var P = PETS[id], st = S.pets[id], lv = st ? st.lv : 1, b = P.base, g = P.growth;
    var hp = b.hp + g.hp * (lv - 1), atk = b.atk + g.atk * (lv - 1), def = b.def + g.def * (lv - 1);
    var starMul = 1 + D.STAR_RULES.statBonusPctPerStar * ((st ? st.star : 1) - 1) / 100;
    hp *= starMul; atk *= starMul; def *= starMul;
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
   * 6. 精靈成長（經驗、升級、碎片升星）
   * ================================================================= */
  var classQueue = [];
  function expNeed(lv) { return D.LEVEL_RULES.expToNext[lv - 1] || Infinity; }
  function addExp(id, n) {
    var st = S.pets[id]; if (!st || n <= 0) return 0;
    var max = D.LEVEL_RULES.maxLevel, ups = 0;
    if (st.lv >= max) return 0;
    st.exp += Math.round(n);
    while (st.lv < max && st.exp >= expNeed(st.lv)) {
      st.exp -= expNeed(st.lv); st.lv++; ups++;
      if (st.lv >= D.LEVEL_RULES.classChangeLevel && !st.branch && !st.classPrompted && classQueue.indexOf(id) < 0) classQueue.push(id);
    }
    if (st.lv >= max) st.exp = 0;
    markDirty();
    return ups;
  }
  function obtainPet(id) {
    var st = S.pets[id];
    if (!st) { S.pets[id] = newPetState(); return { id: id, isNew: true }; }
    var R = D.STAR_RULES;
    if (st.star < R.maxStar) {
      st.shards++;
      var up = 0;
      while (st.star < R.maxStar && st.shards >= R.dupNeededForStar[st.star + 1]) { st.shards -= R.dupNeededForStar[st.star + 1]; st.star++; up = st.star; }
      return { id: id, shard: true, starUp: up };
    }
    var exp = Math.round(D.RARITIES[PETS[id].rarity].dupExpAfterMaxStar * (1 + nestEff().dupExpBonusPct / 100));
    addExp(id, exp);
    return { id: id, exp: exp };
  }

  /* =================================================================
   * 7. 召喚（開蛋動畫、保底、重複轉碎片自動升星）
   * ================================================================= */
  var lastSummonN = 1;
  function summonCost(n) {
    var one = nestEff().summonCostDew;
    return n === 1 ? one : Math.round(one * D.SUMMON.multiCostDew / D.SUMMON.costDew);
  }
  function rollRarity() {
    var e = nestEff(), r = D.SUMMON.rates;
    return weighted([['R', r.R - e.srRateBonus - e.ssrRateBonus], ['SR', r.SR + e.srRateBonus], ['SSR', r.SSR + e.ssrRateBonus]]);
  }
  function doSummon(n) {
    var useTicket = n === 1 && S.tickets > 0;
    var cost = useTicket ? 0 : summonCost(n);
    if (!useTicket && S.dew < cost) { Sound.play('bump'); UI.toast('露水不夠了，去走走路收集露水吧', 'warn'); return false; }
    if (useTicket) S.tickets--; else S.dew -= cost;
    var rar = [];
    for (var i = 0; i < n; i++) {
      S.summon.pity++;
      var r = rollRarity();
      if (S.summon.pity >= D.SUMMON.pitySSR) r = 'SSR';
      if (r === 'SSR') S.summon.pity = 0;
      rar.push(r);
    }
    if (n >= D.SUMMON.multiCount && D.SUMMON.multiGuaranteeSR && rar.every(function (x) { return x === 'R'; })) rar[n - 1] = 'SR';
    var outs = rar.map(function (r) { return Object.assign(obtainPet(pick(D.SUMMON.poolByRarity[r])), { rarity: r }); });
    S.summon.total += n; lastSummonN = n;
    questAdd('summon', n);
    markDirty(); refreshHUD();
    playSummon(outs);
    return true;
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
      var best = outs.some(function (o) { return o.rarity === 'SSR'; }) ? 'SSR' : outs.some(function (o) { return o.rarity === 'SR'; }) ? 'SR' : 'R';
      stage.dataset.best = best;
      ribbon.textContent = outs.some(function (o) { return o.isNew; }) ? '遇見新夥伴！' : '孵化完成';
      Sound.play('hatch');
      outs.forEach(function (o, i) {
        var c = petCard(o.id); c.style.setProperty('--i', i);
        if (o.isNew) c.classList.add('is-new');
        var lv = c.querySelector('.pc-lv');
        lv.textContent = o.isNew ? '新夥伴' : o.starUp ? '升到 ★' + o.starUp : o.shard ? '碎片 +1' : 'EXP +' + o.exp;
        box.appendChild(c);
      });
      if (outs.length === 1) box.style.gridTemplateColumns = 'repeat(3, 1fr)'; else box.style.gridTemplateColumns = '';
      if (outs.length === 1) { box.insertBefore(el('div'), box.firstChild); }
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
    UI.setDot('pets', canSummon || Object.keys(S.pets).some(function (id) { var s = S.pets[id]; return s.lv >= D.LEVEL_RULES.classChangeLevel && !s.branch; }));
    UI.setDot('explore', D.MAZE_MAPS.some(function (m) { return mazeUnlocked(m) && !(S.mazes[m.id] && S.mazes[m.id].clear); }));
    var next = STAGES.find(function (s) { return stageUnlocked(s) && !stageCleared(s.id); });
    UI.setDot('adventure', !!next);
  }

  /* =================================================================
   * 9. 營地（Canvas 精靈散步、呼吸、點擊跳躍冒愛心）
   * ================================================================= */
  var Camp = {
    canvas: null, ctx: null, pets: [], hearts: [], imgs: {}, ratio: null, running: false, last: 0, W: 0, H: 0, dpr: 1, talkT: 0,
    AREA: { x0: 18, x1: 82, y0: 52, y1: 82 },          // 散步範圍：bg_camp.png 的百分比座標
    LINES: ['今天也一起散步吧！', '露水亮晶晶的～', '呼～草地好軟', '要去冒險了嗎？', '走了好多步，好厲害！', '營火暖暖的', '肚子有點餓了…', '嘿嘿，抓不到我～'],
    init: function () {
      this.canvas = $('#campCanvas'); this.ctx = this.canvas.getContext('2d');
      var self = this;
      var im = new Image(); im.onload = function () { self.ratio = im.naturalWidth / im.naturalHeight; self.resize(); }; im.src = D.ASSETS.backgrounds.camp;
      this.placeHotspots();
      window.addEventListener('resize', function () { self.resize(); });
      this.canvas.addEventListener('pointerdown', function (e) { self.tap(e); });
      this.resize(); this.sync();
    },
    resize: function () {
      var r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = r.width; this.H = r.height;
      this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
      this.placeHotspots();
    },
    placeHotspots: function () {                       // 建築木牌對齊 bg_camp.png 上的營火、帳篷、木頭堆
      if (!this.W) return;
      var R = this.rect(), W = this.W;
      D.CAMP_BUILDINGS.forEach(function (b) {
        var hs = document.querySelector('.hotspot[data-building="' + b.id + '"]'); if (!hs || !b.pos) return;
        hs.style.setProperty('--x', clamp(R.x + b.pos.x / 100 * R.w, 70, W - 70) + 'px');
        hs.style.setProperty('--y', (R.y + b.pos.y / 100 * R.h) + 'px');
      });
    },
    rect: function () {                                // 背景圖以 cover＋置底 繪製時，圖片在畫面上的實際範圍
      var W = this.W, H = this.H;
      if (!this.ratio) return { x: 0, y: 0, w: W, h: H };
      var w = W, h = W / this.ratio; if (h < H) { h = H; w = H * this.ratio; }
      return { x: (W - w) / 2, y: H - h, w: w, h: h };
    },
    toPx: function (xp, yp) { var R = this.rect(); return [clamp(R.x + xp / 100 * R.w, this.W * 0.06, this.W * 0.94), R.y + yp / 100 * R.h]; },
    img: function (id) {
      if (!this.imgs[id]) { var im = new Image(); im.src = D.ASSETS.pets[id]; this.imgs[id] = im; }
      return this.imgs[id];
    },
    sync: function () {                                // 依存檔同步營地精靈
      var A = this.AREA, self = this;
      var ids = Object.keys(S.pets);
      this.pets = this.pets.filter(function (p) { return ids.indexOf(p.id) >= 0; });
      ids.forEach(function (id) {
        if (self.pets.some(function (p) { return p.id === id; })) return;
        var x = rand(A.x0 + 4, A.x1 - 4), y = rand(A.y0 + 3, A.y1 - 3);
        self.pets.push({ id: id, x: x, y: y, tx: x, ty: y, wait: rand(0.5, 2.5), walking: false, face: 1, ph: rand(0, 6.28), jump: 0, spawn: 0 });
        self.img(id);
      });
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
          var sp = 5.5 * dt;                           // 每秒走 5.5% 圖寬
          if (dist <= sp) { p.x = p.tx; p.y = p.ty; p.walking = false; p.wait = rand(1.2, 4.5); }
          else { p.x += dx / dist * sp; p.y += dy / dist * sp * 0.8; if (Math.abs(dx) > 0.3) p.face = dx > 0 ? 1 : -1; }
        } else {
          p.wait -= dt;
          if (p.wait <= 0) {
            p.tx = clamp(p.x + rand(-22, 22), A.x0, A.x1); p.ty = clamp(p.y + rand(-12, 12), A.y0, A.y1);
            p.walking = true;
          }
        }
      });
      // 輕微互斥，避免疊在一起
      for (var i = 0; i < this.pets.length; i++) for (var j = i + 1; j < this.pets.length; j++) {
        var a = this.pets[i], b = this.pets[j], dx = b.x - a.x, dy = (b.y - a.y) * 1.6, d = Math.hypot(dx, dy);
        if (d > 0 && d < 9) { var push = (9 - d) * 0.5 * dt * 4; a.x -= dx / d * push; b.x += dx / d * push; a.y -= dy / d * push * 0.5; b.y += dy / d * push * 0.5; }
      }
      this.pets.forEach(function (p) { p.x = clamp(p.x, A.x0, A.x1); p.y = clamp(p.y, A.y0, A.y1); });
      this.hearts = this.hearts.filter(function (h) { h.t += dt; h.y -= dt * 46; h.x += Math.sin(h.t * 6 + h.ph) * dt * 18; return h.t < 1.2; });
      this.talkT -= dt;
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
        // 影子
        c.fillStyle = 'rgba(55,70,40,' + (0.26 - jumpH / s * 0.12) + ')';
        c.beginPath(); c.ellipse(x, y, s * 0.32 * (1 - jumpH / s * 0.4), s * 0.09, 0, 0, Math.PI * 2); c.fill();
        var sx = (1 + breath * 0.035) * (p.walking ? 1 : 1), sy = 1 - breath * 0.035;
        if (p.jump > 0.85) { sx *= 1.12; sy *= 0.86; }
        c.save();
        c.translate(x, y - bob - jumpH);
        c.scale(sx * p.face, sy);
        var im = self.imgs[p.id];
        if (im && im.complete && im.naturalWidth) {
          var ar = im.naturalWidth / im.naturalHeight, w = ar >= 1 ? s : s * ar, h = ar >= 1 ? s / ar : s;
          c.drawImage(im, -w / 2, -h, w, h);
        } else self.drawFallback(c, PETS[p.id], s, p.face);
        c.restore();
      });
      this.hearts.forEach(function (h) {
        var a = 1 - h.t / 1.2, sc = h.s * (0.6 + Math.min(1, h.t * 4) * 0.4);
        c.save(); c.globalAlpha = a; c.translate(h.x, h.y); c.scale(sc, sc);
        c.fillStyle = '#F08B7E'; c.strokeStyle = '#B85F55'; c.lineWidth = 1.5 / sc;
        c.beginPath(); c.moveTo(0, 6); c.bezierCurveTo(-10, -2, -6, -12, 0, -6); c.bezierCurveTo(6, -12, 10, -2, 0, 6); c.closePath(); c.fill(); c.stroke();
        c.restore();
      });
    },
    drawFallback: function (c, P, s, face) {           // 沒放圖時：柔和果凍色塊＋字
      var col = P.fallback.color, r = s * 0.42;
      var g = c.createRadialGradient(-r * 0.3, -r * 1.3, r * 0.1, 0, -r, r * 1.1);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.35, col); g.addColorStop(1, col);
      c.fillStyle = g; c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, -r, r, r * 0.95, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#4B3F32';
      c.beginPath(); c.arc(-r * 0.3, -r * 1.05, r * 0.08, 0, 7); c.arc(r * 0.3, -r * 1.05, r * 0.08, 0, 7); c.fill();
      c.fillStyle = 'rgba(235,150,140,.6)';
      c.beginPath(); c.ellipse(-r * 0.5, -r * 0.82, r * 0.12, r * 0.07, 0, 0, 7); c.ellipse(r * 0.5, -r * 0.82, r * 0.12, r * 0.07, 0, 0, 7); c.fill();
      c.save(); c.scale(face, 1);
      c.fillStyle = '#FFFFFF'; c.font = '800 ' + Math.round(r * 0.55) + 'px ' + getComputedStyle(document.body).fontFamily;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(P.fallback.glyph, 0, -r * 0.45);
      c.restore();
    },
    tap: function (e) {
      var r = this.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, self = this;
      var hit = this.pets.slice().sort(function (a, b) { return b.y - a.y; }).find(function (p) {
        var pos = self.toPx(p.x, p.y), s = self.size(p);
        return Math.abs(mx - pos[0]) < s * 0.45 && my < pos[1] + s * 0.1 && my > pos[1] - s * 1.05;
      });
      if (!hit) return;
      if (hit.jump <= 0.2) hit.jump = 1;
      hit.walking = false; hit.wait = rand(1, 2);
      var pos = this.toPx(hit.x, hit.y), s = this.size(hit);
      for (var i = 0; i < 3; i++) this.hearts.push({ x: pos[0] + rand(-s * 0.25, s * 0.25), y: pos[1] - s * 0.9, t: -i * 0.12, ph: rand(0, 6), s: rand(0.9, 1.3) });
      Sound.play('pop'); setTimeout(function () { Sound.play('heart'); }, 120);
      if (this.talkT <= 0 && Math.random() < 0.6) { this.talkT = 3; this.say(hit, pos, s); }
    },
    say: function (p, pos, s) {
      var b = el('div', 'speech'); b.textContent = pick(this.LINES);
      b.style.left = pos[0] + 'px'; b.style.top = (pos[1] - s * 1.1) + 'px';
      $('#campPets').appendChild(b);
      setTimeout(function () { b.remove(); }, 2200);
    }
  };

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
    if (r.mats) Object.keys(r.mats).forEach(function (m) { p.push(D.MATERIALS[m].name + ' ' + r.mats[m]); });
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
  var QUEST_ICON = { stepsInput: '#i-steps', battleWin: '#i-swords', summon: '#i-nest', feed: '#i-dew', craft: '#i-anvil', mazeClear: '#i-tab-explore', skillCast: '#i-star', endlessWave: '#i-infinity' };
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
   * 15. 塔防戰鬥（S 型路徑、部署點、飛射物、主動技、結算）
   * ================================================================= */
  var BR = D.BATTLE_RULES;
  var B = { active: false };
  var bfRatio = 9 / 16;
  (function probeBattleBg() { var im = new Image(); im.onload = function () { bfRatio = im.naturalWidth / im.naturalHeight; if (B.active) layoutField(); }; im.src = D.ASSETS.backgrounds.battle; })();
  var uidSeq = 1;

  function layoutField() {
    var wrap = $('#bfWrap'), W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    var w = W, h = W / bfRatio; if (h > H) { h = H; w = H * bfRatio; }
    var f = $('#bfield');
    f.style.setProperty('--bf-w', w + 'px'); f.style.setProperty('--bf-h', h + 'px'); f.style.setProperty('--bw', w + 'px');
    B.W = w; B.H = h;
    B.pts = BR.path.map(function (p) { return [p[0] / 100 * w, p[1] / 100 * h]; });
    B.cum = [0];
    for (var i = 1; i < B.pts.length; i++) B.cum.push(B.cum[i - 1] + Math.hypot(B.pts[i][0] - B.pts[i - 1][0], B.pts[i][1] - B.pts[i - 1][1]));
    B.total = B.cum[B.cum.length - 1];
    drawBattleFallback();
    positionSpots();
  }
  function pathAt(prog) {                          // prog：0~1 → 畫面像素座標與方向
    var s = clamp(prog, 0, 1) * B.total, i = 1;
    while (i < B.cum.length - 1 && B.cum[i] < s) i++;
    var a = B.pts[i - 1], b = B.pts[i], seg = B.cum[i] - B.cum[i - 1] || 1, t = (s - B.cum[i - 1]) / seg;
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * t, y: a[1] + dy * t, nx: -dy / len, ny: dx / len, dx: dx };
  }
  function smoothPathD(pts) {                      // Catmull-Rom 平滑路徑
    var d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6) + ',' + (p2[0] - (p3[0] - p1[0]) / 6) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6) + ',' + p2[0] + ' ' + p2[1];
    }
    return d;
  }
  function drawBattleFallback() {                  // bg_battle.png 未放入時的手繪戰場（與路徑座標完全對齊）
    var W = B.W, H = B.H, svg = $('#bfFallback'), P = B.pts, d = smoothPathD(P);
    var tile = W * 0.17, h = '';
    h += '<defs><linearGradient id="bfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9CC9A"/><stop offset="1" stop-color="#9DB582"/></linearGradient>' +
      '<radialGradient id="bfv" cx=".5" cy=".5" r=".7"><stop offset=".65" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2E3829" stop-opacity=".35"/></radialGradient></defs>';
    h += '<rect width="' + W + '" height="' + H + '" fill="url(#bfg)"/>';
    var trees = [[4, 4], [12, 30], [92, 6], [96, 30], [6, 92], [92, 90], [40, 64], [62, 40], [8, 56], [94, 52], [34, 26], [70, 86], [20, 96], [86, 70]];
    trees.forEach(function (t, i) {
      var x = t[0] / 100 * W, y = t[1] / 100 * H, r = W * (0.05 + (i % 3) * 0.012);
      h += '<circle cx="' + x + '" cy="' + (y + r * 0.5) + '" r="' + r * 0.9 + '" fill="rgba(60,80,45,.25)"/><circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#7C9869"/><circle cx="' + (x - r * 0.3) + '" cy="' + (y - r * 0.3) + '" r="' + r * 0.45 + '" fill="#9DB887"/>';
    });
    for (var f = 0; f < 40; f++) { var fx = ((f * 37) % 100) / 100 * W, fy = ((f * 61) % 100) / 100 * H; h += '<circle cx="' + fx + '" cy="' + fy + '" r="' + (W * 0.007) + '" fill="' + ['#F6EEDA', '#EBB9B2', '#F0D488'][f % 3] + '" opacity=".85"/>'; }
    h += '<path d="' + d + '" fill="none" stroke="#B49B6E" stroke-width="' + W * 0.13 + '" stroke-linecap="round" stroke-linejoin="round"/>';
    h += '<path d="' + d + '" fill="none" stroke="#DCC79C" stroke-width="' + W * 0.11 + '" stroke-linecap="round" stroke-linejoin="round"/>';
    h += '<path d="' + d + '" fill="none" stroke="#E9DCBC" stroke-width="' + W * 0.03 + '" stroke-linecap="round" stroke-dasharray="' + W * 0.02 + ' ' + W * 0.05 + '" opacity=".8"/>';
    BR.supportSpots.forEach(function (s) {
      var x = s.x / 100 * W - tile / 2, y = s.y / 100 * H - tile / 2;
      h += '<rect x="' + x + '" y="' + (y + 4) + '" width="' + tile + '" height="' + tile + '" rx="' + tile * 0.26 + '" fill="#6F8C5D"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + tile + '" height="' + tile + '" rx="' + tile * 0.26 + '" fill="#C2D6A2" stroke="#7C9767" stroke-width="2.5"/>' +
        '<path d="M' + (x + tile * 0.3) + ' ' + (y + tile * 0.62) + 'q4 -10 6 -14M' + (x + tile * 0.62) + ' ' + (y + tile * 0.4) + 'q3 -8 5 -11" stroke="#83A16E" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    });
    var g = P[P.length - 1];                         // 木門營地
    h += '<g transform="translate(' + g[0] + ' ' + g[1] + ')"><rect x="' + (-W * 0.1) + '" y="' + (-W * 0.07) + '" width="' + W * 0.2 + '" height="' + W * 0.09 + '" rx="6" fill="#B98A5B" stroke="#6B4A2F" stroke-width="3"/>' +
      '<path d="M' + (-W * 0.06) + ' ' + (-W * 0.07) + 'v' + W * 0.09 + 'M0 ' + (-W * 0.07) + 'v' + W * 0.09 + 'M' + W * 0.06 + ' ' + (-W * 0.07) + 'v' + W * 0.09 + '" stroke="#8B6440" stroke-width="3"/>' +
      '<path d="M' + (-W * 0.12) + ' ' + (-W * 0.07) + 'L0 ' + (-W * 0.13) + 'L' + W * 0.12 + ' ' + (-W * 0.07) + 'Z" fill="#7C9767" stroke="#556E47" stroke-width="3" stroke-linejoin="round"/></g>';
    var s0 = P[0];                                   // 起點迷霧
    h += '<g opacity=".9"><circle cx="' + (s0[0] - W * 0.06) + '" cy="' + (s0[1] + W * 0.02) + '" r="' + W * 0.06 + '" fill="#fff"/><circle cx="' + s0[0] + '" cy="' + s0[1] + '" r="' + W * 0.08 + '" fill="#fff"/><circle cx="' + (s0[0] + W * 0.07) + '" cy="' + (s0[1] + W * 0.02) + '" r="' + W * 0.055 + '" fill="#fff"/></g>';
    h += '<rect width="' + W + '" height="' + H + '" fill="url(#bfv)"/>';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = h;
  }
  function buildSpots() {
    var box = $('#bfSpots'); box.innerHTML = ''; B.spots = [];
    BR.guardianSpots.forEach(function (g) {
      var p = BR.path[g.pathIndex], e = el('div', 'bf-spot is-guard');
      B.spots.push({ id: g.id, type: 'guard', xp: p[0], yp: p[1], prog: 0, pathIndex: g.pathIndex, el: e, unit: null });
      box.appendChild(e);
    });
    BR.supportSpots.forEach(function (s) {
      var e = el('div', 'bf-spot is-support');
      B.spots.push({ id: s.id, type: 'support', xp: s.x, yp: s.y, el: e, unit: null });
      box.appendChild(e);
    });
    B.spots.forEach(function (sp) { sp.el.addEventListener('click', function (ev) { ev.stopPropagation(); onSpotTap(sp); }); });
  }
  function positionSpots() {
    if (!B.spots) return;
    B.spots.forEach(function (sp) {
      sp.el.style.left = sp.xp + '%'; sp.el.style.top = sp.yp + '%';
      sp.x = sp.xp / 100 * B.W; sp.y = sp.yp / 100 * B.H;
      if (sp.type === 'guard') sp.prog = B.cum[sp.pathIndex] / B.total;
      if (sp.unit) { sp.unit.x = sp.x; sp.unit.y = sp.y; }
    });
  }

  /* ---------- 開戰 ---------- */
  function startBattle(ctx) {
    UI.closeAllModals();
    B = { active: true, ctx: ctx, mode: ctx.mode, t: 0, lastTs: 0, paused: false, speed: S.settings.speed || 1,
      lives: ctx.mode === 'endless' ? D.ENDLESS_MODE.lives : BR.lives, livesMax: ctx.mode === 'endless' ? D.ENDLESS_MODE.lives : BR.lives,
      energy: BR.energy.start, pets: [], enemies: [], projs: [], selected: null, totalCost: 0, loot: { coins: 0, mats: {} },
      waveShown: 0, kills: 0, team: S.team.filter(function (id) { return S.pets[id]; }).slice(0, BR.teamSize), cards: {}, uiT: 0, hintHidden: false };
    if (ctx.mode === 'stage') {
      B.stage = STAGE(ctx.id); B.diff = ctx.diff;
      B.queue = buildSchedule(B.stage); B.waveTotal = B.stage.waves.length;
    } else { B.diff = 'normal'; B.queue = []; B.waveTotal = 0; B.endlessWave = 0; B.nextWaveT = 4; }
    B.team.forEach(function (id) { B.cards[id] = { cdUntil: 0, deployed: null }; });
    $('#battleUnits').innerHTML = ''; $('#battleFx').innerHTML = '';
    $('#speedLabel').textContent = B.speed + '×';
    $('#dockHint').style.display = '';
    $('#dockHint').textContent = '點選下方精靈，再點發光的位置部署';
    UI.openOverlay('screen-battle');
    Camp.stop();
    requestAnimationFrame(function () {
      layoutField(); buildSpots(); positionSpots(); renderDeployBar(); renderBattleHUD();
      B.lastTs = performance.now();
      requestAnimationFrame(battleLoop);
    });
  }
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
      items.push({ t: t0 + n * 1.3 + 2, wave: w, e: EM.bossEnemy, lane: 1, elite: false, hpMul: hm });
    }
    B.queue = B.queue.concat(items);
    B.nextWaveT = items[items.length - 1].t + EM.waveInterval;
  }
  function enemyMul() {
    if (B.mode === 'endless') {
      var sc = D.ENDLESS_MODE.scaling, w = B.endlessWave;
      return { hp: sc.statBase * (1 + sc.hpPerWave * (w - 1)), atk: sc.statBase * (1 + sc.atkPerWave * (w - 1)), def: sc.statBase * (1 + sc.defPerWave * (w - 1)), spd: 1 };
    }
    var dm = D.DIFFICULTY[B.diff], m = B.stage.statMul;
    return { hp: m * dm.hpMul, atk: m * dm.atkMul, def: m * dm.defMul, spd: dm.speedMul };
  }
  function spawnEnemy(item) {
    var E = ENEMIES[item.e], M = enemyMul(), EL = item.elite ? D.ELITE_MODIFIER : null;
    var hp = E.stats.hp * M.hp * (EL ? EL.hpMul : 1) * item.hpMul;
    var en = {
      uid: uidSeq++, id: item.e, E: E, side: 'enemy', el: E.element, elite: item.elite, boss: E.isBoss,
      hp: hp, maxHp: hp, atk: E.stats.atk * M.atk * (EL ? EL.atkMul : 1), def: E.stats.def * M.def * (EL ? EL.defMul : 1),
      speed: E.stats.speed * M.spd, atkInt: E.stats.atkInterval, atkT: E.stats.atkInterval * 0.5,
      prog: 0, lane: (item.lane - 1) * BR.laneOffsetPct / 100 + rand(-0.008, 0.008), blockedBy: null,
      stunT: 0, slowT: 0, slowPct: 0, shockT: E.special && E.special.type === 'shockwave' ? E.special.interval * 0.6 : 0,
      dotAcc: 0, dotShow: 0, scale: M.atk, x: 0, y: 0
    };
    var size = en.boss ? 0.27 : 0.135 * (EL ? 1.22 : 1);
    en.dom = makeUnitDom(D.ASSETS.enemies[en.id], E.fallback, size, 'enemy' + (en.elite ? ' elite' : '') + (en.boss ? ' boss' : '') + ' is-spawn');
    B.enemies.push(en);
    var p = pathAt(0); en.x = p.x; en.y = p.y;
    if (en.boss) { banner('氣噗噗雷雲王出現！', true); Sound.play('shock'); }
  }
  function makeUnitDom(src, fb, sizePct, cls) {
    var u = UI.tpl('unit'); u.className = 'unit ' + cls;
    u.style.setProperty('--w', (B.W * sizePct) + 'px');
    UI.setArt(u.querySelector('.art'), src, fb);
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
      UI.setArt(c.querySelector('.art'), D.ASSETS.pets[id], P.fallback);
      c.addEventListener('click', function (ev) { ev.stopPropagation(); selectCard(id); });
      B.cards[id].dom = c; B.cards[id].cost = st.cost;
      bar.appendChild(c);
    });
  }
  function selectCard(id) {
    var card = B.cards[id];
    closeUnitActions();
    if (card.deployed) { UI.toast(PETS[id].name + ' 已經在場上了'); return; }
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
      var ok = role && !sp.unit && ((role === 'guardian') === (sp.type === 'guard'));
      sp.el.classList.toggle('is-avail', !!ok);
      sp.el.classList.toggle('is-used', !!sp.unit);
    });
    $$('.deploy-card', $('#deployBar')).forEach(function (c) { c.classList.toggle('is-selected', c.dataset.id === B.selected); });
    $('#dockHint').textContent = B.selected ? (role === 'guardian' ? '守護型：點路徑轉角的圓圈' : '遠程／療癒：點路旁的草地方塊') : '點選下方精靈，再點發光的位置部署';
  }
  function onSpotTap(sp) {
    if (!B.selected) return;
    var id = B.selected, role = PETS[id].role;
    if (sp.unit || (role === 'guardian') !== (sp.type === 'guard')) { Sound.play('bump'); return; }
    var cost = B.cards[id].cost;
    if (B.energy < cost) { UI.toast('能量不足（需要 ' + cost + '）'); Sound.play('bump'); return; }
    deployPet(id, sp);
  }
  function deployPet(id, sp) {
    var P = PETS[id], st = petStats(id), sk = petSkill(id), br = S.pets[id].branch ? branchOf(id, S.pets[id].branch) : null;
    B.energy -= B.cards[id].cost; B.totalCost += B.cards[id].cost;
    var u = {
      uid: uidSeq++, id: id, P: P, side: 'pet', role: P.role, el: P.element, st: st, skill: sk, passive: br ? br.passive : null,
      hp: st.hp, maxHp: st.hp, atkT: 0.3, sp: Math.max(0, sk.cd - sk.initialCd), spot: sp, x: sp.x, y: sp.y,
      buffs: [], blocking: [], stunT: 0, cost: B.cards[id].cost
    };
    u.dom = makeUnitDom(D.ASSETS.pets[id], P.fallback, 0.15, 'pet is-spawn');
    u.dom.addEventListener('click', function (ev) { ev.stopPropagation(); onPetTap(u); });
    sp.unit = u; B.cards[id].deployed = u; B.pets.push(u);
    B.selected = null; updatePlacing();
    Sound.play('deploy'); fxRing(u.x, u.y, B.W * 0.16, true);
    if (!B.hintHidden) { B.hintHidden = true; setTimeout(function () { if (B.active) $('#dockHint').textContent = '能量條滿了，點精靈施放大招！'; }, 600); setTimeout(function () { if (B.active) $('#dockHint').style.display = 'none'; }, 6000); }
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
    var pct = Math.floor(u.sp / u.skill.cd * 100);
    box.innerHTML = '<span class="chip">' + u.skill.name + ' ' + pct + '%</span>';
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
  function effDef(u) {
    var aura = B.pets.reduce(function (a, p) { return a + (p.passive && p.passive.type === 'auraBuff' && p.passive.stat === 'def' ? p.passive.pct : 0); }, 0);
    return u.st.def * (1 + (buffSum(u, 'buff', 'pct') + aura) / 100);
  }
  function effBlock(u) { return u.role === 'guardian' ? u.st.block + buffSum(u, 'block', 'add') : 0; }
  function effAspdMul(u) { return u.buffs.reduce(function (a, b) { return b.type === 'aspd' ? a * b.mul : a; }, 1); }
  function dmgReducePct(u) { return u.buffs.reduce(function (a, b) { return b.type === 'dmgReduce' ? Math.max(a, b.pct) : a; }, 0) + (u.st.dmgDown || 0); }
  function enemyPos(en) { var p = pathAt(en.prog); return { x: p.x + p.nx * en.lane * B.W, y: p.y + p.ny * en.lane * B.W, dx: p.dx }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function enemiesNear(u, r) { return B.enemies.filter(function (e) { return !e.dead && dist(e, u) <= r; }); }
  function calcDmg(atk, def, aEl, dEl, crit, critDmg, mul) {
    var base = Math.max(atk * BR.damage.minRatio, atk - def) * (mul || 1), em = elemMul(aEl, dEl);
    base *= em;
    var isCrit = Math.random() * 100 < crit;
    if (isCrit) base *= critDmg / 100;
    return { dmg: Math.max(1, Math.round(base)), crit: isCrit, em: em };
  }

  /* ---------- 傷害與治療 ---------- */
  function hitEnemy(en, r, src) {
    if (en.dead) return;
    en.hp -= r.dmg;
    floatNum(en.x, en.y - B.W * 0.09, r.dmg, (r.crit ? 'is-crit ' : '') + (r.em > 1 ? 'is-strong' : r.em < 1 ? 'is-weak' : ''));
    fxHit(en.x, en.y - B.W * 0.05);
    pulse(en.dom, 'is-hit');
    if (en.hp <= 0) killEnemy(en, src);
  }
  function killEnemy(en, src) {
    en.dead = true; B.kills++;
    if (en.blockedBy) { en.blockedBy.blocking = en.blockedBy.blocking.filter(function (x) { return x !== en; }); en.blockedBy = null; }
    var EL = en.elite ? D.ELITE_MODIFIER : null;
    var coins = Math.round(en.E.rewards.coins * (EL ? EL.coinsMul : 1));
    B.loot.coins += coins;
    en.E.rewards.drops.forEach(function (d) {
      if (Math.random() * 100 < d.chance * (EL ? EL.dropChanceMul : 1)) B.loot.mats[d.id] = (B.loot.mats[d.id] || 0) + d.n;
    });
    floatText(en.x, en.y - B.W * 0.14, '+' + coins, 'is-text');
    if (src && src.passive && src.passive.energyOnKill) B.energy = Math.min(BR.energy.max, B.energy + src.passive.energyOnKill);
    en.dom.classList.add('is-dying'); setTimeout(function () { en.dom.remove(); }, 420);
  }
  function hitPet(u, raw, opt) {
    if (u.dead) return;
    var dmg = Math.max(1, Math.round(raw * (1 - dmgReducePct(u) / 100)));
    u.hp -= dmg;
    if (!opt || !opt.quiet) { floatNum(u.x, u.y - B.W * 0.12, dmg, opt && opt.cls ? opt.cls : 'is-enemy-hit'); pulse(u.dom, 'is-hit'); }
    if (u.hp <= 0) {
      floatText(u.x, u.y - B.W * 0.16, '累倒了', 'is-text');
      Sound.play('lose');
      removePet(u, BR.downedRedeployCooldown);
    }
  }
  function healPet(u, amt) {
    if (u.dead) return;
    var real = Math.min(Math.round(amt), u.maxHp - u.hp);
    if (real <= 0) return;
    u.hp += real;
    floatNum(u.x, u.y - B.W * 0.12, real, 'is-heal');
    fxHit(u.x, u.y - B.W * 0.05, true);
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
    var foes = sk.target === 'blocked' ? (u.blocking.length ? u.blocking.slice() : enemiesNear(u, unitRadius(u))) : enemiesNear(u, radius);
    var allies = sk.target === 'allAllies' ? B.pets.slice() : B.pets.filter(function (p) { return dist(p, u) <= unitRadius(u); });
    fxRing(u.x, u.y, radius * 2, true);
    sk.effects.forEach(function (e) {
      var dur = e.sec || sk.duration || 0;
      switch (e.type) {
        case 'buff': u.buffs.push({ type: 'buff', stat: e.stat, pct: e.pct, t: sk.duration }); break;
        case 'block': u.buffs.push({ type: 'block', add: e.add, t: sk.duration }); break;
        case 'aspd': u.buffs.push({ type: 'aspd', mul: e.mul, t: sk.duration }); break;
        case 'heal':
          (e.target === 'self' ? [u] : allies).forEach(function (p) {
            healPet(p, e.maxHpPct ? p.maxHp * e.maxHpPct / 100 : u.st.atk * e.atkPct / 100 * (1 + u.st.healPct / 100));
          });
          Sound.play('heal'); break;
        case 'hot': (sk.target === 'allAllies' ? B.pets : allies).forEach(function (p) { p.buffs.push({ type: 'hot', pct: e.maxHpPct, t: dur, acc: 0 }); }); break;
        case 'dmgReduce': (sk.target === 'allAllies' ? B.pets : allies).forEach(function (p) { p.buffs.push({ type: 'dmgReduce', pct: e.pct, t: sk.duration }); }); break;
        case 'damage': foes.forEach(function (en) { hitEnemy(en, calcDmg(u.st.atk * e.atkPct / 100, en.def, u.el, en.el, u.st.critRate, u.st.critDmg), u); }); break;
        case 'knockback':
          foes.forEach(function (en) {
            if (en.dead || en.boss) return;
            if (en.blockedBy) { en.blockedBy.blocking = en.blockedBy.blocking.filter(function (x) { return x !== en; }); en.blockedBy = null; }
            en.prog = Math.max(0, en.prog - e.cells * BR.knockbackPct / 100 * B.W / B.total);
          });
          break;
        case 'stun': foes.forEach(function (en) { en.stunT = Math.max(en.stunT, e.sec); }); break;
        case 'slow':
          (e.target === 'enemiesInRange' ? enemiesNear(u, unitRadius(u)) : foes).forEach(function (en) { en.slowT = Math.max(en.slowT, e.sec); en.slowPct = Math.max(en.slowPct, e.pct); });
          break;
      }
    });
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
    var regen = BR.energy.regenPerSec + B.pets.reduce(function (a, p) { return a + (p.passive && p.passive.type === 'energyRegen' ? p.passive.add : 0); }, 0);
    B.energy = Math.min(BR.energy.max, B.energy + regen * dt);

    // 出怪
    if (B.mode === 'endless' && B.t >= B.nextWaveT && !B.queue.length) queueEndlessWave();
    while (B.queue.length && B.queue[0].t <= B.t) {
      var it = B.queue.shift();
      if (it.wave > B.waveShown) { B.waveShown = it.wave; banner('第 ' + it.wave + ' 波', false); Sound.play('wave'); }
      spawnEnemy(it);
    }

    // 精靈：充能、Buff、攻擊／治療
    B.pets.forEach(function (u) {
      if (u.dead) return;
      u.sp = Math.min(u.skill.cd, u.sp + dt);
      u.buffs = u.buffs.filter(function (b) {
        b.t -= dt;
        if (b.type === 'hot') { b.acc += dt; if (b.acc >= 1) { b.acc -= 1; healPet(u, u.maxHp * b.pct / 100); } }
        return b.t > 0;
      });
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
        if (!targets.length) targets = enemiesNear(u, unitRadius(u)).sort(function (a, b) { return b.prog - a.prog; }).slice(0, 1);
        else targets = targets.slice(0, 1);
      } else {
        var near = enemiesNear(u, unitRadius(u)).sort(function (a, b) { return b.prog - a.prog; });
        var pv = u.passive;
        targets = pv && pv.type === 'multiTarget' ? near.slice(0, pv.targets) : pv && pv.type === 'pierce' ? near : near.slice(0, 1);
      }
      if (!targets.length) { u.atkT = 0.15; return; }
      u.atkT = u.st.aspd;
      pulse(u.dom, 'is-attacking');
      var mul = targets.length > 1 && u.passive ? u.passive.dmgPct / 100 : 1;
      targets.forEach(function (en) {
        var res = calcDmg(u.st.atk, en.def, u.el, en.el, u.st.critRate, u.st.critDmg, mul);
        if (u.role === 'guardian') { hitEnemy(en, res, u); Sound.play('hit'); }
        else { shootProj(u, en, function () { hitEnemy(en, res, u); }); Sound.play('shoot'); }
      });
    });

    // 飛射物
    B.projs = B.projs.filter(function (p) { p.t -= dt; if (p.t <= 0) { p.cb(); return false; } return true; });

    // 怪物
    B.enemies.forEach(function (en) {
      if (en.dead) return;
      if (en.stunT > 0) en.stunT -= dt;
      if (en.slowT > 0) { en.slowT -= dt; if (en.slowT <= 0) en.slowPct = 0; }
      var bl = en.blockedBy;
      if (bl && bl.dead) { en.blockedBy = bl = null; }
      if (bl && bl.passive && bl.passive.type === 'slowBlocked') { en.slowT = Math.max(en.slowT, 0.3); en.slowPct = Math.max(en.slowPct, bl.passive.pct); }
      var rate = 1 - en.slowPct / 100;
      // 特殊：花粉持續傷害（對阻擋者）
      if (bl && en.E.special && en.E.special.type === 'blockerDot') {
        en.dotAcc += en.E.special.dmgPerSec * en.scale * dt; en.dotShow += dt;
        if (en.dotShow >= 1) { en.dotShow -= 1; var dd = Math.round(en.dotAcc); en.dotAcc = 0; hitPet(bl, dd, { cls: 'is-true' }); if (bl.dead) { en.blockedBy = null; bl = null; } }
      }
      // 特殊：雷雲王範圍震盪
      if (en.E.special && en.E.special.type === 'shockwave') {
        en.shockT -= dt;
        if (en.shockT <= 0) {
          var sp = en.E.special;
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
      var dp = en.speed * BR.speedUnitPct / 100 * B.W / B.total * dt * rate;
      var np = en.prog + dp;
      // 阻擋：找路徑前方最近、還有阻擋額度的守護
      var g = null;
      B.pets.forEach(function (p) {
        if (p.dead || p.role !== 'guardian' || p.stunT > 0) return;
        var gp = p.spot.prog;
        if (gp > en.prog - 0.002 && gp <= np + 0.004 && p.blocking.length < effBlock(p) && (!g || gp < g.spot.prog)) g = p;
      });
      if (g) { en.prog = Math.min(np, g.spot.prog - 0.006); en.blockedBy = g; g.blocking.push(en); en.atkT = Math.min(en.atkT, 0.6); return; }
      en.prog = np;
      if (en.prog >= 1) {                             // 抵達木門營地
        en.dead = true;
        B.lives -= en.E.leakDamage;
        $('#battleLives').classList.remove('is-shake');
        Sound.play('lose');
        floatText(B.pts[B.pts.length - 1][0], B.pts[B.pts.length - 1][1] - B.W * 0.12, '−' + en.E.leakDamage + ' ♥', 'is-text');
        en.dom.classList.add('is-dying'); setTimeout(function () { en.dom.remove(); }, 400);
      }
    });
    B.pets.forEach(function (p) { if (p.stunT > 0) p.stunT -= dt; });
    B.enemies = B.enemies.filter(function (e) { return !e.dead; });
    B.enemies.forEach(function (en) { var pp = enemyPos(en); en.x = pp.x; en.y = pp.y; });

    // 勝負
    if (B.lives <= 0) { endBattle(false); return; }
    if (B.mode === 'stage' && !B.queue.length && !B.enemies.length) endBattle(true);
  }
  function render(dt) {
    B.enemies.forEach(function (en) {
      var p = enemyPos(en); en.x = p.x; en.y = p.y;
      var d = en.dom;
      d.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
      d.style.zIndex = Math.round(p.y);
      d.style.setProperty('--hp', clamp(en.hp / en.maxHp * 100, 0, 100) + '%');
      d.classList.toggle('is-blocked', !!en.blockedBy);
      d.classList.toggle('is-stunned', en.stunT > 0);
      d.classList.toggle('is-slowed', en.slowPct > 0);
      d.classList.toggle('is-flip', p.dx < -1);
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
    var sy = from.y - B.W * 0.08, ty = to.y - B.W * 0.06;
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
        sub = '泉水之心 ' + B.lives + ' / ' + B.livesMax + '・部署費用 ' + B.totalCost + '（三星上限 ' + st.costCap + '）';
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
      if (r.k === 'exp' || r.k === 'title') { out.push(r); return; }
      if (idx[r.k] == null) { idx[r.k] = out.length; out.push({ k: r.k, n: 0, tag: r.tag }); }
      var o = out[idx[r.k]]; o.n += r.n; if (o.tag !== r.tag) o.tag = '合計';
    });
    return out;
  }
  function leaveBattle() {
    endBattle(false, true);
    UI.closeOverlay('screen-battle');
    $('#battleUnits').innerHTML = ''; $('#battleFx').innerHTML = '';
    UI.switchTab('adventure');
    renderMap();
    setTimeout(tryShowClass, 400);
  }
  function retryBattle() { var ctx = B.ctx; endBattle(false, true); UI.closeAllModals(); startBattle(ctx); }

  /* =================================================================
   * 16. 迷宮探索（迷霧、石板藤蔓門、傳送樹洞、拾取素材）
   * ================================================================= */
  var MZ = null;
  var BOX_OK = { '.': 1, 'S': 1, 'h': 1 };
  function mazeUnlocked(m) { return stageCleared(D.MAZE_RULES.unlock[m.difficulty]); }
  function renderMazeList() {
    var box = $('#mazeList'); box.innerHTML = '';
    var names = { easy: '簡單', normal: '普通', hard: '困難' }, last = '';
    D.MAZE_MAPS.forEach(function (m) {
      if (m.difficulty !== last) { last = m.difficulty; var t = el('div', 'diff-title t-outline'); t.textContent = names[m.difficulty] + (mazeUnlocked(m) ? '' : '・通關 ' + D.MAZE_RULES.unlock[m.difficulty] + ' 解鎖'); box.appendChild(t); }
      var c = UI.tpl('maze-card'), rec = S.mazes[m.id] || {};
      c.querySelector('h4').textContent = m.name;
      c.querySelector('p').textContent = '最佳 ' + m.par + ' 步' + (rec.best ? '・你的紀錄 ' + rec.best + ' 步' : '') + (rec.clear ? '' : '・首通有獎勵');
      c.querySelector('.maze-thumb').innerHTML = m.grid.join('').split('').map(function (ch) { return '<i class="' + (ch === '#' ? 'w' : ch === 'G' ? 'g' : ch === 'S' ? 's' : '') + '"></i>'; }).join('');
      c.querySelector('.stars').innerHTML = starsHTML(rec.stars || 0);
      if (!mazeUnlocked(m)) c.classList.add('is-locked');
      c.addEventListener('click', function () {
        if (!mazeUnlocked(m)) { Sound.play('bump'); UI.toast('通關 ' + D.MAZE_RULES.unlock[m.difficulty] + '（普通）後解鎖'); return; }
        openMaze(m.id);
      });
      box.appendChild(c);
    });
  }
  function openMaze(id) {
    var m = MAZE(id), g = m.grid.join('').split(''), boxes = [], holes = [], start = 0, mats = {};
    g.forEach(function (ch, i) {
      if (ch === 'B') { boxes.push(i); g[i] = '.'; }
      if (ch === 'S') start = i;
      if (ch === 'T') holes.push(i);
      if (ch === 'm') mats[i] = pick(m.pickupMats);
    });
    MZ = { m: m, base: g, holes: holes, matAt: mats, startBoxes: boxes, start: start };
    buildMazeDom();
    resetMaze();
    UI.openOverlay('screen-maze');
    Camp.stop();
  }
  function resetMaze() {
    MZ.s = { pos: MZ.start, keys: 0, doors: [], vine: false, tog: 0, boxes: MZ.startBoxes.slice(), taken: [], steps: 0, loot: { mats: {}, dew: 0, chest: false } };
    MZ.hist = []; MZ.revealed = {}; MZ.done = false;
    reveal(MZ.start);
    renderMaze(true);
  }
  function reveal(i) {
    var r0 = Math.floor(i / 5), c0 = i % 5, R = D.MAZE_RULES.fogRadius;
    for (var r = r0 - R; r <= r0 + R; r++) for (var c = c0 - R; c <= c0 + R; c++) if (r >= 0 && c >= 0 && r < 5 && c < 5) MZ.revealed[r * 5 + c] = true;
  }
  var TILE_CLS = { '#': 't-wall', 'G': 't-goal', 'k': 't-key', 'D': 't-door', 's': 't-slab', 'V': 't-vine', 'p': 't-lever', 'X': 't-gate', 'O': 't-gate', 'h': 't-plate', 'Y': 't-root', 'T': 't-hole', 'm': 't-mat', 'w': 't-dew', 'c': 't-chest' };
  var TILE_ICO = { 'G': '#m-spring', 'k': '#m-key', 'D': '#m-lock', 'p': '#m-lever', 'w': '#m-dew', 'c': '#i-chest' };
  function buildMazeDom() {
    var grid = $('#mazeGrid'); grid.innerHTML = '';
    MZ.tiles = MZ.base.map(function (ch, i) {
      var t = el('div', 'tile ' + (TILE_CLS[ch] || ''));
      if (TILE_ICO[ch]) t.innerHTML = '<svg class="ico"><use href="' + TILE_ICO[ch] + '"/></svg>';
      if (ch === 'm') { var a = el('div', 'art'); t.appendChild(a); UI.setArt(a, D.ASSETS.materials[MZ.matAt[i]], D.MATERIALS[MZ.matAt[i]].fallback); }
      grid.appendChild(t); return t;
    });
    var ents = $('#mazeEntities'); ents.innerHTML = '';
    MZ.boxDoms = MZ.startBoxes.map(function () { var b = el('div', 'maze-ent is-box', '<i></i>'); ents.appendChild(b); return b; });
    MZ.player = el('div', 'maze-ent is-player', '<div class="art"></div>');
    ents.appendChild(MZ.player);
    var lead = S.team.find(function (id) { return S.pets[id]; }) || Object.keys(S.pets)[0];
    UI.setArt(MZ.player.querySelector('.art'), D.ASSETS.pets[lead], PETS[lead].fallback);
    $('#mazeTitle').textContent = MZ.m.name;
    $('#mazePar').textContent = MZ.m.par;
  }
  function platesCovered() {
    var plates = []; MZ.base.forEach(function (ch, i) { if (ch === 'h') plates.push(i); });
    return plates.length > 0 && plates.every(function (p) { return MZ.s.boxes.indexOf(p) >= 0; });
  }
  function renderMaze() {
    var s = MZ.s, cov = platesCovered();
    MZ.tiles.forEach(function (t, i) {
      var ch = MZ.base[i];
      t.classList.toggle('is-fog', !MZ.revealed[i]);
      if (ch === 'X') { t.classList.toggle('is-open', s.tog === 1); t.classList.toggle('is-closed', s.tog === 0); }
      if (ch === 'O') { t.classList.toggle('is-open', s.tog === 0); t.classList.toggle('is-closed', s.tog === 1); }
      if (ch === 'Y') { t.classList.toggle('is-open', cov); t.classList.toggle('is-closed', !cov); }
      if (ch === 'V') { t.classList.toggle('is-open', s.vine); t.classList.toggle('is-closed', !s.vine); }
      if (ch === 's') t.classList.toggle('is-pressed', s.vine);
      if (ch === 'h') t.classList.toggle('is-pressed', s.boxes.indexOf(i) >= 0);
      if (ch === 'D') { var op = s.doors.indexOf(i) >= 0; t.classList.toggle('is-open', op); t.querySelector('.ico') && (t.querySelector('.ico').style.opacity = op ? '0' : ''); }
      if (ch === 'p') t.classList.toggle('is-on', s.tog === 1);
      if ('kmwc'.indexOf(ch) >= 0) t.classList.toggle('is-collected', s.taken.indexOf(i) >= 0);
    });
    MZ.boxDoms.forEach(function (b, k) {
      var i = s.boxes[k]; b.style.setProperty('--x', i % 5); b.style.setProperty('--y', Math.floor(i / 5));
      b.classList.toggle('on-plate', MZ.base[i] === 'h'); b.classList.toggle('is-fog', !MZ.revealed[i]);
    });
    MZ.player.style.setProperty('--x', s.pos % 5); MZ.player.style.setProperty('--y', Math.floor(s.pos / 5));
    $('#mazeSteps').textContent = s.steps;
    $('#mazeKeys').textContent = s.keys;
    $('#mazeStarPreview').innerHTML = starsHTML(mazeStars(s.steps));
  }
  function mazeStars(steps) { var m = MZ.m; return steps <= m.par ? 3 : steps <= m.par + m.bonusSteps ? 2 : 1; }
  function mazeMove(dr, dc) {
    if (!MZ || MZ.done) return;
    var s = MZ.s, r = Math.floor(s.pos / 5) + dr, c = s.pos % 5 + dc;
    var bump = function (msg) { Sound.play('bump'); var t = MZ.tiles[r * 5 + c]; if (t) { t.style.setProperty('--bx', dc * 3 + 'px'); t.style.setProperty('--by', dr * 3 + 'px'); UI.bump(t); } if (msg) UI.toast(msg); };
    if (r < 0 || c < 0 || r > 4 || c > 4) { Sound.play('bump'); return; }
    var i = r * 5 + c, ch = MZ.base[i];
    if (ch === '#') return bump();
    if (ch === 'X' && s.tog === 0) return bump('花瓣閘門關著，找找拉桿');
    if (ch === 'O' && s.tog === 1) return bump('花瓣閘門關著，找找拉桿');
    if (ch === 'Y' && !platesCovered()) return bump('根鬚閘門要用苔石壓住壓板才會打開');
    if (ch === 'V' && !s.vine) return bump('藤蔓擋住了，找找石板');
    if (ch === 'D' && s.doors.indexOf(i) < 0 && s.keys <= 0) return bump('木柵門需要鑰匙');
    var bi = s.boxes.indexOf(i), i2 = -1;
    if (bi >= 0) {
      var r2 = r + dr, c2 = c + dc;
      if (r2 < 0 || c2 < 0 || r2 > 4 || c2 > 4) return bump('苔石推不動');
      i2 = r2 * 5 + c2;
      if (!BOX_OK[MZ.base[i2]] || s.boxes.indexOf(i2) >= 0) return bump('苔石推不動');
    }
    MZ.hist.push(JSON.stringify(s));
    if (bi >= 0) { s.boxes[bi] = i2; Sound.play('click'); }
    if (ch === 'D' && s.doors.indexOf(i) < 0) { s.keys--; s.doors.push(i); Sound.play('unlock'); }
    s.pos = i; s.steps++;
    Sound.play('step');
    if (s.taken.indexOf(i) < 0) {
      if (ch === 'k') { s.keys++; s.taken.push(i); Sound.play('unlock'); UI.toast('拿到晨露鑰匙'); }
      if (ch === 'm') { s.taken.push(i); var mt = MZ.matAt[i]; s.loot.mats[mt] = (s.loot.mats[mt] || 0) + 1; Sound.play('pop'); UI.toast('撿到 ' + D.MATERIALS[mt].name); }
      if (ch === 'w') { s.taken.push(i); s.loot.dew++; Sound.play('pop'); UI.toast('撿到一顆露珠'); }
      if (ch === 'c') { s.taken.push(i); s.loot.chest = true; Sound.play('coin'); UI.toast('發現寶箱！抵達出口後打開'); }
    }
    if (ch === 'p') { s.tog ^= 1; Sound.play('click'); }
    if (ch === 's' && !s.vine) { s.vine = true; Sound.play('unlock'); UI.toast('藤蔓門退開了'); }
    if (bi >= 0 && MZ.base[i2] === 'h' && platesCovered()) { Sound.play('unlock'); UI.toast('根鬚閘門打開了'); }
    reveal(i);
    if (ch === 'T' && MZ.holes.length === 2) {
      var other = MZ.holes[0] === i ? MZ.holes[1] : MZ.holes[0];
      MZ.tiles[i].classList.add('is-warp'); setTimeout(function () { MZ.tiles[i].classList.remove('is-warp'); }, 500);
      s.pos = other; reveal(other); Sound.play('warp');
      MZ.player.classList.add('is-warping'); setTimeout(function () { MZ.player.classList.remove('is-warping'); }, 450);
    }
    renderMaze();
    if (ch === 'G') finishMaze();
  }
  function mazeUndo() {
    if (!MZ || MZ.done || !MZ.hist.length) { Sound.play('bump'); return; }
    MZ.s = JSON.parse(MZ.hist.pop()); Sound.play('click'); renderMaze();
  }
  function finishMaze() {
    MZ.done = true;
    var m = MZ.m, s = MZ.s, stars = mazeStars(s.steps);
    var rec = S.mazes[m.id] || (S.mazes[m.id] = { clear: false, stars: 0, best: 0, chest: false });
    var list = [], first = !rec.clear, replayFree = S.daily.mazeReplay.indexOf(m.id) < 0, note = '';
    var pickups = { mats: s.loot.mats, dew: s.loot.dew };
    if (first) { list = list.concat(tagged(grant(m.rewards.first), '首通')); list = list.concat(tagged(grant(pickups), '拾取')); S.daily.mazeReplay.push(m.id); }
    else if (replayFree) { list = list.concat(tagged(grant(m.rewards.dailyReplay), '今日')); list = list.concat(tagged(grant(pickups), '拾取')); S.daily.mazeReplay.push(m.id); }
    else note = '・今天這張已領過獎勵';
    if (stars === 3 && rec.stars < 3) list = list.concat(tagged(grant(m.rewards.threeStar), '三星'));
    if (s.loot.chest && !rec.chest) { rec.chest = true; list = list.concat(tagged(grant(m.rewards.chest || { coins: 50 }), '寶箱')); }
    rec.clear = true; rec.stars = Math.max(rec.stars, stars); rec.best = rec.best ? Math.min(rec.best, s.steps) : s.steps;
    questAdd('mazeClear', 1);
    markDirty(); refreshDots();
    $$('#mazeResultStars .ico').forEach(function (e, i) { e.classList.remove('on'); if (i < stars) setTimeout(function () { e.classList.add('on'); }, 50); });
    $('#mazeResultSub').textContent = '用了 ' + s.steps + ' 步（最佳 ' + m.par + ' 步）' + note;
    renderRewards($('#mazeRewards'), mergeRewardsKeepTags(list));
    setTimeout(function () { UI.openModal('modalMazeClear'); Sound.play('victory'); }, 350);
  }
  function closeMaze() { UI.closeAllModals(); UI.closeOverlay('screen-maze'); MZ = null; renderMazeList(); if (UI && $('#app').dataset.tab === 'camp') Camp.start(); }

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
    if (g.by) { var t = el('span', 'gi-tag'); t.textContent = PETS[g.by].name; d.appendChild(t); }
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
    $('#gearOwner').textContent = g.by ? '目前由 ' + PETS[g.by].name + ' 裝備中' : '尚未裝備，可在精靈屋的「裝備」頁穿上';
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
   * 18. 精靈屋（卡片、篩選、詳情：養成／轉職／裝備）
   * ================================================================= */
  var petFilter = 'all', curPet = null, gearSlot = null, pickBranch = null;
  function petCard(id) {
    var P = PETS[id], st = S.pets[id], c = UI.tpl('pet-card');
    c.dataset.el = P.element;
    c.querySelector('.pc-name').textContent = P.name;
    var rb = c.querySelector('.badge-rarity'); rb.dataset.r = P.rarity; rb.textContent = P.rarity;
    c.querySelector('.pc-lv').textContent = st ? 'Lv.' + st.lv : '???';
    UI.setArt(c.querySelector('.art'), D.ASSETS.pets[id], P.fallback);
    c.querySelector('.stars').innerHTML = starsHTML(st ? st.star : 0, 5);
    if (!st) c.classList.add('is-unowned');
    return c;
  }
  function renderPets() {
    var grid = $('#petGrid'); grid.innerHTML = '';
    D.PETS.filter(function (p) { return petFilter === 'all' || p.role === petFilter; }).forEach(function (P) {
      var c = petCard(P.id), st = S.pets[P.id];
      if (st && st.lv >= D.LEVEL_RULES.classChangeLevel && !st.branch) { c.classList.add('dot-host', 'has-dot'); }
      c.addEventListener('click', function () {
        if (!S.pets[P.id]) { Sound.play('bump'); UI.toast('還沒遇見 ' + P.name + '，到孵化巢召喚看看'); return; }
        openPet(P.id);
      });
      grid.appendChild(c);
    });
    var left = D.SUMMON.pitySSR - S.summon.pity;
    $('#pityText').textContent = '再 ' + left + ' 次必定遇見 SSR' + (S.tickets ? '・葉籤 ×' + S.tickets : '');
    $('#summon1Cost').textContent = S.tickets > 0 ? '葉籤' : summonCost(1);
    $('#summon10Cost').textContent = summonCost(10);
  }
  function openPet(id) { curPet = id; gearSlot = null; pickBranch = null; renderPetDetail(); UI.setSubTab('petdetail', 'grow'); UI.openModal('sheetPet'); }
  function renderPetDetail() {
    var id = curPet, P = PETS[id], st = S.pets[id]; if (!st) return;
    var stats = petStats(id), sk = petSkill(id), br = st.branch ? branchOf(id, st.branch) : null;
    $('#petPortrait').dataset.el = P.element;
    var rb = $('#petRarity'); rb.dataset.r = P.rarity; rb.textContent = P.rarity;
    var eb = $('#petElement'); eb.dataset.el = P.element; eb.textContent = D.ELEMENTS[P.element].name;
    $('#petRole').textContent = D.ROLES[P.role].name;
    UI.setArt($('#petArt'), D.ASSETS.pets[id], P.fallback);
    $('#petClassName').textContent = br ? '轉職：' + br.name : (st.lv >= D.LEVEL_RULES.classChangeLevel ? '可以轉職了！' : P.lore);
    $('#petName').textContent = P.name;
    $('#petLv').textContent = st.lv;
    var max = st.lv >= D.LEVEL_RULES.maxLevel, need = expNeed(st.lv);
    $('#petExpBar').style.setProperty('--pct', max ? '100%' : clamp(st.exp / need * 100, 0, 100) + '%');
    $('#petExpText').textContent = max ? '已滿級' : fmt(st.exp) + ' / ' + fmt(need);
    $$('[data-feed]').forEach(function (b) { b.disabled = max; });
    $('#petStars').innerHTML = starsHTML(st.star, 5);
    var R = D.STAR_RULES, nxt = R.dupNeededForStar[st.star + 1];
    $('#petDupCount').textContent = st.star >= R.maxStar ? '—' : st.shards;
    $('#petDupNeed').textContent = st.star >= R.maxStar ? '滿星' : nxt;
    var su = $('#btnStarUp'); su.textContent = '自動'; su.disabled = true; su.title = '重複召喚會自動轉為碎片並升星';
    var vals = { hp: fmt(stats.hp), atk: fmt(stats.atk), def: fmt(stats.def), aspd: stats.aspd + 's', range: P.role === 'guardian' ? '近身' : stats.range, blockcost: (P.role === 'guardian' ? stats.block : 0) + ' / ' + stats.cost };
    $$('#petStats [data-stat]').forEach(function (b) { b.textContent = vals[b.dataset.stat]; });
    $('#petSkillName').textContent = sk.name;
    $('#petSkillCd').textContent = '能量 ' + sk.cd + ' 秒充滿' + (sk.duration ? '・持續 ' + sk.duration + ' 秒' : '');
    $('#petSkillDesc').textContent = P.skill.desc + (br ? '（轉職強化：' + br.desc + '）' : '');
    // 轉職頁
    var lvOk = st.lv >= D.LEVEL_RULES.classChangeLevel;
    $('#classLockText').textContent = br ? '已轉職為「' + br.name + '」' : lvOk ? '選擇一條路線（擇一，無法重選）' : 'Lv.' + D.LEVEL_RULES.classChangeLevel + ' 解鎖轉職（目前 Lv.' + st.lv + '）';
    $$('#branchGrid .branch-card').forEach(function (c, i) {
      var b = P.classChange.branches[i];
      c.querySelector('h5').textContent = b.name; c.querySelector('p').textContent = b.desc;
      c.classList.toggle('is-locked', !lvOk && !br);
      c.classList.toggle('is-chosen', !!br && br.id === b.id);
      c.classList.toggle('is-picked', !br && pickBranch === i);
      c.onclick = function () { if (br || !lvOk) { Sound.play('bump'); return; } pickBranch = i; Sound.play('click'); renderPetDetail(); };
    });
    renderCost($('#classCost'), P.classChange.cost);
    var cc = $('#btnClassChange');
    cc.style.display = br ? 'none' : '';
    cc.disabled = !lvOk || pickBranch == null || !canPay(P.classChange.cost);
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
    Sound.play(ups ? 'levelup' : 'pop');
    UI.toast(ups ? PETS[id].name + ' 升到 Lv.' + st.lv + '！' : '餵了 ' + dew + ' 露水（EXP +' + dew * per + '）', ups ? 'good' : '');
    markDirty(); refreshHUD(); renderPetDetail(); renderPets(); refreshDots();
    if (ups) setTimeout(tryShowClass, 500);
  }

  /* =================================================================
   * 19. 轉職（Lv.10 跳出二選一）
   * ================================================================= */
  var classPetId = null, classPick = null;
  function anyModalOpen() { return !!$('.modal-wrap.is-open'); }
  function tryShowClass() {
    if (!classQueue.length || anyModalOpen() || $('.overlay-screen.is-open')) return;
    var id = classQueue.shift(), st = S.pets[id];
    if (!st || st.branch) return tryShowClass();
    st.classPrompted = true; markDirty();
    classPetId = id; classPick = null;
    var P = PETS[id];
    UI.setArt($('#classArt'), D.ASSETS.pets[id], P.fallback);
    $('#classIntro').textContent = P.name + ' 到達 Lv.' + st.lv + '，可以選擇轉職路線了！';
    $$('#classBranches .branch-card').forEach(function (c, i) {
      var b = P.classChange.branches[i];
      c.querySelector('h5').textContent = b.name; c.querySelector('p').textContent = b.desc;
      c.classList.remove('is-picked');
      c.onclick = function () { classPick = i; Sound.play('click'); $$('#classBranches .branch-card').forEach(function (x, j) { x.classList.toggle('is-picked', j === i); }); $('#btnClassConfirm').disabled = !canPay(P.classChange.cost); };
    });
    renderCost($('#classModalCost'), P.classChange.cost);
    $('#btnClassConfirm').disabled = true;
    $('#btnClassConfirm').textContent = canPay(P.classChange.cost) ? '確認轉職' : '素材不足';
    UI.openModal('modalClass');
    Sound.play('unlock');
  }
  function doClassChange(id, idx) {
    var P = PETS[id], st = S.pets[id];
    if (!st || st.branch || st.lv < D.LEVEL_RULES.classChangeLevel) return false;
    if (!canPay(P.classChange.cost)) { Sound.play('bump'); UI.toast('素材或星塵不足', 'warn'); return false; }
    pay(P.classChange.cost);
    st.branch = P.classChange.branches[idx].id;
    Sound.play('skill'); setTimeout(function () { Sound.play('victory'); }, 300);
    UI.toast(P.name + ' 轉職為「' + P.classChange.branches[idx].name + '」！', 'good');
    markDirty(); refreshDots(); renderPets();
    return true;
  }

  /* =================================================================
   * 20. 事件綁定
   * ================================================================= */
  function bind() {
    // 全域點擊音效（木頭點擊）
    document.addEventListener('click', function (e) {
      if (e.target.closest('.btn,.tab,.hotspot,.stage-node,.maze-card,.pet-card,.recipe-slot,.gear-item,.equip-slot,.seg > button,.hud-pill,.camp-float,.branch-card,.mt-node')) Sound.play('click');
    }, true);
    var unlockAudio = function () { Sound.unlocked = true; Sound.ensure(); };
    var appEl = $('#app'); appEl.addEventListener('scroll', function () { appEl.scrollTop = 0; appEl.scrollLeft = 0; });
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { document.addEventListener(t, unlockAudio, { once: true, passive: true, capture: true }); });

    document.addEventListener('md:tab', function (e) {
      var t = e.detail.tab;
      if (t === 'camp') { Camp.resize(); Camp.sync(); Camp.start(); } else Camp.stop();
      if (t === 'adventure') renderMap();
      if (t === 'explore') { renderMazeList(); renderForge(); }
      if (t === 'pets') renderPets();
    });
    document.addEventListener('md:subtab', function (e) {
      if (e.detail.group === 'petfilter') { petFilter = e.detail.name; renderPets(); }
      if (e.detail.group === 'explore' && e.detail.name === 'forge') renderForge();
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
      setTimeout(tryShowClass, 250);
    });
    document.addEventListener('md:building', function (e) { openBuilding(e.detail.id); });
    document.addEventListener('md:key', function (e) { stepKey(e.detail.key); });
    document.addEventListener('md:sound', function (e) { Sound.on = e.detail.on; S.settings.sound = e.detail.on; markDirty(); if (e.detail.on) Sound.play('pop'); });
    document.addEventListener('md:overlay', function (e) {
      if (!e.detail.open && e.detail.id === 'screen-battle' && B.active) endBattle(false, true);
      if (!e.detail.open && e.detail.id === 'screen-maze') { MZ = null; renderMazeList(); }
      if (!e.detail.open && !$('.overlay-screen.is-open') && $('#app').dataset.tab === 'camp') Camp.start();
    });

    $('#btnStepConfirm').addEventListener('click', confirmSteps);
    $('#btnBuildingUpgrade').addEventListener('click', upgradeBuilding);
    $('#btnBuildingAction').addEventListener('click', buildingAction);
    $('#hudStardust').addEventListener('click', function () { UI.toast('星塵：戰鬥、任務取得，用來升級建築與鍛造'); });

    // 地圖
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
    $('#btnTeamGo').addEventListener('click', function () {
      if (!teamPick.length) return;
      S.team = teamPick.slice(); markDirty();
      startBattle(teamCtx);
    });

    // 戰鬥
    $('#btnSpeed').addEventListener('click', function () { B.speed = B.speed === 1 ? 2 : 1; S.settings.speed = B.speed; $('#speedLabel').textContent = B.speed + '×'; markDirty(); });
    $('#bfield').addEventListener('click', function () { if (B.selected) { B.selected = null; updatePlacing(); } closeUnitActions(); });
    $('#btnBattleRetry').addEventListener('click', retryBattle);
    $('#btnBattleQuit').addEventListener('click', function () { UI.closeAllModals(); leaveBattle(); });
    $('#btnResultRetry').addEventListener('click', function () { UI.closeAllModals(); startBattle(B.ctx); });
    $('#btnResultNext').addEventListener('click', function () {
      var ctx = B.ctx; UI.closeAllModals(); leaveBattle();
      if (ctx.mode === 'stage') { var st = STAGE(ctx.id), nx = STAGES[STAGES.indexOf(st) + 1]; if (nx) { mapChapter = nx.ci; renderMap(); } }
    });
    window.addEventListener('resize', function () { if (B.active) { layoutField(); } if ($('#app').dataset.tab === 'adventure') renderMap(); });

    // 迷宮
    $$('#mazeDpad [data-dir]').forEach(function (b) {
      b.addEventListener('click', function () { var d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[b.dataset.dir]; mazeMove(d[0], d[1]); });
    });
    $('#btnMazeUndo').addEventListener('click', mazeUndo);
    $('#btnMazeRestart').addEventListener('click', function () { if (MZ) { resetMaze(); Sound.play('warp'); } });
    $('#btnMazeHint').addEventListener('click', function () { if (MZ) UI.toast(MZ.m.hint); });
    $('#btnMazeRetry').addEventListener('click', function () { UI.closeAllModals(); if (MZ) resetMaze(); });
    $('#btnMazeDone').addEventListener('click', closeMaze);
    document.addEventListener('keydown', function (e) {
      if (!MZ || !$('#screen-maze').classList.contains('is-open') || anyModalOpen()) return;
      var d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (d) { e.preventDefault(); mazeMove(d[0], d[1]); }
    });
    var sw = null, board = $('.maze-board');
    board.addEventListener('touchstart', function (e) { var t = e.touches[0]; sw = [t.clientX, t.clientY]; }, { passive: true });
    board.addEventListener('touchend', function (e) {
      if (!sw) return; var t = e.changedTouches[0], dx = t.clientX - sw[0], dy = t.clientY - sw[1]; sw = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) mazeMove(0, dx > 0 ? 1 : -1); else mazeMove(dy > 0 ? 1 : -1, 0);
    });

    // 鍛造
    $('#btnCraft').addEventListener('click', craft);
    $('#btnGearSalvage').addEventListener('click', salvageGear);

    // 精靈屋與召喚
    $$('[data-summon]').forEach(function (b) { b.addEventListener('click', function () { doSummon(parseInt(b.dataset.summon, 10)); }); });
    $('#btnSummonAgain').addEventListener('click', function () { doSummon(lastSummonN); });
    $$('[data-feed]').forEach(function (b) { b.addEventListener('click', function () { feed(b.dataset.feed); }); });
    $('#btnClassChange').addEventListener('click', function () { if (pickBranch != null && doClassChange(curPet, pickBranch)) { pickBranch = null; renderPetDetail(); } });
    $('#btnClassConfirm').addEventListener('click', function () { if (classPick == null) return; if (doClassChange(classPetId, classPick)) UI.closeModal('modalClass'); });
    $('#btnClassLater').addEventListener('click', function () { UI.closeModal('modalClass'); UI.toast('之後可在精靈屋的「轉職」頁選擇'); });

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
    if (off.gain > 0) showRewards('離線收益（' + (Math.round(off.hours * 10) / 10) + ' 小時）', [{ k: 'dew', n: off.gain }], 'coin');
    refreshHUD(); refreshDots(); save();
  }

  /* =================================================================
   * 21. 啟動
   * ================================================================= */
  function renderAll() {
    refreshHUD(); refreshBuildingLabels(); refreshDots();
    renderMap(); renderMazeList(); renderForge(); renderPets();
  }
  function init() {
    var isNew = load();
    Sound.on = S.settings.sound !== false;
    $('#btnSound').setAttribute('aria-pressed', Sound.on ? 'true' : 'false');
    var off = isNew ? { gain: 0 } : settleOffline();
    checkDay();
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
        $('#rewardTitle').textContent = '歡迎來到晨露森旅';
        renderRewards($('#rewardList'), [{ k: 'dew', n: D.ECONOMY.newPlayer.dew, tag: '新手禮' }].concat(starter));
        UI.openModal('modalReward'); Sound.play('hatch');
        setTimeout(function () { UI.toast('點左上角「今日步數」記錄步數換露水', 'good'); }, 2400);
      } else if (off.gain > 0) {
        showRewards('離線收益（' + (Math.round(off.hours * 10) / 10) + ' 小時）', [{ k: 'dew', n: off.gain }]);
      }
    }, 650);
  }

  // 測試與除錯用（不影響遊戲）
  window.MorningDew = {
    get save() { return S; }, get battle() { return B; }, get maze() { return MZ; },
    step: function (sec, dt) { dt = dt || 0.05; for (var t = 0; t < sec && B.active; t += dt) update(dt); if (B.active) render(dt); },
    deploy: function (id, spotId) { var sp = B.spots.find(function (s) { return s.id === spotId; }); B.selected = id; onSpotTap(sp); },
    cast: function (id) { var u = B.pets.find(function (p) { return p.id === id; }); if (u) { u.sp = u.skill.cd; castSkill(u); } },
    move: function (path) { var d = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] }; path.split('').forEach(function (c) { mazeMove(d[c][0], d[c][1]); }); },
    openMaze: openMaze, startBattle: startBattle, doSummon: doSummon, craft: craft, feed: function (id, m) { curPet = id; feed(m); },
    addExp: addExp, petStats: petStats, equip: equip, openPet: openPet, tryShowClass: tryShowClass, saveNow: save,
    reset: function () { localStorage.removeItem(SAVE_KEY); location.reload(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
