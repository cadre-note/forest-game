/* =====================================================================
 * 晨露森旅 — data.js（純資料層）
 * 載入順序：index.html → <script src="data.js"> → <script src="game.js">
 * 本檔只放「資料與數值」，不含任何遊戲邏輯；game.js 一律讀 window.GAME_DATA。
 * 所有圖片位於 ./assets/，缺圖時 game.js 應改用各項目的 fallback（色塊＋字）。
 *
 * 單位約定
 *   時間：秒（s）　速度：格／秒　距離：格（戰場 3 列 × 5 欄）
 *   百分比欄位一律以「整數 %」表示（例：20 = 20%），倍率欄位以小數表示（例：1.6 = ×1.6）
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
   * 0. 版本與存檔
   * --------------------------------------------------------------- */
  const META = {
    title: '晨露森旅',
    dataVersion: '2.0.0',
    saveKey: 'morningdew_save_v1',   // localStorage key；改結構時升版並在 game.js 做遷移
    dailyResetHour: 4                // 每日任務／每日步數於本地時間 04:00 重置（避開 23:00 前後仍在玩的時段）
  };

  /* ---------------------------------------------------------------
   * 1. ASSETS — 圖片路徑（全部在 ./assets/）
   * --------------------------------------------------------------- */
  const ASSET_DIR = './assets/';
  const ASSETS = {
    pets: {
      pet_01: ASSET_DIR + 'pet_01.png',
      pet_02: ASSET_DIR + 'pet_02.png',
      pet_03: ASSET_DIR + 'pet_03.png',
      pet_04: ASSET_DIR + 'pet_04.png',
      pet_05: ASSET_DIR + 'pet_05.png',
      pet_06: ASSET_DIR + 'pet_06.png',
      pet_07: ASSET_DIR + 'pet_07.png',
      pet_08: ASSET_DIR + 'pet_08.png',
      pet_09: ASSET_DIR + 'pet_09.png',
      pet_10: ASSET_DIR + 'pet_10.png'
    },
    // 進化立繪：[一階 Lv.10, 二階 Lv.30]
    petEvo: {
      pet_01: [ASSET_DIR + 'pet_01_evo1.png', ASSET_DIR + 'pet_01_evo2.png'],
      pet_02: [ASSET_DIR + 'pet_02_evo1.png', ASSET_DIR + 'pet_02_evo2.png'],
      pet_03: [ASSET_DIR + 'pet_03_evo1.png', ASSET_DIR + 'pet_03_evo2.png'],
      pet_04: [ASSET_DIR + 'pet_04_evo1.png', ASSET_DIR + 'pet_04_evo2.png'],
      pet_05: [ASSET_DIR + 'pet_05_evo1.png', ASSET_DIR + 'pet_05_evo2.png'],
      pet_06: [ASSET_DIR + 'pet_06_evo1.png', ASSET_DIR + 'pet_06_evo2.png'],
      pet_07: [ASSET_DIR + 'pet_07_evo1.png', ASSET_DIR + 'pet_07_evo2.png'],
      pet_08: [ASSET_DIR + 'pet_08_evo1.png', ASSET_DIR + 'pet_08_evo2.png'],
      pet_09: [ASSET_DIR + 'pet_09_evo1.png', ASSET_DIR + 'pet_09_evo2.png'],
      pet_10: [ASSET_DIR + 'pet_10_evo1.png', ASSET_DIR + 'pet_10_evo2.png']
    },
    enemies: {
      enemy_01: ASSET_DIR + 'enemy_01.png',
      enemy_02: ASSET_DIR + 'enemy_02.png',
      enemy_03: ASSET_DIR + 'enemy_03.png',
      enemy_04: ASSET_DIR + 'enemy_04.png',
      enemy_05: ASSET_DIR + 'enemy_05.png',
      enemy_06: ASSET_DIR + 'enemy_06.png',
      enemy_07: ASSET_DIR + 'enemy_07.png',
      enemy_08: ASSET_DIR + 'enemy_08.png',
      enemy_09: ASSET_DIR + 'enemy_09.png'
    },
    materials: {
      mat_01: ASSET_DIR + 'mat_01.png',
      mat_02: ASSET_DIR + 'mat_02.png',
      mat_03: ASSET_DIR + 'mat_03.png'
    },
    items: {
      item_exp_berry:   ASSET_DIR + 'item_exp_berry.png',
      item_evo_stone:   ASSET_DIR + 'item_evo_stone.png',
      item_shiny_charm: ASSET_DIR + 'item_shiny_charm.png'
    },
    equipment: {
      eq_01: ASSET_DIR + 'eq_01.png',
      eq_02: ASSET_DIR + 'eq_02.png',
      eq_03: ASSET_DIR + 'eq_03.png'
    },
    props: {
      trailChest: ASSET_DIR + 'trail_chest.png',
      campBottle: ASSET_DIR + 'camp_bottle.png',
      campBasket: ASSET_DIR + 'camp_basket.png'
    },
    backgrounds: {
      camp:       ASSET_DIR + 'bg_camp.png',
      map:        ASSET_DIR + 'bg_map.png',
      trail:      ASSET_DIR + 'bg_trail.png',
      battle:     ASSET_DIR + 'bg_battle.png',
      battle_ch2: ASSET_DIR + 'bg_battle_ch2.png',
      battle_ch3: ASSET_DIR + 'bg_battle_ch3.png'
    }
  };

  /* ---------------------------------------------------------------
   * 2. 基礎系統定義：屬性、職業、稀有度、貨幣、素材
   * --------------------------------------------------------------- */
  // 屬性相剋：草 → 水 → 光 → 草（箭頭左方剋右方）
  const ELEMENTS = {
    grass: { name: '草', color: '#8FA876', strongVs: 'water', weakVs: 'light' },
    water: { name: '水', color: '#7FA6B8', strongVs: 'light', weakVs: 'grass' },
    light: { name: '光', color: '#E2C27A', strongVs: 'grass', weakVs: 'water' }
  };
  const ELEMENT_MULTIPLIER = { strong: 1.2, neutral: 1.0, weak: 0.9 };   // 微克制：剋制 +20%、被剋 −10%

  const ROLES = {
    guardian: { name: '守護', desc: '站在路線上阻擋怪物，承受傷害。', canBlock: true,  targeting: 'blocked' },
    ranged:   { name: '遠程', desc: '不阻擋，站在路旁草地上攻擊射程範圍內最接近營地的怪物。', canBlock: false, targeting: 'nearestToGoal' },
    healer:   { name: '療癒', desc: '不阻擋，治療範圍內血量比例最低的夥伴。', canBlock: false, targeting: 'lowestHpAlly' }
  };

  const RARITIES = {
    R:   { name: 'R',   color: '#A9B5A0', dupExpAfterMaxStar: 300 },
    SR:  { name: 'SR',  color: '#8DB3C7', dupExpAfterMaxStar: 600 },
    SSR: { name: 'SSR', color: '#E0B866', dupExpAfterMaxStar: 1500 },
    UR:  { name: 'UR',  label: '傳說', color: '#C9A8E8', dupExpAfterMaxStar: 3000 }
  };

  const CURRENCIES = {
    dew:          { name: '森林露水', desc: '由步數轉換，用於召喚與餵養。' },
    coins:        { name: '星塵',     desc: '戰鬥與任務取得，用於升級建築與合成。（程式內部 key 為 coins）' },
    summonTicket: { name: '召喚葉籤', desc: '可免費召喚 1 次（不消耗露水）。' }
  };

  // 道具（存檔 key：items）
  const ITEMS = {
    item_exp_berry:   { name: '元氣森果',     desc: '直接餵給精靈，EXP +300。', expGain: 300, fallback: { color: '#E59A8C', glyph: '果' } },
    item_evo_stone:   { name: '森之進化晶石', desc: 'Lv.10 一階進化需要 1 顆，Lv.30 二階進化需要 3 顆。', fallback: { color: '#8FC2A0', glyph: '晶' } },
    item_shiny_charm: { name: '星願幸運草',   desc: '使用後，下一次召喚每顆蛋的閃光機率提高到 20%。', fallback: { color: '#F2CF6E', glyph: '草' } }
  };

  const MATERIALS = {
    mat_01: { name: '柔軟苔絨', desc: '青苔岩與小栗球身上掉落的柔軟苔絨。', rarity: 'R', fallback: { color: '#9DB68A', glyph: '苔' } },
    mat_02: { name: '清澈露珠石', desc: '迷霧雲凝結而成的透明小石。',       rarity: 'R', fallback: { color: '#9CC3D2', glyph: '露' } },
    mat_03: { name: '晨曦花粉',   desc: '在晨光下會微微發亮的花粉。',       rarity: 'SR', fallback: { color: '#EBD08F', glyph: '粉' } }
  };

  /* ---------------------------------------------------------------
   * 3. 經濟與成長規則
   * --------------------------------------------------------------- */
  const ECONOMY = {
    stepsPerDew: 100,          // 100 步 = 1 森林露水
    dailyStepCap: 30000,       // 每日最多轉換 30,000 步（= 300 露水，未含營火加成）
    dewToExp: 30,              // 餵養：1 露水 = 30 經驗（只能餵給已擁有的精靈）
    retreatRefundPct: 50,      // 戰鬥中撤退返還 50% 部署費用
    equipSalvageReturnPct: 40, // 分解裝備返還 40% 素材（無條件捨去）
    offlineMaxHours: 12,       // 離線露水最多累積 12 小時（每小時產量見營火 offlineDewPerHour）
    newPlayer: { dew: 20, pets: ['pet_01'] }   // 新手禮：20 露水＋苔芽球，避免空營地
  };

  const SUMMON = {
    costDew: 10,               // 單抽 10 露水（孵化巢可降低，見 CAMP_BUILDINGS）
    multiCount: 10,            // 十連
    multiCostDew: 95,          // 十連 95 露水（約 95 折）
    rates: { R: 55, SR: 36, SSR: 7, UR: 2 },      // 基礎機率 %，加總 100（UR＝傳說）
    poolByRarity: {
      R:   ['pet_01', 'pet_02', 'pet_08'],
      SR:  ['pet_03', 'pet_04', 'pet_05', 'pet_07', 'pet_09'],
      SSR: ['pet_06'],
      UR:  ['pet_10']
    },
    pitySSR: 40,               // 連續 40 抽未出 SSR 以上，第 40 抽必定 SSR 或 UR（依 7:2 權重）
    multiGuaranteeSR: true     // 十連保底至少 1 隻 SR 以上
  };

  // 閃光異色：每顆蛋獨立判定；用星願幸運草後「下一次召喚」整批提升機率
  const SHINY = {
    name: '晨光閃光',
    ratePct: 5,
    charmRatePct: 20,
    statBonusPct: 10,          // 全屬性 +10%
    dupUpgrades: true          // 已有一般版時抽到閃光版：升級為閃光並照常得到 1 碎片
  };

  // 進化（與轉職合併）：Lv.10 消耗晶石一階進化並同時選擇轉職路線；Lv.30 二階進化為最終形態
  const EVOLUTION = {
    stages: [
      { stage: 1, lv: 10, cost: { items: { item_evo_stone: 1 } }, statMul: 1.10, chooseBranch: true,
        desc: '一階進化：消耗 1 顆進化晶石，同時選擇轉職路線（另需該精靈的轉職素材）' },
      { stage: 2, lv: 30, cost: { coins: 6000, items: { item_evo_stone: 3 }, mats: { mat_01: 15, mat_02: 15, mat_03: 15 } }, statMul: 1.25,
        desc: '二階進化：消耗 3 顆進化晶石，成為最終形態（全屬性共 +25%）' }
    ],
    forms: {
      pet_01: ['花園城堡龜', '櫻花古堡龜'],
      pet_02: ['橡葉騎士', '黃金橡果聖騎'],
      pet_03: ['晨光啾啾', '曙光天鵝'],
      pet_04: ['冰晶水滴精', '霜晶水靈'],
      pet_05: ['花環鈴鐺羊', '花冠鈴音羊'],
      pet_06: ['金燈菇菇', '星夜魔菇'],
      pet_07: ['冰晶狐寶', '九尾星霜狐'],
      pet_08: ['茶壺松鼠', '秋楓茶會松鼠'],
      pet_09: ['雛菊刺蝟', '日冕花刺蝟'],
      pet_10: ['月輝鹿靈', '星虹月鹿']
    }
  };

  // 重複精靈 → 星級突破（★1 為初次取得，最高 ★5）
  const STAR_RULES = {
    maxStar: 5,
    dupNeededForStar: { 2: 1, 3: 2, 4: 3, 5: 4 },  // 升到該星需要的重複數（累計 10 隻達 ★5）
    statBonusPctPerStar: 6                          // 每升 1 星：HP/ATK/DEF +6%（★5 合計 +24%）
  };

  // 等級：上限 30；EXP_TO_NEXT[i] = 從 Lv(i+1) 升到 Lv(i+2) 所需經驗
  const LEVEL_RULES = {
    maxLevel: 30,
    classChangeLevel: 10,        // ＝ 一階進化等級（見 EVOLUTION）
    expToNext: [80, 130, 210, 290, 390, 490, 610, 730, 860, 1000,
                1140, 1300, 1460, 1620, 1790, 1970, 2150, 2340, 2530, 2730,
                2940, 3150, 3360, 3580, 3800, 4030, 4260, 4490, 4740]
    // 累計：Lv10 需 3,790；Lv20 需 21,890；Lv30 需 58,170
  };

  /* ---------------------------------------------------------------
   * 4. 戰鬥規則（輕塔防）
   * --------------------------------------------------------------- */
  const BATTLE_RULES = {
    /* 戰場地形依章節而異：見 BATTLEFIELDS（座標皆為背景圖百分比） */
    // 距離換算（以戰場「寬度」的百分比為 1 單位）
    rangeUnitPct: { ranged: 13, healer: 22, guardian: 12 },  // 射程 3 的遠程 ≈ 39% 寬；療癒半徑 1.5 ≈ 33% 寬
    speedUnitPct: 20,                    // 怪物 speed 1.0 = 每秒走戰場寬度的 20%（整條路約 2.4 個寬度）
    laneOffsetPct: 2.5,                  // 關卡出怪表的 lane 0/1/2 轉為路徑左右微偏移，避免怪物完全重疊
    shockRadiusPct: 30,                  // 雷雲王震盪半徑（1.5）換算後 ≈ 戰場寬 30%
    knockbackPct: 10,                    // 擊退 1 格 ≈ 沿路徑後退戰場寬 10%
    teamSize: 4,                         // 出戰前最多挑 4 隻
    guardSnapPct: 4,                     // 守護點距離某條路徑 ≤ 戰場寬 4% 時，視為能阻擋該路徑
    autoSkill: { defaultOn: false },     // 右上角 AUTO：能量滿自動施放主動技
    lives: 5,                            // 泉水之心；一般怪漏 1 隻扣 1，Boss 扣 3
    energy: { start: 10, regenPerSec: 1, max: 60 },
    maxDeployed: 4,
    redeployCooldown: 20,                // 撤退後再部署冷卻（秒）
    downedRedeployCooldown: 30,          // 被打倒後再部署冷卻（秒）
    damage: {
      formula: 'max(atk × minRatio, atk − def) × 屬性倍率 × 暴擊倍率',
      minRatio: 0.15,
      baseCritRate: 5,                   // %
      baseCritDmg: 150                   // %
    },
    speedOptions: [1, 2],
    failurePenalty: 'none',              // 失敗不扣任何資源，可直接重試
    starRules: [
      { star: 1, cond: 'clear',       desc: '守住泉水通關' },
      { star: 2, cond: 'noLifeLost',  desc: '泉水之心未損失' },
      { star: 3, cond: 'costWithinCap', desc: '部署費用總和不超過關卡上限' }
    ]
  };

  /* ---------------------------------------------------------------
   * 4-1. BATTLEFIELDS — 各章節戰場地形
   * paths：可有多條（lane 0 走第 1 條、lane 2 走第 2 條、lane 1 輪流）；最後一點為終點
   * guardianSpots：守護型部署點（在路徑上，會阻擋經過的怪物）
   * supportSpots：遠程／療癒部署點；springSpots：任何職業可站，每秒回復 HP
   * paintedTiles：背景圖是否已畫好草地方塊（否則顯示柔和草墊標記）
   * --------------------------------------------------------------- */
  const BATTLEFIELDS = {
    ch1: {
      name: '晨露草原', bg: 'battle', paintedTiles: true, weather: null,
      paths: [
        [[50, 2], [49, 10], [54, 20], [53, 30], [34, 38], [22, 46], [46, 54], [74, 62], [68, 70], [52, 78], [49, 86], [49, 94]]
      ],
      guardianSpots: [{ id: 'g1', x: 54, y: 20 }, { id: 'g2', x: 53, y: 30 }, { id: 'g3', x: 22, y: 46 }, { id: 'g4', x: 74, y: 62 }, { id: 'g5', x: 52, y: 78 }],
      supportSpots: [
        { id: 's1', x: 25, y: 16 }, { id: 's2', x: 76, y: 17 }, { id: 's3', x: 75, y: 44 },
        { id: 's4', x: 24, y: 64 }, { id: 's5', x: 24, y: 81 }, { id: 's6', x: 75, y: 83 }
      ],
      springSpots: []
    },
    ch2: {
      name: '迷霧苔原', bg: 'battle_ch2', paintedTiles: false, weather: null,
      // 左上、右上兩條小徑在草地中央合流，再一起走向下方出口
      paths: [
        [[31, 31], [35, 36], [39, 40], [33, 45], [25, 49], [23, 53], [26, 60], [37, 68], [50, 75], [50, 86], [50, 97]],
        [[64, 28], [61, 34], [65, 39], [71, 42], [78, 46], [81, 51], [77, 56], [70, 61], [60, 69], [50, 75], [50, 86], [50, 97]]
      ],
      guardianSpots: [{ id: 'g1', x: 39, y: 40 }, { id: 'g2', x: 24, y: 52 }, { id: 'g3', x: 80, y: 50 }, { id: 'g4', x: 50, y: 76 }, { id: 'g5', x: 50, y: 88 }],
      supportSpots: [
        { id: 's1', x: 50, y: 44 }, { id: 's2', x: 49, y: 59 }, { id: 's3', x: 22, y: 73 },
        { id: 's4', x: 77, y: 72 }, { id: 's5', x: 34, y: 83 }, { id: 's6', x: 66, y: 83 }
      ],
      // 左側合流處的微光泉水格：任何職業可站，站上去每秒回復 3% 最大 HP（守護站這裡也能阻擋左路）
      springSpots: [{ id: 'w1', x: 27, y: 61, name: '微光泉水', healPctPerSec: 3 }]
    },
    ch3: {
      name: '雷雲山谷', bg: 'battle_ch3', paintedTiles: false,
      weather: { id: 'static', name: '靜電天氣', desc: '空氣劈啪作響，水屬性精靈攻速 +15%', element: 'water', aspdPct: 15 },
      // 短直衝路：比前兩章更短，怪物更快抵達營地
      paths: [
        [[57, 29], [44, 34], [45, 37], [53, 39], [60, 42], [62, 46], [60, 49], [55, 52], [50, 57], [49, 63], [49, 80], [48, 86], [50, 92], [50, 97]]
      ],
      guardianSpots: [{ id: 'g1', x: 44, y: 35 }, { id: 'g2', x: 62, y: 46 }, { id: 'g3', x: 50, y: 57 }, { id: 'g4', x: 49, y: 72 }, { id: 'g5', x: 49, y: 86 }],
      supportSpots: [
        { id: 's1', x: 30, y: 45 }, { id: 's2', x: 75, y: 56 }, { id: 's3', x: 28, y: 60 },
        { id: 's4', x: 72, y: 72 }, { id: 's5', x: 28, y: 75 }, { id: 's6', x: 75, y: 39 }
      ],
      springSpots: []
    }
  };

  /* ---------------------------------------------------------------
   * 5. PETS — 10 隻精靈
   * 數值為 Lv.1、★1；每級增加 growth；進化乘上 EVOLUTION.statMul，轉職分支再乘 statMul，閃光再 +10%。
   * trait：天生特性（不需轉職）— onHitSlow / onHitDefDown / energyRegen。
   * range：射程單位，實際半徑 = range × BATTLE_RULES.rangeUnitPct[職業]（% 戰場寬）；守護優先攻擊自己阻擋的怪物。
   * aspd：攻擊／治療間隔（秒），越小越快。
   * 技能 effects 型別（game.js 需實作）：
   *   buff{stat,pct} / block{add} / heal{atkPct} / hot{maxHpPct,tick} / damage{atkPct}
   *   stun{sec} / knockback{cells} / slow{pct,sec} / dmgReduce{pct} / energy{add} / aspd{mul} / defDown{pct,sec}
   * --------------------------------------------------------------- */
  const PETS = [
    {
      id: 'pet_01', name: '苔蘚龜龜', role: 'guardian', element: 'grass', rarity: 'R',
      lore: '背上長滿軟軟的青苔，頭頂冒著一株小新芽，總是慢慢走到大家前面擋著。',
      base: { hp: 950, atk: 62, def: 85, aspd: 1.3, range: 1, block: 2, critRate: 5 },
      growth: { hp: 48, atk: 4.0, def: 4.5 },
      cost: 10,
      skill: {
        id: 'sk_moss_shield', name: '苔絨護盾', cd: 18, initialCd: 6, duration: 6, target: 'self',
        desc: '6 秒內防禦 +60%，阻擋數 +1。',
        effects: [{ type: 'buff', stat: 'def', pct: 60 }, { type: 'block', add: 1 }]
      },
      classChange: {
        cost: { coins: 1500, mats: { mat_01: 12, mat_02: 4 } },
        branches: [
          {
            id: 'pet_01_a', name: '森苔壁壘', desc: '更硬的牆：HP、防禦提升，被阻擋的怪物移速 −20%。',
            statMul: { hp: 1.20, def: 1.15 },
            skillMod: { duration: 8 },
            passive: { type: 'slowBlocked', pct: 20 }
          },
          {
            id: 'pet_01_b', name: '荊棘苔衛', desc: '會反擊的牆：攻擊提升，反彈 15% 承受的近戰傷害。',
            statMul: { atk: 1.25 },
            skillMod: { addEffects: [{ type: 'damage', atkPct: 120 }] },
            passive: { type: 'reflect', pct: 15 }
          }
        ]
      },
      fallback: { color: '#8FA876', glyph: '龜' }
    },
    {
      id: 'pet_02', name: '橡果盾寶', role: 'healer', element: 'water', rarity: 'R',
      lore: '戴著橡果帽、揹著木頭小圓盾，會先替受傷的夥伴擋住風，再輕輕拍拍他們。',
      base: { hp: 520, atk: 75, def: 35, aspd: 2.2, range: 1.5, block: 0, critRate: 5 },
      growth: { hp: 24, atk: 4.2, def: 1.8 },
      cost: 9,
      skill: {
        id: 'sk_dew_chime', name: '清露鈴音', cd: 20, initialCd: 8, duration: 0, target: 'alliesInRange',
        desc: '立即治療範圍內所有夥伴，治療量為攻擊力 180%。',
        effects: [{ type: 'heal', atkPct: 180 }]
      },
      classChange: {
        cost: { coins: 1500, mats: { mat_02: 12, mat_01: 4 } },
        branches: [
          {
            id: 'pet_02_a', name: '泉音祭司', desc: '專精治療：治療量 +20%，技能額外附加 6 秒持續回復。',
            statMul: { atk: 1.20 },
            skillMod: { addEffects: [{ type: 'hot', maxHpPct: 2, tick: 1, sec: 6 }] },
            passive: { type: 'none' }
          },
          {
            id: 'pet_02_b', name: '霧雨鈴使', desc: '控場輔助：技能同時使範圍內怪物緩速 30%（5 秒），治療範圍 +0.5 格。',
            statMul: { hp: 1.10 },
            skillMod: { addEffects: [{ type: 'slow', pct: 30, sec: 5, target: 'enemiesInRange' }] },
            passive: { type: 'rangeAdd', add: 0.5 }
          }
        ]
      },
      fallback: { color: '#7FA6B8', glyph: '橡' }
    },
    {
      id: 'pet_03', name: '蒲公英啾啾', role: 'ranged', element: 'light', rarity: 'SR',
      lore: '頭頂長著一撮蒲公英絨毛的小雛鳥，拍拍翅膀就會射出閃亮的小光箭。',
      base: { hp: 480, atk: 128, def: 32, aspd: 1.1, range: 3, block: 0, critRate: 10 },
      growth: { hp: 22, atk: 6.5, def: 1.6 },
      cost: 12,
      skill: {
        id: 'sk_dawn_volley', name: '曙光連射', cd: 15, initialCd: 5, duration: 5, target: 'self',
        desc: '5 秒內攻擊速度 ×1.8。',
        effects: [{ type: 'aspd', mul: 1.8 }]
      },
      classChange: {
        cost: { coins: 2500, mats: { mat_03: 10, mat_02: 6 } },
        branches: [
          {
            id: 'pet_03_a', name: '破曉射手', desc: '單體爆發：射程 +1，暴擊率 +15%。',
            statMul: { atk: 1.10 },
            skillMod: { duration: 6 },
            passive: { type: 'rangeAdd', add: 1, critRateAdd: 15 }
          },
          {
            id: 'pet_03_b', name: '光環羽使', desc: '群體清場：普攻同時命中射程內 3 個目標，每個 65% 傷害。',
            statMul: { hp: 1.10 },
            skillMod: {},
            passive: { type: 'multiTarget', targets: 3, dmgPct: 65 }
          }
        ]
      },
      fallback: { color: '#E2C27A', glyph: '啾' }
    },
    {
      id: 'pet_04', name: '泡泡水滴精', role: 'guardian', element: 'water', rarity: 'SR',
      lore: '一顆會走路的水滴，懷裡抱著亮晶晶的泡泡，碰到的人都會覺得清涼起來。',
      base: { hp: 1150, atk: 70, def: 110, aspd: 1.5, range: 1, block: 3, critRate: 5 },
      growth: { hp: 60, atk: 4.0, def: 5.5 },
      cost: 14,
      skill: {
        id: 'sk_lotus_surge', name: '蓮葉潮湧', cd: 22, initialCd: 8, duration: 0, target: 'blocked',
        desc: '對被阻擋的怪物造成攻擊力 150% 傷害，擊退 1 格並暈眩 1.5 秒。',
        effects: [{ type: 'damage', atkPct: 150 }, { type: 'knockback', cells: 1 }, { type: 'stun', sec: 1.5 }]
      },
      classChange: {
        cost: { coins: 2500, mats: { mat_02: 10, mat_01: 8 } },
        branches: [
          {
            id: 'pet_04_a', name: '古蓮守者', desc: '終極坦克：阻擋數 +1，HP +25%。',
            statMul: { hp: 1.25 },
            skillMod: {},
            passive: { type: 'blockAdd', add: 1 }
          },
          {
            id: 'pet_04_b', name: '潮汐巡守', desc: '節奏控場：技能冷卻 −6 秒，施放時回復自身 20% 最大 HP。',
            statMul: { def: 1.10 },
            skillMod: { cdAdd: -6, addEffects: [{ type: 'heal', maxHpPct: 20, target: 'self' }] },
            passive: { type: 'none' }
          }
        ]
      },
      fallback: { color: '#7FA6B8', glyph: '泡' }
    },
    {
      id: 'pet_05', name: '洋甘菊羊咩', role: 'healer', element: 'light', rarity: 'SR',
      lore: '捲捲羊毛裡開著幾朵洋甘菊，靠近時會聞到淡淡花香，讓人慢慢放鬆下來。',
      base: { hp: 600, atk: 88, def: 42, aspd: 2.0, range: 2, block: 0, critRate: 5 },
      growth: { hp: 28, atk: 4.8, def: 2.0 },
      cost: 13,
      skill: {
        id: 'sk_firefly_ward', name: '螢火庇護', cd: 25, initialCd: 10, duration: 8, target: 'allAllies',
        desc: '8 秒內全場夥伴每秒回復 3% 最大 HP，承受傷害 −20%。',
        effects: [{ type: 'hot', maxHpPct: 3, tick: 1 }, { type: 'dmgReduce', pct: 20 }]
      },
      classChange: {
        cost: { coins: 2500, mats: { mat_03: 10, mat_01: 6 } },
        branches: [
          {
            id: 'pet_05_a', name: '聖螢牧者', desc: '全隊守護：在場時全場夥伴防禦 +10%。',
            statMul: { hp: 1.10, atk: 1.10 },
            skillMod: {},
            passive: { type: 'auraBuff', stat: 'def', pct: 10, target: 'allAllies' }
          },
          {
            id: 'pet_05_b', name: '夜螢引路者', desc: '資源運營：在場時露珠能量回復 +0.2／秒，技能冷卻 −5 秒。',
            statMul: {},
            skillMod: { cdAdd: -5 },
            passive: { type: 'energyRegen', add: 0.2 }
          }
        ]
      },
      fallback: { color: '#E2C27A', glyph: '羊' }
    },
    {
      id: 'pet_06', name: '微光菇菇', role: 'ranged', element: 'grass', rarity: 'SSR',
      lore: '頂著暖黃色的大菇傘、提著小燈籠，在昏暗的森林裡也能替大家照亮方向。',
      base: { hp: 540, atk: 150, def: 36, aspd: 1.25, range: 4, block: 0, critRate: 8 },
      growth: { hp: 25, atk: 7.5, def: 1.8 },
      cost: 16,
      skill: {
        id: 'sk_fluff_storm', name: '絨絮風暴', cd: 24, initialCd: 10, duration: 0, target: 'enemiesInRange3Lanes',
        desc: '對射程內（範圍 ×1.25）所有怪物造成攻擊力 220% 傷害，並緩速 25%（4 秒）。',
        effects: [{ type: 'damage', atkPct: 220 }, { type: 'slow', pct: 25, sec: 4 }]
      },
      classChange: {
        cost: { coins: 4000, mats: { mat_03: 15, mat_01: 10 } },
        branches: [
          {
            id: 'pet_06_a', name: '風信狐仙', desc: '技能特化：技能傷害提升為 300%，冷卻 −4 秒。',
            statMul: { atk: 1.10 },
            skillMod: { cdAdd: -4, effectOverride: { damage: { atkPct: 300 } } },
            passive: { type: 'none' }
          },
          {
            id: 'pet_06_b', name: '種籽漫遊者', desc: '持續輸出：普攻同時命中射程內所有怪物（60% 傷害），每擊倒 1 隻回復 1 點能量。',
            statMul: { hp: 1.10 },
            skillMod: {},
            passive: { type: 'pierce', dmgPct: 60, energyOnKill: 1 }
          }
        ]
      },
      fallback: { color: '#8FA876', glyph: '菇' }
    },
    {
      id: 'pet_07', name: '星霜狐寶', role: 'ranged', element: 'water', rarity: 'SR',
      lore: '尾巴像一團結霜的雲，呼一口氣就會飄下細細的冰晶，讓怪物慢下腳步。',
      base: { hp: 470, atk: 112, def: 34, aspd: 1.2, range: 3, block: 0, critRate: 8 },
      growth: { hp: 21, atk: 5.8, def: 1.6 },
      cost: 12,
      trait: { type: 'onHitSlow', pct: 15, sec: 1.5, desc: '普攻使怪物緩速 15%（1.5 秒）' },
      skill: {
        id: 'sk_frost_breath', name: '霜晶吐息', cd: 20, initialCd: 7, duration: 0, target: 'enemiesInRange',
        desc: '對射程內所有怪物造成攻擊力 120% 傷害，緩速 45%（5 秒）並凍住 1 秒。',
        effects: [{ type: 'damage', atkPct: 120 }, { type: 'slow', pct: 45, sec: 5 }, { type: 'stun', sec: 1 }]
      },
      classChange: {
        cost: { coins: 2500, mats: { mat_02: 10, mat_03: 6 } },
        branches: [
          { id: 'pet_07_a', name: '冰封術士', desc: '控場特化：技能凍結延長為 2.5 秒，攻擊 +10%。',
            statMul: { atk: 1.10 }, skillMod: { effectOverride: { stun: { sec: 2.5 } } }, passive: { type: 'none' } },
          { id: 'pet_07_b', name: '霜雪巡風', desc: '大範圍緩速：射程 +1，技能緩速提高到 60%。',
            statMul: { hp: 1.10 }, skillMod: { effectOverride: { slow: { pct: 60 } } }, passive: { type: 'rangeAdd', add: 1 } }
        ]
      },
      fallback: { color: '#A9CFE0', glyph: '狐' }
    },
    {
      id: 'pet_08', name: '茶芽松鼠', role: 'guardian', element: 'grass', rarity: 'R',
      lore: '抱著熱茶杯到處泡茶的小松鼠，在場上時會慢慢替大家攢下部署能量。',
      base: { hp: 760, atk: 70, def: 60, aspd: 1.1, range: 1, block: 1, critRate: 5 },
      growth: { hp: 38, atk: 4.2, def: 3.2 },
      cost: 7,
      trait: { type: 'energyRegen', add: 0.4, desc: '先鋒：在場時露珠能量每秒 +0.4' },
      skill: {
        id: 'sk_warm_tea', name: '暖茶補給', cd: 16, initialCd: 4, duration: 6, target: 'self',
        desc: '立即回復 8 點部署能量，6 秒內自身防禦 +30%。',
        effects: [{ type: 'energy', add: 8 }, { type: 'buff', stat: 'def', pct: 30 }]
      },
      classChange: {
        cost: { coins: 1500, mats: { mat_01: 10, mat_02: 4 } },
        branches: [
          { id: 'pet_08_a', name: '森林茶師', desc: '產費特化：在場時能量每秒再 +0.3，HP +10%。',
            statMul: { hp: 1.10 }, skillMod: {}, passive: { type: 'energyRegen', add: 0.3 } },
          { id: 'pet_08_b', name: '先鋒松鼠', desc: '前線先鋒：阻擋數 +1，攻擊 +20%、防禦 +10%。',
            statMul: { atk: 1.20, def: 1.10 }, skillMod: {}, passive: { type: 'blockAdd', add: 1 } }
        ]
      },
      fallback: { color: '#B9875A', glyph: '鼠' }
    },
    {
      id: 'pet_09', name: '暖陽刺蝟', role: 'ranged', element: 'light', rarity: 'SR',
      lore: '背上的刺開滿了小雛菊，曬飽太陽後射出的暖光刺能讓怪物的硬殼鬆軟下來。',
      base: { hp: 520, atk: 104, def: 40, aspd: 1.4, range: 2.5, block: 0, critRate: 6 },
      growth: { hp: 24, atk: 5.2, def: 2.0 },
      cost: 11,
      trait: { type: 'onHitDefDown', pct: 15, sec: 3, desc: '普攻使怪物防禦 −15%（3 秒）' },
      skill: {
        id: 'sk_sun_spines', name: '暖陽刺光', cd: 22, initialCd: 8, duration: 0, target: 'enemiesInRange',
        desc: '對射程內所有怪物造成攻擊力 150% 傷害，並使其防禦 −40%（8 秒）。',
        effects: [{ type: 'damage', atkPct: 150 }, { type: 'defDown', pct: 40, sec: 8 }]
      },
      classChange: {
        cost: { coins: 2500, mats: { mat_03: 10, mat_01: 6 } },
        branches: [
          { id: 'pet_09_a', name: '日冕刺蝟', desc: '破甲特化：技能降防提高到 55%，攻擊 +10%。',
            statMul: { atk: 1.10 }, skillMod: { effectOverride: { defDown: { pct: 55 } } }, passive: { type: 'none' } },
          { id: 'pet_09_b', name: '花刺守望', desc: '群體輸出：普攻同時命中 2 個目標（每個 80% 傷害），HP +10%。',
            statMul: { hp: 1.10 }, skillMod: {}, passive: { type: 'multiTarget', targets: 2, dmgPct: 80 } }
        ]
      },
      fallback: { color: '#EDB98A', glyph: '蝟' }
    },
    {
      id: 'pet_10', name: '月光鹿靈', role: 'healer', element: 'light', rarity: 'UR',
      lore: '只在滿月的夜裡現身的傳說小鹿，鹿角的月光能同時灼退怪物、撫平夥伴的傷。',
      base: { hp: 680, atk: 120, def: 46, aspd: 1.8, range: 2, block: 0, critRate: 10 },
      growth: { hp: 30, atk: 6.5, def: 2.2 },
      cost: 17,
      skill: {
        id: 'sk_moon_flow', name: '月華流轉', cd: 26, initialCd: 10, duration: 0, target: 'enemiesInRange',
        desc: '對範圍內所有怪物造成攻擊力 200% 傷害，同時治療全場夥伴（攻擊力 150%）。',
        effects: [{ type: 'damage', atkPct: 200 }, { type: 'heal', atkPct: 150, target: 'allAllies' }]
      },
      classChange: {
        cost: { coins: 4000, mats: { mat_03: 15, mat_02: 10 } },
        branches: [
          { id: 'pet_10_a', name: '滿月祭司', desc: '頻率特化：技能冷卻 −5 秒，攻擊 +15%。',
            statMul: { atk: 1.15 }, skillMod: { cdAdd: -5 }, passive: { type: 'none' } },
          { id: 'pet_10_b', name: '星虹鹿神', desc: '全隊守護：在場時全場夥伴防禦 +10%，HP +15%。',
            statMul: { hp: 1.15 }, skillMod: {}, passive: { type: 'auraBuff', stat: 'def', pct: 10, target: 'allAllies' } }
        ]
      },
      fallback: { color: '#F0DDB0', glyph: '鹿' }
    }
  ];

  /* ---------------------------------------------------------------
   * 6. ENEMIES — 9 種怪物（數值為關卡倍率 1.0 時）
   * flying：無視地面阻擋，守護型的普攻打不到，只受遠程／療癒的攻擊與技能控場影響
   * speed：路徑速度單位（× BATTLE_RULES.speedUnitPct）；atkInterval：秒；leakDamage：漏怪扣的泉水之心
   * --------------------------------------------------------------- */
  const ENEMIES = [
    {
      id: 'enemy_01', name: '小迷霧雲', type: '平衡', element: 'water',
      desc: '軟綿綿的霧氣團，什麼都會一點。',
      stats: { hp: 320, atk: 40, def: 10, speed: 0.35, atkInterval: 1.5 },
      leakDamage: 1, isBoss: false,
      special: null,
      rewards: { coins: 5, drops: [{ id: 'mat_02', chance: 15, n: 1 }] },
      fallback: { color: '#C9D4D8', glyph: '霧' }
    },
    {
      id: 'enemy_02', name: '滾滾小栗球', type: '高速', element: 'grass',
      desc: '一路滾不停的小栗子，血少但跑得飛快。',
      stats: { hp: 200, atk: 30, def: 5, speed: 0.65, atkInterval: 1.0 },
      leakDamage: 1, isBoss: false,
      special: null,
      rewards: { coins: 4, drops: [{ id: 'mat_01', chance: 15, n: 1 }] },
      fallback: { color: '#B08A62', glyph: '栗' }
    },
    {
      id: 'enemy_03', name: '打盹青苔岩', type: '高防肉盾', element: 'water',
      desc: '邊走邊打瞌睡的大石頭，非常耐打。',
      stats: { hp: 1100, atk: 55, def: 45, speed: 0.2, atkInterval: 2.2 },
      leakDamage: 1, isBoss: false,
      special: null,
      rewards: { coins: 10, drops: [{ id: 'mat_01', chance: 30, n: 1 }, { id: 'mat_02', chance: 10, n: 1 }] },
      fallback: { color: '#7E8F72', glyph: '岩' }
    },
    {
      id: 'enemy_04', name: '噴嚏花粉團', type: '持續微傷', element: 'grass',
      desc: '一直打噴嚏的花粉球，阻擋牠的夥伴會被噴得受不了。',
      stats: { hp: 380, atk: 25, def: 15, speed: 0.3, atkInterval: 1.6 },
      leakDamage: 1, isBoss: false,
      // 被阻擋時，對「正在阻擋牠的所有夥伴」每秒造成 12 點真實傷害（無視防禦，隨關卡倍率成長）
      special: { type: 'blockerDot', dmgPerSec: 12, trueDamage: true, scalesWithStage: true },
      rewards: { coins: 7, drops: [{ id: 'mat_03', chance: 20, n: 1 }] },
      fallback: { color: '#E6D27E', glyph: '粉' }
    },
    {
      id: 'enemy_05', name: '氣噗噗雷雲王', type: 'Boss', element: 'light',
      desc: '氣到冒煙的大雷雲，每隔一陣子就重重踏地震盪四周。',
      stats: { hp: 9000, atk: 120, def: 60, speed: 0.15, atkInterval: 2.0 },
      leakDamage: 3, isBoss: true,
      // 範圍震盪：每 9 秒對自身半徑 1.5 格內所有夥伴造成 180 傷害（無視 50% 防禦）並暈眩 1 秒
      // 狂怒：HP ≤ 30% 時震盪間隔縮短為 6 秒
      special: {
        type: 'shockwave', interval: 9, radius: 1.5, dmg: 180, defIgnorePct: 50, stunSec: 1,
        enrage: { hpPctBelow: 30, interval: 6 }
      },
      rewards: {
        coins: 200,
        drops: [{ id: 'mat_01', chance: 100, n: 3 }, { id: 'mat_02', chance: 100, n: 3 }, { id: 'mat_03', chance: 100, n: 3 }]
      },
      fallback: { color: '#8C8FA8', glyph: '雷' }
    },
    {
      id: 'enemy_06', name: '飛行蒲公英', type: '飛行', element: 'grass',
      desc: '乘著風飄過來的絨毛球，守護型擋不住，只能靠遠程與控場。',
      stats: { hp: 260, atk: 0, def: 8, speed: 0.5, atkInterval: 9 },
      leakDamage: 1, isBoss: false, flying: true,
      special: null,
      rewards: { coins: 6, drops: [{ id: 'mat_03', chance: 15, n: 1 }] },
      fallback: { color: '#EFE6CF', glyph: '絨' }
    },
    {
      id: 'enemy_07', name: '分裂果凍怪', type: '分裂', element: 'water',
      desc: '彈呀彈的果凍，被擊敗時會啪一聲分成 2 隻小果凍。',
      stats: { hp: 420, atk: 32, def: 6, speed: 0.33, atkInterval: 1.4 },
      leakDamage: 1, isBoss: false,
      special: { type: 'split', count: 2, childHpPct: 35, childAtkPct: 60, childSize: 0.65, childCoins: 2 },
      rewards: { coins: 6, drops: [{ id: 'mat_02', chance: 15, n: 1 }] },
      fallback: { color: '#9FE0C2', glyph: '凍' }
    },
    {
      id: 'enemy_08', name: '護盾岩龜', type: '護盾', element: 'light',
      desc: '背著能量泡泡的岩石龜，護盾破掉前受到的傷害大幅降低。',
      stats: { hp: 900, atk: 50, def: 55, speed: 0.2, atkInterval: 2.0 },
      leakDamage: 1, isBoss: false,
      // 護盾值 = 最大 HP 的 50%；護盾存在時受到的傷害 −70%，打掉護盾值後消失
      special: { type: 'shield', shieldPct: 50, reducePct: 70 },
      rewards: { coins: 12, drops: [{ id: 'mat_01', chance: 25, n: 1 }, { id: 'mat_03', chance: 10, n: 1 }] },
      fallback: { color: '#A99F8B', glyph: '盾' }
    },
    {
      id: 'enemy_09', name: '古木樹樁', type: 'Boss', element: 'grass',
      desc: '頭頂長滿蘑菇的老樹樁，每隔一陣子就喚來一群小栗球。第 2 章關底 Boss。',
      stats: { hp: 12000, atk: 110, def: 70, speed: 0.13, atkInterval: 2.2 },
      leakDamage: 3, isBoss: true,
      // 每 10 秒召喚 2 隻小栗球；HP ≤ 40% 時每 7 秒召喚 3 隻
      special: { type: 'summon', enemy: 'enemy_02', interval: 12, count: 1, enrage: { hpPctBelow: 40, interval: 9, count: 2 } },
      rewards: {
        coins: 220,
        drops: [{ id: 'mat_01', chance: 100, n: 4 }, { id: 'mat_02', chance: 100, n: 3 }, { id: 'mat_03', chance: 100, n: 3 }]
      },
      fallback: { color: '#9C8A62', glyph: '樁' }
    }
  ];

  // 菁英怪：spawn 帶 elite:true 時套用
  const ELITE_MODIFIER = { hpMul: 2.0, atkMul: 1.5, defMul: 1.2, coinsMul: 3, dropChanceMul: 2, scale: 1.3 };

  /* ---------------------------------------------------------------
   * 7. CHAPTERS — 3 章 15 關＋無盡模式（battlefield 指向 BATTLEFIELDS）
   * waves[].delay：第 1 波＝開戰後幾秒；之後＝前一波「最後一隻出場」後幾秒
   * spawns[]：{ e: 怪物 id, lane: 0~2（單一路徑上的左右微偏移）, n: 數量, gap: 間隔秒, at: 該波開始後幾秒開始出, elite?, hpMul? }
   * statMul：本關怪物 HP/ATK/DEF 共同倍率；困難模式再乘上 difficulty.hard
   * pos：關卡節點在 bg_map.png 上的百分比座標（沿著圖中小徑，三章共用同一張地圖）
   * rewards.clear：每次通關（可重複）；first：首通；threeStar：首次三星
   * exp 為每隻出戰精靈獲得的經驗
   * --------------------------------------------------------------- */
  const DIFFICULTY = {
    normal: { name: '普通', hpMul: 1.0, atkMul: 1.0,  defMul: 1.0,  speedMul: 1.0, rewardMul: 1.0, unlock: 'previousStageNormal' },
    hard:   { name: '困難', hpMul: 1.6, atkMul: 1.35, defMul: 1.15, speedMul: 1.1, rewardMul: 1.5, unlock: 'chapterNormalAllClear' }
  };

  const CHAPTERS = [
    {
      id: 'ch1',
      name: '晨露草原',
      desc: '晨霧還沒散去的草原，小怪物們剛睡醒。',
      stages: [
        {
          id: '1-1',
          name: '露珠小徑',
          pos: { x: 70, y: 76 },
          statMul: 1,
          recommendLv: 1,
          costCap: 30,
          tip: '把守護型精靈放在怪物會經過的路線上擋住牠們。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 3, gap: 4, at: 0 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 4, gap: 3, at: 0 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 2, gap: 3, at: 0 },
                { e: 'enemy_01', lane: 2, n: 2, gap: 3, at: 1.5 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 80, exp: 60 },
            first: { dew: 10, coins: 200, mats: { mat_02: 2 } },
            threeStar: { dew: 5, mats: { mat_01: 2 } }
          }
        },
        {
          id: '1-2',
          name: '蒲公英坡',
          pos: { x: 38, y: 64 },
          statMul: 1.05,
          recommendLv: 2,
          costCap: 34,
          tip: '小栗球跑很快，遠程精靈放在前段比較打得到。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 3, gap: 3.5, at: 0 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 3, gap: 2, at: 0 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 3, gap: 3, at: 0 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 2, at: 2 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_02', lane: 1, n: 4, gap: 1.5, at: 0 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 90, exp: 65 },
            first: { dew: 10, coins: 200, mats: { mat_01: 3 } },
            threeStar: { dew: 5, mats: { mat_02: 2 } }
          }
        },
        {
          id: '1-3',
          name: '薄霧溪畔',
          pos: { x: 64, y: 48 },
          statMul: 1.1,
          recommendLv: 3,
          costCap: 38,
          tip: '霧氣一團接一團湧來，把守護分散在不同轉角層層攔截。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 2, gap: 3, at: 0 },
                { e: 'enemy_01', lane: 2, n: 2, gap: 3, at: 0 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 4, gap: 2.5, at: 0 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.8, at: 0 },
                { e: 'enemy_01', lane: 1, n: 2, gap: 3, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 2, gap: 2.5, at: 0 },
                { e: 'enemy_01', lane: 1, n: 2, gap: 2.5, at: 0.5 },
                { e: 'enemy_01', lane: 2, n: 2, gap: 2.5, at: 1 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 100, exp: 70 },
            first: { dew: 10, coins: 250, mats: { mat_02: 3 } },
            threeStar: { dew: 5, mats: { mat_01: 3 } }
          }
        },
        {
          id: '1-4',
          name: '小栗樹叢',
          pos: { x: 45, y: 33 },
          statMul: 1.18,
          recommendLv: 5,
          costCap: 42,
          tip: '大量小栗球衝鋒！善用技能一口氣清場。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_02', lane: 1, n: 4, gap: 1.5, at: 0 }
              ]
            },
            {
              delay: 6,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.5, at: 0 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.5, at: 0.8 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 3, gap: 3, at: 0 },
                { e: 'enemy_02', lane: 1, n: 3, gap: 1.5, at: 4 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.2, at: 0 },
                { e: 'enemy_02', lane: 1, n: 3, gap: 1.2, at: 0.4 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.2, at: 0.8 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 120, exp: 85 },
            first: { dew: 10, coins: 300, mats: { mat_01: 4 } },
            threeStar: { dew: 5, mats: { mat_02: 3 } }
          }
        },
        {
          id: '1-5',
          name: '苔石守門',
          pos: { x: 72, y: 21 },
          statMul: 1.25,
          recommendLv: 7,
          costCap: 46,
          tip: '菁英青苔岩非常耐打，用草屬性精靈攻擊效果最好。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 3, gap: 3, at: 0 },
                { e: 'enemy_02', lane: 0, n: 2, gap: 2, at: 2 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_01', lane: 2, n: 3, gap: 3, at: 2 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.5, at: 0 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.5, at: 0.5 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0, elite: true },
                { e: 'enemy_01', lane: 0, n: 2, gap: 3, at: 3 },
                { e: 'enemy_01', lane: 2, n: 2, gap: 3, at: 3 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 160, exp: 100 },
            first: { dew: 15, coins: 400, summonTicket: 1, mats: { mat_01: 5, mat_02: 3 } },
            threeStar: { dew: 8, mats: { mat_03: 2 } }
          }
        }
      ],
      battlefield: 'ch1'
    },
    {
      id: 'ch2',
      name: '迷霧苔原',
      desc: '兩條小徑在霧裡交會，合流處有一汪微光泉水。',
      stages: [
        {
          id: '2-1',
          name: '苔橋入口',
          pos: { x: 70, y: 76 },
          statMul: 1.35,
          recommendLv: 9,
          costCap: 48,
          tip: '分裂果凍被打倒會變成 2 隻小果凍，別讓牠們溜過去。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_02', lane: 1, n: 3, gap: 1.5, at: 4 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 3, gap: 2.5, at: 0 },
                { e: 'enemy_07', lane: 2, n: 2, gap: 3, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 0 },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 3 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.2, at: 0 },
                { e: 'enemy_02', lane: 1, n: 3, gap: 1.2, at: 0.5 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.2, at: 1 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 180, exp: 150 },
            first: { dew: 15, coins: 450, mats: { mat_01: 5 } },
            threeStar: { dew: 8, mats: { mat_02: 4 } }
          }
        },
        {
          id: '2-2',
          name: '打盹岩群',
          pos: { x: 38, y: 64 },
          statMul: 1.45,
          recommendLv: 11,
          costCap: 50,
          tip: '飛行蒲公英會飄過守護型頭頂，記得派遠程精靈。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 2, gap: 5, at: 0 }
              ]
            },
            {
              delay: 6,
              spawns: [
                { e: 'enemy_03', lane: 2, n: 2, gap: 5, at: 0 },
                { e: 'enemy_01', lane: 1, n: 3, gap: 3, at: 2 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 2, gap: 4, at: 0 },
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.5, at: 3 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.5, at: 3 },
                { e: 'enemy_06', lane: 1, n: 3, gap: 2, at: 1 }
              ]
            },
            {
              delay: 9,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0, elite: true },
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 4 },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 4 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 200, exp: 170 },
            first: { dew: 15, coins: 500, mats: { mat_01: 6, mat_02: 2 } },
            threeStar: { dew: 8, mats: { mat_03: 2 } }
          }
        },
        {
          id: '2-3',
          name: '花粉風口',
          pos: { x: 64, y: 48 },
          statMul: 1.55,
          recommendLv: 13,
          costCap: 52,
          tip: '護盾岩龜的泡泡破掉前很難打痛，用技能集中火力；花粉團記得配療癒。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_04', lane: 1, n: 2, gap: 4, at: 0 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 4, at: 0 },
                { e: 'enemy_01', lane: 2, n: 3, gap: 2.5, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_04', lane: 1, n: 2, gap: 3, at: 3 },
                { e: 'enemy_08', lane: 0, n: 1, gap: 0, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 3, at: 0 },
                { e: 'enemy_04', lane: 2, n: 2, gap: 3, at: 1 },
                { e: 'enemy_02', lane: 1, n: 4, gap: 1.2, at: 2 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 220, exp: 190 },
            first: { dew: 15, coins: 550, mats: { mat_03: 4 } },
            threeStar: { dew: 8, mats: { mat_01: 4 } }
          }
        },
        {
          id: '2-4',
          name: '溪谷迴廊',
          pos: { x: 45, y: 33 },
          statMul: 1.65,
          recommendLv: 15,
          costCap: 54,
          tip: '四種怪物混合出現，五波連續進攻。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 3, gap: 2.5, at: 0 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.5, at: 1 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_04', lane: 1, n: 1, gap: 0, at: 3 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 3, at: 0 },
                { e: 'enemy_04', lane: 2, n: 2, gap: 3, at: 0 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 4, gap: 1, at: 0 },
                { e: 'enemy_02', lane: 1, n: 4, gap: 1, at: 0.5 },
                { e: 'enemy_02', lane: 2, n: 4, gap: 1, at: 1 },
                { e: 'enemy_07', lane: 1, n: 2, gap: 2, at: 2 }
              ]
            },
            {
              delay: 9,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 0 },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 0 },
                { e: 'enemy_04', lane: 1, n: 3, gap: 2.5, at: 2 },
                { e: 'enemy_06', lane: 2, n: 3, gap: 1.5, at: 1 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 240, exp: 215 },
            first: { dew: 15, coins: 600, mats: { mat_02: 5, mat_03: 2 } },
            threeStar: { dew: 8, mats: { mat_01: 5 } }
          }
        },
        {
          id: '2-5',
          name: '古木守門',
          pos: { x: 72, y: 21 },
          statMul: 1.75,
          recommendLv: 17,
          costCap: 58,
          tip: '古木樹樁會不斷喚來小栗球，先清小怪再集中火力；左側泉水格能幫守護回血。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 3, gap: 2.5, at: 0 },
                { e: 'enemy_01', lane: 2, n: 3, gap: 2.5, at: 0 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_04', lane: 1, n: 2, gap: 3, at: 0 },
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.2, at: 2 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 0 },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 2 }
              ]
            },
            {
              delay: 10,
              spawns: [
                { e: 'enemy_09', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_02', lane: 0, n: 3, gap: 2, at: 6 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 2, at: 6 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 300, exp: 250 },
            first: { dew: 20, coins: 800, summonTicket: 1, mats: { mat_01: 6, mat_02: 6, mat_03: 4 } },
            threeStar: { dew: 10, mats: { mat_03: 4 } }
          }
        }
      ],
      battlefield: 'ch2'
    },
    {
      id: 'ch3',
      name: '雷雲山谷',
      desc: '劈啪作響的靜電籠罩山谷，水屬性夥伴格外有精神。',
      stages: [
        {
          id: '3-1',
          name: '花海邊境',
          pos: { x: 70, y: 76 },
          statMul: 1.85,
          recommendLv: 19,
          costCap: 58,
          tip: '靜電天氣讓水屬性精靈攻速 +15%；飛行蒲公英要靠遠程處理。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_04', lane: 1, n: 2, gap: 3, at: 0 },
                { e: 'enemy_01', lane: 0, n: 3, gap: 2.5, at: 1 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_01', lane: 2, n: 4, gap: 2, at: 0 },
                { e: 'enemy_04', lane: 0, n: 2, gap: 3, at: 2 },
                { e: 'enemy_06', lane: 1, n: 3, gap: 1.8, at: 2 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0, elite: true },
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.2, at: 3 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.2, at: 3 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 2.5, at: 0 },
                { e: 'enemy_04', lane: 1, n: 2, gap: 2.5, at: 0.5 },
                { e: 'enemy_04', lane: 2, n: 2, gap: 2.5, at: 1 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 300, exp: 300 },
            first: { dew: 20, coins: 800, mats: { mat_03: 5 } },
            threeStar: { dew: 10, mats: { mat_02: 5 } }
          }
        },
        {
          id: '3-2',
          name: '噴嚏花田',
          pos: { x: 38, y: 64 },
          statMul: 1.95,
          recommendLv: 21,
          costCap: 60,
          tip: '整片花田都在打噴嚏！可以讓守護輪流上場分攤傷害。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 3, gap: 2.5, at: 0 },
                { e: 'enemy_04', lane: 2, n: 3, gap: 2.5, at: 1 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_04', lane: 1, n: 4, gap: 2, at: 0 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 0 },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 0 },
                { e: 'enemy_04', lane: 1, n: 3, gap: 2, at: 2 },
                { e: 'enemy_07', lane: 1, n: 2, gap: 2, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_04', lane: 1, n: 1, gap: 0, at: 0, elite: true },
                { e: 'enemy_02', lane: 0, n: 4, gap: 1, at: 2 },
                { e: 'enemy_02', lane: 2, n: 4, gap: 1, at: 2 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 330, exp: 330 },
            first: { dew: 20, coins: 850, mats: { mat_03: 6 } },
            threeStar: { dew: 10, mats: { mat_01: 6 } }
          }
        },
        {
          id: '3-3',
          name: '螢光窪地',
          pos: { x: 64, y: 48 },
          statMul: 2.05,
          recommendLv: 23,
          costCap: 62,
          tip: '大量高速怪從窪地湧出，五波不間斷。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 4, gap: 1, at: 0 },
                { e: 'enemy_02', lane: 2, n: 4, gap: 1, at: 0.5 }
              ]
            },
            {
              delay: 6,
              spawns: [
                { e: 'enemy_01', lane: 1, n: 4, gap: 2, at: 0 },
                { e: 'enemy_02', lane: 1, n: 3, gap: 1, at: 5 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_02', lane: 0, n: 4, gap: 1, at: 2 },
                { e: 'enemy_02', lane: 2, n: 4, gap: 1, at: 2 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 2.5, at: 0 },
                { e: 'enemy_04', lane: 2, n: 2, gap: 2.5, at: 0 },
                { e: 'enemy_01', lane: 1, n: 3, gap: 2, at: 1 },
                { e: 'enemy_06', lane: 1, n: 4, gap: 1.2, at: 0 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 5, gap: 0.8, at: 0 },
                { e: 'enemy_02', lane: 1, n: 5, gap: 0.8, at: 0.4 },
                { e: 'enemy_02', lane: 2, n: 5, gap: 0.8, at: 0.8 },
                { e: 'enemy_02', lane: 1, n: 1, gap: 0, at: 5, elite: true }
              ]
            }
          ],
          rewards: {
            clear: { coins: 360, exp: 360 },
            first: { dew: 20, coins: 900, mats: { mat_01: 6, mat_02: 6 } },
            threeStar: { dew: 10, mats: { mat_03: 5 } }
          }
        },
        {
          id: '3-4',
          name: '雷鳴高台',
          pos: { x: 45, y: 33 },
          statMul: 2.15,
          recommendLv: 25,
          costCap: 64,
          tip: '決戰前的最後防線，雙菁英青苔岩同時壓境。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 0 },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 0 },
                { e: 'enemy_01', lane: 1, n: 3, gap: 2.5, at: 2 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_04', lane: 1, n: 3, gap: 2.5, at: 0 },
                { e: 'enemy_02', lane: 0, n: 3, gap: 1.2, at: 1 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 1.2, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_03', lane: 0, n: 1, gap: 0, at: 0, elite: true },
                { e: 'enemy_03', lane: 2, n: 1, gap: 0, at: 0, elite: true },
                { e: 'enemy_08', lane: 1, n: 2, gap: 3, at: 2 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 2, at: 0 },
                { e: 'enemy_04', lane: 2, n: 2, gap: 2, at: 0 },
                { e: 'enemy_01', lane: 1, n: 4, gap: 1.8, at: 1 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_02', lane: 0, n: 4, gap: 1, at: 0 },
                { e: 'enemy_02', lane: 1, n: 4, gap: 1, at: 0.3 },
                { e: 'enemy_02', lane: 2, n: 4, gap: 1, at: 0.6 },
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 5 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 390, exp: 400 },
            first: { dew: 20, coins: 1000, mats: { mat_01: 6, mat_03: 6 } },
            threeStar: { dew: 10, mats: { mat_02: 6 } }
          }
        },
        {
          id: '3-5',
          name: '氣噗噗雷雲王',
          pos: { x: 72, y: 21 },
          statMul: 2.25,
          recommendLv: 27,
          costCap: 70,
          tip: '最終戰！水屬性精靈對雷雲王特別有效；狂怒後震盪更頻繁。',
          waves: [
            {
              delay: 5,
              spawns: [
                { e: 'enemy_01', lane: 0, n: 3, gap: 2, at: 0 },
                { e: 'enemy_01', lane: 2, n: 3, gap: 2, at: 0 },
                { e: 'enemy_04', lane: 1, n: 2, gap: 3, at: 2 }
              ]
            },
            {
              delay: 7,
              spawns: [
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_02', lane: 0, n: 4, gap: 1, at: 2 },
                { e: 'enemy_02', lane: 2, n: 4, gap: 1, at: 2 },
                { e: 'enemy_06', lane: 1, n: 3, gap: 1.5, at: 4 }
              ]
            },
            {
              delay: 8,
              spawns: [
                { e: 'enemy_04', lane: 0, n: 2, gap: 2.5, at: 0 },
                { e: 'enemy_04', lane: 2, n: 2, gap: 2.5, at: 0 },
                { e: 'enemy_03', lane: 1, n: 1, gap: 0, at: 3, elite: true },
                { e: 'enemy_08', lane: 1, n: 1, gap: 0, at: 6 }
              ]
            },
            {
              delay: 12,
              spawns: [
                { e: 'enemy_05', lane: 1, n: 1, gap: 0, at: 0 },
                { e: 'enemy_01', lane: 0, n: 3, gap: 4, at: 8 },
                { e: 'enemy_01', lane: 2, n: 3, gap: 4, at: 8 },
                { e: 'enemy_02', lane: 0, n: 3, gap: 2, at: 20 },
                { e: 'enemy_02', lane: 2, n: 3, gap: 2, at: 20 }
              ]
            }
          ],
          rewards: {
            clear: { coins: 450, exp: 450 },
            first: { dew: 30, coins: 1500, summonTicket: 2, mats: { mat_01: 10, mat_02: 10, mat_03: 8 } },
            threeStar: { dew: 15, summonTicket: 1, mats: { mat_03: 6 } }
          }
        }
      ],
      battlefield: 'ch3'
    }
  ];

  // 無盡模式：通關 3-5（普通）後解鎖；漏到泉水之心歸零即結束（無懲罰）
  const ENDLESS_MODE = {
    id: 'endless', name: '無盡晨霧', unlock: { stageClear: '3-5', difficulty: 'normal' },
    battlefield: 'ch1', lives: 5,
    waveInterval: 8,                     // 每波之間間隔（秒）
    scaling: {                           // 第 w 波（從 1 開始）的怪物倍率，線性成長避免後期暴衝
      hpPerWave: 0.12,                   // HP 倍率 = statBase × (1 + 0.12 × (w − 1))
      atkPerWave: 0.06,
      defPerWave: 0.03,
      statBase: 2.0
    },
    composition: {                       // 每波基礎數量 = base + floor(w / 3)，上限 cap；依權重抽怪
      base: 6, cap: 18,
      weights: [
        { e: 'enemy_01', weight: 30, fromWave: 1 },
        { e: 'enemy_02', weight: 30, fromWave: 1 },
        { e: 'enemy_03', weight: 15, fromWave: 3 },
        { e: 'enemy_04', weight: 20, fromWave: 4 },
        { e: 'enemy_07', weight: 14, fromWave: 5 },
        { e: 'enemy_06', weight: 12, fromWave: 6 },
        { e: 'enemy_08', weight: 10, fromWave: 8 }
      ]
    },
    eliteEvery: 5,                       // 每 5 波：加 1 隻菁英青苔岩
    eliteEnemy: 'enemy_03',
    bossEvery: 10,                       // 每 10 波：雷雲王，HP 倍率 = 0.5 + 0.1 × (第幾次 Boss − 1)，上限 1.5
    bossEnemies: ['enemy_09', 'enemy_05'],   // 第 10、30…波古木樹樁；第 20、40…波雷雲王
    bossHpMul: { start: 0.5, step: 0.1, max: 1.5 },
    rewards: {
      perWave: { coinsBase: 30, coinsPerWave: 5, exp: 40 },   // 第 w 波星塵 = 30 + 5w
      everyFiveWaves: { dew: 3, mats: { mat_01: 1, mat_02: 1, mat_03: 1 } },
      dailyRewardRuns: 3,                // 每日前 3 場可拿獎勵，之後只記錄成績
      bestRecordMilestones: [
        { wave: 10, rewards: { dew: 20, coins: 1000 } },
        { wave: 20, rewards: { dew: 30, summonTicket: 1, mats: { mat_03: 10 } } },
        { wave: 30, rewards: { dew: 50, summonTicket: 2 } },
        { wave: 50, rewards: { dew: 100, summonTicket: 3, title: '晨霧守望者' } }
      ]
    }
  };

  /* ---------------------------------------------------------------
   * 8. TRAIL — 森林奇遇步道（取代方格迷宮）
   * 每次出發消耗 5 露水，共 6 層；每層從左／右兩個節點擇一前進，走完 6 層後開啟終點寶箱
   * 獎勵中的 [最少, 最多] 會隨機取整數；mats.random 表示從 forageMatPool 隨機挑素材
   * --------------------------------------------------------------- */
  const TRAIL = {
    name: '森林奇遇步道', bg: 'trail', costDew: 5, layers: 6,
    unlock: { stageClear: '1-1' },
    revealPct: 60,                          // 每個節點有 60% 機率事先看得到事件類型，其餘顯示「？」
    // 節點座標（bg_trail.png 百分比），由下往上：起點 → 第 1~6 層
    layout: { start: { x: 50, y: 93 }, layerY: [81, 70, 59, 48, 37, 26], leftX: 30, rightX: 70, jitterX: 5, final: { x: 50, y: 12 } },
    forageMatPool: ['mat_01', 'mat_02', 'mat_03'],
    events: [
      { type: 'forage', name: '森林拾穫', icon: 'mat', weight: 34, desc: '撿到一大把素材和元氣森果！',
        reward: { mats: { random: [3, 6] }, items: { item_exp_berry: [1, 2] } } },
      { type: 'chest', name: '步道寶箱', icon: 'chest', weight: 22, desc: '藤蔓下藏著一個小寶箱…',
        table: [
          { weight: 30, reward: { items: { item_evo_stone: 1 }, coins: 60 } },
          { weight: 15, reward: { items: { item_shiny_charm: 1 }, coins: 60 } },
          { weight: 55, reward: { items: { item_exp_berry: 2 }, coins: 90 } }
        ] },
      { type: 'traveler', name: '森林旅人', icon: 'traveler', weight: 20, desc: '背著大背包的旅人願意用精靈碎片交換一點星塵。',
        costCoins: 60, shards: 1, declineGift: { items: { item_exp_berry: 1 } } },
      { type: 'blessing', name: '林間祝福', icon: 'blessing', weight: 16, desc: '樹葉間灑下溫暖的光，下一場戰鬥會更順利。',
        options: [
          { id: 'atk',    name: '奮起祝福', desc: '下一場戰鬥全隊攻擊 +15%', atkPct: 15 },
          { id: 'energy', name: '露珠祝福', desc: '下一場戰鬥開場能量 +10', energy: 10 },
          { id: 'guard',  name: '守護祝福', desc: '下一場戰鬥全隊受到傷害 −15%', dmgDownPct: 15 }
        ] },
      { type: 'rest', name: '樹蔭小憩', icon: 'rest', weight: 8, desc: '在樹蔭下休息一下，撿到幾顆露珠。',
        reward: { dew: [2, 4], coins: [20, 40] } }
    ],
    finalChest: {
      name: '步道終點寶箱',
      table: [
        { weight: 40, reward: { items: { item_evo_stone: 1 }, coins: 120 } },
        { weight: 20, reward: { items: { item_shiny_charm: 1 }, coins: 120 } },
        { weight: 40, reward: { items: { item_exp_berry: 3 }, coins: 150, mats: { random: [2, 3] } } }
      ]
    }
  };

  // 三星關卡一鍵掃蕩：每次花 3 露水，直接取得通關獎勵、經驗與一次掉落判定（不含首通與三星獎勵）
  const SWEEP = { costDew: 3 };

  // 營地奇遇與上班族貼心功能
  const CAMP_EVENTS = {
    // 記步數兌換露水時，隨機一隻營地精靈冒泡回饋
    walkFeedback: {
      giftPct: 45, gift: { items: { item_exp_berry: 1 } },
      giftLines: ['散步時撿到一顆森果，送給你！', '我也跟著走了好多步，這個給你～', '路邊的森果紅通通的，分你一顆！'],
      lines: ['今天也走了好多路，辛苦了！', '腳痠痠的話記得伸展一下喔', '一起慢慢走，就會走很遠～', '有你在，營火都變暖了', '今天的露水亮晶晶的！']
    },
    // 漂流木信瓶：待在營地時不定時漂到草地上
    bottle: {
      firstDelaySec: [40, 90], intervalSec: [150, 360], dailyMax: 6,
      area: { x0: 22, x1: 78, y0: 58, y1: 80 },          // bg_camp.png 百分比
      gifts: [
        { weight: 40, reward: { coins: [30, 80] } },
        { weight: 30, reward: { dew: [1, 3] } },
        { weight: 20, reward: { items: { item_exp_berry: 1 } } },
        { weight: 10, reward: { mats: { random: [1, 2] } } }
      ],
      messages: [
        '今天辛苦了，記得喝口水、讓肩膀放鬆一下。',
        '不用每件事都做到完美，你已經很棒了。',
        '下班路上看看天空吧，雲一直都在慢慢走。',
        '把今天交給營火，明天再出發就好。',
        '有人默默謝謝你今天的認真。',
        '慢慢來，比較快。',
        '今晚早點睡，夢裡的森林也很溫柔。'
      ]
    },
    // 下班收成籃：離線超過 1 小時，營火旁出現籃子，一鍵領取離線露水與素材
    basket: { minOfflineHours: 1, pos: { x: 64, y: 42 }, hoursPerMat: 2, maxMats: 6 },
    zen: { hint: '點一下畫面回到營地' }
  };

  /* ---------------------------------------------------------------
   * 9. CRAFT_RECIPES — 3 種裝備（每隻精靈 3 個欄位各裝 1 件）
   * 品質由工坊等級決定權重（見 CAMP_BUILDINGS.workshop）
   * 主屬性實際值 = baseStats × quality.statMul（四捨五入）
   * 副詞條數量 = quality.substats 範圍內隨機（1~2 條），同一件不重複
   * --------------------------------------------------------------- */
  const EQUIP_SLOTS = {
    wrist:   { name: '護腕' },
    pendant: { name: '墜飾' },
    hair:    { name: '髮飾' }
  };

  // 鍛造品質三階；substats = [最少, 最多] 條副詞條（1~2 條）
  const CRAFT_QUALITIES = [
    { id: 'common', name: '普通', color: '#B9B2A3', statMul: 1.00, substats: [1, 1] },
    { id: 'fine',   name: '精良', color: '#8FA876', statMul: 1.15, substats: [1, 2] },
    { id: 'epic',   name: '史詩', color: '#E0B866', statMul: 1.35, substats: [2, 2] }
  ];

  // 副詞條池：value 在 [min, max] 之間取整數；weight 為抽中權重；roles 空陣列 = 全職業皆可
  const SUBSTAT_POOL = [
    { stat: 'hpPct',        name: '生命',       unit: '%', min: 3, max: 8,  weight: 14, roles: [] },
    { stat: 'atkPct',       name: '攻擊',       unit: '%', min: 3, max: 8,  weight: 14, roles: [] },
    { stat: 'defPct',       name: '防禦',       unit: '%', min: 3, max: 8,  weight: 12, roles: [] },
    { stat: 'aspdPct',      name: '攻擊速度',   unit: '%', min: 2, max: 6,  weight: 10, roles: ['ranged', 'guardian'] },
    { stat: 'critRate',     name: '暴擊率',     unit: '%', min: 2, max: 6,  weight: 10, roles: ['ranged', 'guardian'] },
    { stat: 'critDmg',      name: '暴擊傷害',   unit: '%', min: 5, max: 15, weight: 8,  roles: ['ranged', 'guardian'] },
    { stat: 'healPct',      name: '治療量',     unit: '%', min: 3, max: 8,  weight: 10, roles: ['healer'] },
    { stat: 'skillCdPct',   name: '技能冷卻縮短', unit: '%', min: 3, max: 8, weight: 8, roles: [] },
    { stat: 'dmgTakenDown', name: '受到傷害降低', unit: '%', min: 2, max: 5, weight: 8, roles: ['guardian'] },
    { stat: 'costDown',     name: '部署費用',   unit: '點', min: 1, max: 1, weight: 3, roles: [] }
  ];

  const CRAFT_RECIPES = [
    {
      id: 'eq_01', name: '苔絨護腕', slot: 'wrist', asset: 'eq_01', suggestRole: 'guardian',
      desc: '用柔軟苔絨縫成的護腕，戴上後很安心。',
      cost: { coins: 300, mats: { mat_01: 6, mat_02: 2 } },
      baseStats: { hp: 120, def: 15 },
      craftTime: 0,
      fallback: { color: '#9DB68A', glyph: '腕' }
    },
    {
      id: 'eq_02', name: '露珠鈴墜', slot: 'pendant', asset: 'eq_02', suggestRole: 'healer',
      desc: '一顆會發出清音的露珠石墜飾。',
      cost: { coins: 300, mats: { mat_02: 6, mat_03: 2 } },
      baseStats: { hp: 80, healPct: 8 },
      craftTime: 0,
      fallback: { color: '#9CC3D2', glyph: '墜' }
    },
    {
      id: 'eq_03', name: '晨光羽飾', slot: 'hair', asset: 'eq_03', suggestRole: 'ranged',
      desc: '收集晨曦花粉染成的羽毛髮飾。',
      cost: { coins: 400, mats: { mat_03: 6, mat_01: 2 } },
      baseStats: { atk: 25, critRate: 5 },
      craftTime: 0,
      fallback: { color: '#EBD08F', glyph: '羽' }
    }
  ];

  /* ---------------------------------------------------------------
   * 10. CAMP_BUILDINGS — 營火／孵化巢／工坊 Lv.1~5
   * levels[i].upgradeCost = 從上一級升到此級的花費（Lv.1 為初始，無花費）
   * requires.stageClear = 需先通關的普通關卡
   * --------------------------------------------------------------- */
  const CAMP_BUILDINGS = [
    {
      id: 'campfire', name: '營火', desc: '大家圍著取暖的地方，走越多路火越旺。',
      pos: { x: 52, y: 30 },   // 木牌在 bg_camp.png 的位置（營火上方）
      levels: [
        { lv: 1, upgradeCost: null, requires: null,
          effects: { stepDewBonusPct: 0, teamHpPct: 0, teamAtkPct: 0, dailyFreeDew: 0, offlineDewPerHour: 1 },
          desc: '基礎營火，離線每小時累積 1 露水。' },
        { lv: 2, upgradeCost: { coins: 500, mats: { mat_01: 5 } }, requires: { stageClear: '1-3' },
          effects: { stepDewBonusPct: 5, teamHpPct: 3, teamAtkPct: 0, dailyFreeDew: 2, offlineDewPerHour: 1.5 },
          desc: '步數換露水 +5%，全隊 HP +3%，每日領 2 露水，離線每小時 1.5 露水。' },
        { lv: 3, upgradeCost: { coins: 1500, mats: { mat_01: 12, mat_02: 4 } }, requires: { stageClear: '1-5' },
          effects: { stepDewBonusPct: 10, teamHpPct: 6, teamAtkPct: 3, dailyFreeDew: 4, offlineDewPerHour: 2 },
          desc: '步數換露水 +10%，全隊 HP +6%、攻擊 +3%，每日領 4 露水，離線每小時 2 露水。' },
        { lv: 4, upgradeCost: { coins: 4000, mats: { mat_01: 25, mat_02: 10 } }, requires: { stageClear: '2-5' },
          effects: { stepDewBonusPct: 15, teamHpPct: 9, teamAtkPct: 6, dailyFreeDew: 6, offlineDewPerHour: 2.5 },
          desc: '步數換露水 +15%，全隊 HP +9%、攻擊 +6%，每日領 6 露水，離線每小時 2.5 露水。' },
        { lv: 5, upgradeCost: { coins: 9000, mats: { mat_01: 45, mat_02: 20, mat_03: 10 } }, requires: { stageClear: '3-5' },
          effects: { stepDewBonusPct: 20, teamHpPct: 12, teamAtkPct: 9, dailyFreeDew: 10, offlineDewPerHour: 3 },
          desc: '步數換露水 +20%，全隊 HP +12%、攻擊 +9%，每日領 10 露水，離線每小時 3 露水。' }
      ]
    },
    {
      id: 'nest', name: '孵化巢', desc: '鋪滿苔絨的小窩，精靈會從這裡被召喚出來。',
      pos: { x: 75, y: 17 },   // 木牌在 bg_camp.png 的位置（帳篷頂）
      levels: [
        { lv: 1, upgradeCost: null, requires: null,
          effects: { summonCostDew: 10, srRateBonus: 0, ssrRateBonus: 0, dupExpBonusPct: 0 },
          desc: '單抽 10 露水，基礎機率 R 55% / SR 36% / SSR 9%。' },
        { lv: 2, upgradeCost: { coins: 600, mats: { mat_02: 5 } }, requires: { stageClear: '1-4' },
          effects: { summonCostDew: 10, srRateBonus: 1, ssrRateBonus: 0, dupExpBonusPct: 10 },
          desc: 'SR 機率 +1%，重複精靈轉經驗 +10%。' },
        { lv: 3, upgradeCost: { coins: 1800, mats: { mat_02: 12, mat_03: 3 } }, requires: { stageClear: '2-2' },
          effects: { summonCostDew: 9, srRateBonus: 2, ssrRateBonus: 0.5, dupExpBonusPct: 20 },
          desc: '單抽 9 露水，SR +2%、SSR +0.5%，重複轉經驗 +20%。' },
        { lv: 4, upgradeCost: { coins: 4500, mats: { mat_02: 25, mat_03: 8 } }, requires: { stageClear: '2-5' },
          effects: { summonCostDew: 9, srRateBonus: 3, ssrRateBonus: 1, dupExpBonusPct: 30 },
          desc: '單抽 9 露水，SR +3%、SSR +1%，重複轉經驗 +30%。' },
        { lv: 5, upgradeCost: { coins: 10000, mats: { mat_01: 15, mat_02: 40, mat_03: 15 } }, requires: { stageClear: '3-5' },
          effects: { summonCostDew: 8, srRateBonus: 4, ssrRateBonus: 2, dupExpBonusPct: 40 },
          desc: '單抽 8 露水，SR +4%、SSR +2%，重複轉經驗 +40%。' }
      ],
      // 機率加成一律從 R 扣除：Lv.5 → R 49% / SR 40% / SSR 11%
      rateRule: 'bonusDeductedFromR'
    },
    {
      id: 'workshop', name: '工坊', desc: '堆滿小工具的木屋，可以把素材做成裝備。',
      pos: { x: 30, y: 28 },   // 木牌在 bg_camp.png 的位置（木頭堆上方）
      levels: [
        { lv: 1, upgradeCost: null, requires: null,
          effects: { qualityWeights: { common: 65, fine: 28, epic: 7 }, matCostDownPct: 0 },
          desc: '品質機率 普通 65% / 精良 28% / 史詩 7%。' },
        { lv: 2, upgradeCost: { coins: 500, mats: { mat_01: 4, mat_03: 2 } }, requires: { stageClear: '1-5' },
          effects: { qualityWeights: { common: 65, fine: 28, epic: 7 }, matCostDownPct: 0 },
          desc: '史詩機率 10%，素材消耗 −5%。' },
        { lv: 3, upgradeCost: { coins: 1600, mats: { mat_01: 10, mat_03: 6 } }, requires: { stageClear: '2-3' },
          effects: { qualityWeights: { common: 65, fine: 28, epic: 7 }, matCostDownPct: 0 },
          desc: '史詩機率 14%，素材消耗 −10%。' },
        { lv: 4, upgradeCost: { coins: 4200, mats: { mat_01: 20, mat_02: 10, mat_03: 15 } }, requires: { stageClear: '3-1' },
          effects: { qualityWeights: { common: 65, fine: 28, epic: 7 }, matCostDownPct: 0 },
          desc: '史詩機率 19%，素材消耗 −15%。' },
        { lv: 5, upgradeCost: { coins: 9500, mats: { mat_01: 35, mat_02: 25, mat_03: 30 } }, requires: { stageClear: '3-5' },
          effects: { qualityWeights: { common: 65, fine: 28, epic: 7 }, matCostDownPct: 0 },
          desc: '史詩機率 24%，素材消耗 −20%。' }
      ],
      // 素材折扣後一律無條件進位，最少 1 個
      costRounding: 'ceil'
    }
  ];

  /* ---------------------------------------------------------------
   * 11. DAILY_QUESTS — 每日任務（04:00 重置）＋活躍度寶箱
   * --------------------------------------------------------------- */
  const DAILY_QUESTS = [
    { id: 'dq_steps',   name: '晨間散步',   desc: '今日輸入步數達 3,000 步', type: 'stepsInput',    target: 3000, activity: 20, rewards: { dew: 3 } },
    { id: 'dq_battle',  name: '守護泉水',   desc: '完成 3 場關卡戰鬥（勝利）', type: 'battleWin',   target: 3,    activity: 20, rewards: { coins: 200 } },
    { id: 'dq_summon',  name: '召喚新夥伴', desc: '進行 1 次召喚',           type: 'summon',        target: 1,    activity: 10, rewards: { coins: 100 } },
    { id: 'dq_feed',    name: '露水餵養',   desc: '餵養精靈 1 次',           type: 'feed',          target: 1,    activity: 10, rewards: { coins: 100 } },
    { id: 'dq_craft',   name: '工坊時光',   desc: '合成 1 件裝備',           type: 'craft',         target: 1,    activity: 15, rewards: { mats: { mat_01: 2, mat_02: 2 } } },
    { id: 'dq_trail',   name: '林間散步',   desc: '走完 1 次森林奇遇步道',   type: 'trailRun',      target: 1,    activity: 15, rewards: { mats: { mat_03: 1 }, coins: 100 } },
    { id: 'dq_skill',   name: '技能大師',   desc: '戰鬥中施放技能 10 次',    type: 'skillCast',     target: 10,   activity: 10, rewards: { coins: 150 } },
    { id: 'dq_endless', name: '霧中試煉',   desc: '無盡模式抵達第 5 波',     type: 'endlessWave',   target: 5,    activity: 10, rewards: { dew: 2 }, unlock: { stageClear: '3-5' } }
  ];
  // 活躍度上限 = 110（全部完成）；未解鎖無盡模式時最高 100，三個寶箱皆可拿到
  const DAILY_ACTIVITY_CHESTS = [
    { need: 40,  rewards: { dew: 3, coins: 200 } },
    { need: 70,  rewards: { dew: 5, mats: { mat_01: 2, mat_02: 2, mat_03: 1 } } },
    { need: 100, rewards: { dew: 8, summonTicket: 1 } }
  ];

  /* ---------------------------------------------------------------
   * 12. STEP_MILESTONES — 步數里程碑
   * daily：當日累積（04:00 重置）；lifetime：歷史累積（一次性）
   * --------------------------------------------------------------- */
  const STEP_MILESTONES = {
    daily: [
      { steps: 2000,  rewards: { dew: 2 } },
      { steps: 4000,  rewards: { dew: 3, coins: 150 } },
      { steps: 6000,  rewards: { dew: 4, mats: { mat_01: 2, mat_02: 2 } } },
      { steps: 8000,  rewards: { dew: 5, mats: { mat_03: 1 } } },
      { steps: 10000, rewards: { dew: 6, coins: 300 } }
    ],
    lifetime: [
      { steps: 50000,   name: '草原散步家', rewards: { dew: 30, coins: 1000 } },
      { steps: 100000,  name: '溪谷旅人',   rewards: { dew: 50, summonTicket: 1 } },
      { steps: 200000,  name: '花海漫遊者', rewards: { dew: 80, summonTicket: 2, mats: { mat_03: 10 } } },
      { steps: 500000,  name: '晨露行者',   rewards: { dew: 150, summonTicket: 5, title: '晨露行者' } },
      { steps: 1000000, name: '森之百萬步', rewards: { dew: 300, summonTicket: 10, title: '森之百萬步' } }
    ]
  };

  /* ---------------------------------------------------------------
   * 匯出（深度凍結，避免 game.js 意外改到原始資料）
   * --------------------------------------------------------------- */
  function deepFreeze(o) {
    Object.getOwnPropertyNames(o).forEach(function (k) {
      const v = o[k];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
    });
    return Object.freeze(o);
  }

  const GAME_DATA = deepFreeze({
    META, ASSETS,
    ELEMENTS, ELEMENT_MULTIPLIER, ROLES, RARITIES, CURRENCIES, MATERIALS,
    ECONOMY, SUMMON, STAR_RULES, LEVEL_RULES, BATTLE_RULES,
    ITEMS, SHINY, EVOLUTION, BATTLEFIELDS,
    PETS, ENEMIES, ELITE_MODIFIER,
    DIFFICULTY, CHAPTERS, ENDLESS_MODE,
    TRAIL, SWEEP, CAMP_EVENTS,
    EQUIP_SLOTS, CRAFT_QUALITIES, SUBSTAT_POOL, CRAFT_RECIPES,
    CAMP_BUILDINGS,
    DAILY_QUESTS, DAILY_ACTIVITY_CHESTS,
    STEP_MILESTONES
  });

  root.GAME_DATA = GAME_DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME_DATA;
})(typeof window !== 'undefined' ? window : globalThis);
