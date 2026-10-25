/* ===========================================================================
 * app.js  ——  聚合游戏平台「假数据版」渲染与实时聚合
 *
 * 经典 <script> 加载（非 module），无 import / export，无外部库。
 * 依赖 window.DATA（由 data.js 提供）。
 *
 * 聚合规则均在函数内【实时计算】，不写死：
 *   - Game.totalPlaytimeMinutes = Σ platforms[].totalMinutes
 *   - Game.firstPlayedAt / lastPlayedAt = 各端极值
 *   - 平台分布 / 年度统计 / 周柱状图 均由原始数据实时聚合。
 * ======================================================================== */

(function () {
  'use strict';

  /* ============================ 数据源 ==============================
   * 规则（用户 2026-10-18 确认）：**先不做跨平台合并**。
   * 每拉取一个官方平台，后端就单独生成一份 data_<平台>.js，各平台各算各的，
   * 详情页按「该平台自己的字段规则」展示。合并/聚合视图以后再做。
   * ================================================================= */
  var SOURCES = {
    steam:  { varName: 'GAME_DATA_STEAM',  label: '我的 Steam',  short: 'Steam',  platform: 'steam' },
    xbox:   { varName: 'GAME_DATA_XBOX',   label: '我的 Xbox',   short: 'Xbox',   platform: 'xbox' },
    // 任天堂：一个数据源下挂 Switch / Switch 2 / 3DS 三台主机（2026-10-19 用户定，和 RA 多主机同构）
    nintendo: { varName: 'GAME_DATA_NINTENDO', label: '我的 Nintendo', short: 'Nintendo', platform: 'nintendo' },
    // 手机：屏幕账本 App 导出的使用数据（手动导入，没有联网接口）。2026-10-20 用「手机」替掉了 PSN 占位。
    phone:  { varName: 'GAME_DATA_PHONE',  label: '我的手机',   short: '手机',    platform: 'phone' },
    epic:   { varName: 'GAME_DATA_EPIC',   label: '我的 Epic',   short: 'Epic',   platform: 'epic' },
    retro:  { varName: 'GAME_DATA_RETRO',  label: 'Retro 成就',   short: 'Retro',  platform: 'retroachievements' },
    // PC（Playnite 本地库）与模拟器（RetroArch / PCSX2 / Dolphin 本地计数器）：
    // 由导入页「重建」按钮生成本地数据，与官方平台互不重叠（归属判定时已排除）
    pc:     { varName: 'GAME_DATA_PC',    label: '我的 PC',     short: 'PC',     platform: 'pc' },
    emu:    { varName: 'GAME_DATA_EMU',   label: '我的模拟器',  short: '模拟器',  platform: 'emu' }
  };
  /** 顶部游戏库页签里显示的顺序（用户 2026-10-20 定：Nintendo / Xbox / Steam / Retro / Epic / 手机） */
  var SOURCE_ORDER = ['nintendo', 'xbox', 'steam', 'retro', 'epic', 'phone', 'pc', 'emu'];

  function emptyData() { return { schemaVersion: 1, platforms: [], ownerId: null, games: [] }; }

  /**
   * 「查不到名字」的游戏：标题仍是 32 位十六进制代号，或目录补录失败
   * （extra.catalogFailed —— Epic 内部/占位条目，连真名都查不到）。
   * 用户 2026-10-20 拍板：这类条目在界面上隐藏（看着难受、也不知道是什么游戏）。
   * 只影响显示；window.GAME_DATA_* 原始数据仍保留，想恢复显示删掉这个判断即可。
   */
  function isUnresolvedGame(g) {
    if (/^[0-9a-f]{32}$/i.test(String((g && g.title) || ''))) return true;
    var plays = (g && g.platforms) || [];
    for (var i = 0; i < plays.length; i++) {
      var ex = plays[i] && plays[i].extra;
      if (ex && ex.catalogFailed) return true;
    }
    return false;
  }

  /**
   * 用户手动「不显示」的条目（目前只有手机应用：在详情页点「隐藏」）。
   * 用户 2026-10-20 定：隐藏的**列表和统计都不算**，所以统一在 sourceData 这一层滤掉，
   * 上层（列表 / 生涯 / 概览条 / 全部页签）不会再各算一套。
   */
  function isHiddenEntry(g) {
    var plays = (g && g.platforms) || [];
    for (var i = 0; i < plays.length; i++) {
      var ex = plays[i] && plays[i].extra;
      if (ex && ex.hidden) return true;
    }
    return false;
  }

  /** sourceData 的过滤缓存：键是数据对象引用，重新拉取后引用变了自动失效 */
  var _srcFilterCache = {};

  /** 手动改了显示开关后，丢掉这个源的缓存（数据是原地改的，引用没变） */
  function invalidateSource(src) {
    delete _srcFilterCache[src];
    refreshData();
  }

  /** 取某平台已拉取的数据（已滤掉查不到名字的条目 + 被隐藏的条目）；没拉过返回 null */
  function sourceData(src) {
    var def = SOURCES[src];
    if (!def) return null;
    var d = window[def.varName];
    if (!d || !d.games) return null;
    var hit = _srcFilterCache[src];
    if (hit && hit.raw === d) return hit.out;
    var needFilter = false;
    for (var i = 0; i < d.games.length; i++) {
      if (isUnresolvedGame(d.games[i]) || isHiddenEntry(d.games[i])) { needFilter = true; break; }
    }
    var out = d;
    if (needFilter) {
      var copy = {};
      for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) copy[k] = d[k]; }
      copy.games = d.games.filter(function (g) { return !isUnresolvedGame(g) && !isHiddenEntry(g); });
      out = copy;
    }
    _srcFilterCache[src] = { raw: d, out: out };
    return out;
  }

  /** 第一个已经拉过数据的平台（页面初次打开时默认展示它） */
  function firstAvailableSource() {
    for (var i = 0; i < SOURCE_ORDER.length; i++) {
      if (sourceData(SOURCE_ORDER[i])) return SOURCE_ORDER[i];
    }
    return null;
  }

  /**
   * 「全部」视图的数据：把所有已拉取平台的数据**合并**到一起展示。
   * 注意：只是展示层合并，落盘仍各平台独立（每个游戏的 platforms[].platform 标记保留，
   * 点 Steam / Xbox 页签时按这个标记筛回去，不会混淆）。
   *
   * 手机是例外（用户 2026-10-20 拍板）：微信、B站这类应用**不混进「全部」和生涯页**，
   * 只在「手机」页签里看。但手机的平台元数据要收进来，否则「手机」蓝标签会退回灰色。
   */
  function combinedData() {
    var games = [], plats = [], platSeen = {};
    SOURCE_ORDER.forEach(function (s) {
      var d = sourceData(s);
      if (!d) return;
      (d.platforms || []).forEach(function (pl) {
        if (!platSeen[pl.id]) { platSeen[pl.id] = 1; plats.push(pl); }
      });
      if (s === 'phone') return;
      d.games.forEach(function (g) { games.push(g); });
    });
    if (!games.length && !plats.length) return emptyData();
    return { schemaVersion: 1, platforms: plats, ownerId: null, games: games };
  }

  /** 当前是否在「手机」页签范围内（手机 / 游戏 / 应用 三个子页签都算） */
  function inPhoneScope() {
    return currentPlatform === 'phone' || String(currentPlatform || '').indexOf('phone:') === 0;
  }

  /** 当前页签该显示的游戏池：手机页签 = 手机应用；其余 = 除手机外的全部 */
  function displayPool() {
    if (inPhoneScope()) return (sourceData('phone') || { games: [] }).games || [];
    return DATA.games;
  }

  /**
   * 手机页签的「已隐藏」栏。
   * 隐藏的应用从列表和统计里排掉了（sourceData 层过滤），所以**在列表里点不到它**，
   * 也就没法进详情页点「恢复显示」—— 这里把它们列成一排小标签，点标签打开详情页恢复。
   * 数据直接读 window.GAME_DATA_PHONE（原始数据，含隐藏项，不过滤）。
   */
  function phoneHiddenGames() {
    var d = window.GAME_DATA_PHONE;
    if (!d || !d.games) return [];
    return d.games.filter(function (g) {
      var p = (g.platforms || [])[0] || {};
      return p.platform === 'phone' && (p.extra || {}).hidden;
    });
  }

  function appendPhoneHiddenBar(listEl) {
    var hidden = phoneHiddenGames();
    if (!inPhoneScope() || !hidden.length) return;
    var bar = document.createElement('div');
    bar.className = 'ph-hidden-bar';
    var chips = hidden.map(function (g) {
      return '<button class="ph-hidden-chip" data-ph-pkg="' + esc(((g.platforms[0] || {}).extra || {}).pkg || '') + '" title="点开详情，可恢复显示">' +
        esc(g.title) + '</button>';
    }).join('');
    bar.innerHTML = '<span class="ph-hidden-label">已隐藏 ' + hidden.length +
      ' 个应用（列表和统计里都不算）：</span>' + chips;
    listEl.appendChild(bar);
    [].forEach.call(bar.querySelectorAll('.ph-hidden-chip'), function (btn) {
      btn.addEventListener('click', function () {
        var pkg = btn.getAttribute('data-ph-pkg');
        var g = hidden.filter(function (x) {
          return (((x.platforms[0] || {}).extra || {}).pkg) === pkg;
        })[0];
        if (g) openDetail(g);
      });
    });
  }

  /** 拉完新平台后重建合并视图（导入页拉取成功后调用） */
  function refreshData() { DATA = combinedData(); }

  /**
   * 导入页专用：某个平台的数据文件被重新生成后，通知这里重算并重绘。
   * 手机每次导入都会重写 data_phone.js（整份替换），导入页动态插一个新的 <script>，
   * 加载完调这个函数，页面不用整页刷新就能看到最新数据。
   */
  window.GH_AFTER_SOURCE_RELOAD = function (src) {
    if (src) delete _srcFilterCache[src];
    refreshData();
    renderLibrary();
    renderCareer();
  };

  var DATA = combinedData();
  var currentPage = 'library';

  /* ============================ 工具函数 ============================== */

  /** HTML 转义 */
  function esc(s) {
    s = (s === null || s === undefined) ? '' : String(s);
    return s.replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /** 是否含中文 / 日文字符（汉字、假名、片假名扩展、全角片假名） */
  function hasCJK(s) {
    return /[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/.test(String(s || ''));
  }

  /** 标题首字符（用于封面色块占位） */
  function firstChar(s) {
    s = (s || '').trim();
    return s ? s.charAt(0) : '?';
  }

  /** 由字符串生成稳定色相，得到封面色（cover 为 null 时的占位色块） */
  function coverColor(str) {
    var h = 0;
    var s = str || '';
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) % 360;
    }
    return 'hsl(' + h + ', 52%, 42%)';
  }

  /** 分钟 -> "Xh Ym"（整点只显示 h，不足 1 小时显示 m）。
   * 0 分钟显示「—」而不是 0m：Xbox 接口不提供游玩时长（恒为 0），
   * 显示 0m 会被误读成"玩过 0 分钟"，显示 — 才是"没有这项数据"。 */
  function formatMinutes(min) {
    min = Math.round(min || 0);
    if (min <= 0) return '—';
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h > 0) {
      return m > 0 ? (h + 'h ' + m + 'm') : (h + 'h');
    }
    return m + 'm';
  }

  /** ISO8601 -> "YYYY-MM-DD" */
  function datePart(iso) {
    if (!iso) return '—';
    return String(iso).slice(0, 10);
  }

  /** 取平台元数据（带兜底） */
  function getPlatform(id) {
    for (var i = 0; i < DATA.platforms.length; i++) {
      if (DATA.platforms[i].id === id) return DATA.platforms[i];
    }
    return { id: id, name: id, type: 'custom', color: '#7f8c8d' };
  }

  /* ============================ 实时聚合 ============================== */

  /**
   * 聚合单款游戏的跨端数据。
   * 返回 { total, first, last, achTotal, achUnlocked, items }
   */
  function aggGame(game) {
    var total = 0, first = null, last = null;
    var achTotal = 0, achUnlocked = 0, items = [], seen = {};
    var pctWeighted = 0, pctWeight = 0, maxPct = 0;
    game.platforms.forEach(function (p) {
      total += p.totalMinutes || 0;
      if (p.firstPlayedAt && (first === null || p.firstPlayedAt < first)) first = p.firstPlayedAt;
      if (p.lastPlayedAt && (last === null || p.lastPlayedAt > last)) last = p.lastPlayedAt;
      achTotal += p.achievements.total || 0;
      achUnlocked += p.achievements.unlocked || 0;
      var t = p.achievements.total || 0;
      var pc = achPct(p.achievements.unlocked || 0, t, p);
      if (t > 0) { pctWeighted += pc * t; pctWeight += t; }
      if (pc > maxPct) maxPct = pc;
      (p.achievements.items || []).forEach(function (it) {
        if (!seen[it.name]) { seen[it.name] = 1; items.push(it); }
      });
    });
    return {
      total: total, first: first, last: last,
      achTotal: achTotal, achUnlocked: achUnlocked, items: items,
      pct: pctWeight ? Math.round(pctWeighted / pctWeight) : maxPct
    };
  }

  /**
   * 成就完成度（%）：
   * 常规算法 = 已解锁 / 总数；
   * Xbox 的 totalAchievements 字段不可靠（经常返回 0，但 unlocked 和官方百分比是好的），
   * 此时改用 Xbox 官方自带的 percentComplete（按成就分数算的完成度，准确）。
   */
  function achPct(unlocked, total, p) {
    if (total > 0) return Math.round(unlocked / total * 100);
    var extra = (p && p.extra) ? Number(p.extra.percentComplete) : 0;
    return extra || 0;
  }

  /** 成就数量文案：n/总数；总数未知（Xbox 字段为 0）时显示 n/– */
  function achCountText(unlocked, total) {
    return (unlocked || 0) + '/' + (total > 0 ? total : '–');
  }

  /** 平台时长分布（仅含有用过的平台，按分钟降序） */
  function platformDistribution() {
    var map = {};
    DATA.games.forEach(function (g) {
      g.platforms.forEach(function (p) {
        map[p.platform] = (map[p.platform] || 0) + (p.totalMinutes || 0);
      });
    });
    var rows = DATA.platforms.map(function (pl) {
      return { platform: pl, minutes: map[pl.id] || 0 };
    }).filter(function (r) { return r.minutes > 0; });
    rows.sort(function (a, b) { return b.minutes - a.minutes; });
    return rows;
  }

  /** 取某周一（ISO 周一）的日期字符串 */
  function mondayOf(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = d.getUTCDay();              // 0=周日 .. 6=周六
    var diff = (day === 0) ? -6 : (1 - day);
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  }

  function weekKey(dateStr) {
    return mondayOf(dateStr).toISOString().slice(0, 10);
  }

  /** 近 12 个有数据的周（按周一聚合总分钟） */
  function weeklyBuckets() {
    var map = {};
    DATA.games.forEach(function (g) {
      g.platforms.forEach(function (p) {
        (p.timeRecords || []).forEach(function (r) {
          var k = weekKey(r.date);
          map[k] = (map[k] || 0) + (r.minutes || 0);
        });
      });
    });
    var keys = Object.keys(map).sort();
    var last = keys.slice(-12);
    return last.map(function (k) {
      var m = new Date(k + 'T00:00:00Z');
      var label = (m.getUTCMonth() + 1) + '/' + m.getUTCDate();
      return { key: k, minutes: map[k], label: label };
    });
  }

  /** 出现数据的年份（升序） */
  function yearsWithData() {
    var set = {};
    DATA.games.forEach(function (g) {
      g.platforms.forEach(function (p) {
        (p.timeRecords || []).forEach(function (r) {
          set[String(r.date).slice(0, 4)] = 1;
        });
      });
    });
    return Object.keys(set).sort();
  }

  /** 某年统计：玩过游戏数、涉及平台数、该年总分钟 */
  function yearStats(year) {
    var gamesPlayed = {}, platformsSet = {}, total = 0;
    DATA.games.forEach(function (g) {
      var played = false;
      g.platforms.forEach(function (p) {
        (p.timeRecords || []).forEach(function (r) {
          if (String(r.date).slice(0, 4) === year) {
            played = true;
            total += (r.minutes || 0);
            platformsSet[p.platform] = 1;
          }
        });
      });
      if (played) gamesPlayed[g.id] = 1;
    });
    return {
      gameCount: Object.keys(gamesPlayed).length,
      platformCount: Object.keys(platformsSet).length,
      total: total
    };
  }

  /** 生涯 KPI 汇总 */
  function computeKPIs() {
    var total = 0, achUnlocked = 0, achTotal = 0;
    DATA.games.forEach(function (g) {
      g.platforms.forEach(function (p) {
        total += (p.totalMinutes || 0);
        achUnlocked += (p.achievements.unlocked || 0);
        achTotal += (p.achievements.total || 0);
      });
    });
    return {
      games: DATA.games.length,
      total: total,
      achUnlocked: achUnlocked,
      achTotal: achTotal,
      platforms: platformDistribution().length
    };
  }

  /* ============================ 小部件构建 ============================ */

  function kpiCard(label, value, sub, foot) {
    return '<div class="kpi"><div class="k-label">' + esc(label) + '</div>' +
      '<div class="k-value">' + value + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
      '<div class="k-sub">' + esc(foot || '') + '</div></div>';
  }

  function metaCell(k, v, sub) {
    return '<div class="meta-cell"><div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + v + (sub ? ' <small style="font-size:12px;color:var(--text-1)">' + esc(sub) + '</small>' : '') + '</div></div>';
  }

  function yearCell(k, v, sub) {
    return '<div class="year-cell"><div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + v + (sub ? '<small> ' + esc(sub) + '</small>' : '') + '</div></div>';
  }

  /* ============================ 游戏库页面 ============================ */

  var currentPlatform = 'all';
  var currentSort = 'lastPlayed';   // lastPlayed | playtime | achievements | title

  /** 封面 HTML：有图用图（图挂了露出首字母色块），没图用首字母色块 */
  /**
   * 成就全收集了吗（任一平台满成就就算）。
   * 适用于所有平台，不只 RA —— Steam / Xbox 的 100% 游戏也该有金框。
   */
  function isFullAchievement(game) {
    var ps = game.platforms || [];
    for (var i = 0; i < ps.length; i++) {
      var a = ps[i].achievements;
      if (a && a.total > 0 && (a.unlocked || 0) === a.total) return true;
    }
    return false;
  }

  function coverHtml(game, big) {
    var color = coverColor(game.title);
    var full = isFullAchievement(game);
    // 手机图标是 144×144 的透明 PNG（圆角已烘在图里）→ 底色用白，别让随机色块从圆角漏出来
    var isPh = !!phoneEntry(game);
    // 金框保留，星星不放封面上（用户 2026-10-19：星星改放成就进度条右边）
    return '<div class="cover' + (big ? ' big' : '') + (full ? ' full' : '') + (isPh ? ' ph' : '') +
      '" style="background:' + (isPh ? '#fff' : color) + '"' +
      (full ? ' title="成就已全收集（100%）"' : '') + '>' +
      '<span>' + esc(firstChar(game.title)) + '</span>' +
      (game.cover ? '<img src="' + esc(game.cover) + '" alt="" onerror="this.remove()">' : '') +
      '</div>';
  }

  function sortGames(games) {
    var sorters = {
      lastPlayed: function (a, b) {
        var la = aggGame(a).last || '', lb = aggGame(b).last || '';
        if (la === '' && lb === '') return (b.totalPlaytimeMinutes || 0) - (a.totalPlaytimeMinutes || 0);
        if (la === '') return 1;               // 没有时间的排最后
        if (lb === '') return -1;
        return lb.localeCompare(la);
      },
      playtime: function (a, b) { return (b.totalPlaytimeMinutes || 0) - (a.totalPlaytimeMinutes || 0); },
      achievements: function (a, b) {
        var pa = (a.agg && a.agg.pct != null) ? a.agg.pct : aggGame(a).pct;
        var pb = (b.agg && b.agg.pct != null) ? b.agg.pct : aggGame(b).pct;
        return pb - pa;
      },
      title: function (a, b) { return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'); }
    };
    games.sort(sorters[currentSort] || sorters.lastPlayed);
  }

  function buildGameRow(game) {
    var a = aggGame(game);
    var row = document.createElement('div');
    row.className = 'game-row';

    var platTags = game.platforms.map(function (p) {
      var pl = getPlatform(p.platform);
      return '<span class="p-tag" style="background:' + pl.color + '">' + esc(pl.name) + '</span>';
    }).join('');

    var icons = a.items.slice(0, 8).map(function (it) {
      return '<span class="ach-dot ' + (it.unlockedAt ? 'on' : '') + '"></span>';
    }).join('');

    var pct = a.pct || 0;
    var achText = achCountText(a.achUnlocked, a.achTotal);
    var genreSub = (game.genres && game.genres.length) ? game.genres.slice(0, 2).join(' / ') : '';

    // 任天堂全平台没有成就系统：那一栏不显示「成就 0/0」，改显示游玩天数（用户 2026-10-19 定）
    // 手机同理，但手机更有意义的是一天平均多久 → 显示「有记录 N 天 / 日均 X 分钟」
    var isPhoneEntry = game.platforms.some(function (p) { return p.platform === 'phone'; });
    var achBlock;
    if (isPhoneEntry && !gameHasAchievements(game)) {
      var pex = (game.platforms[0] || {}).extra || {};
      achBlock = '<div class="ach-block no-ach">' +
        '<div class="ach-top"><span>有记录 <b>' + (pex.totalPlayedDays || 0) + '</b> 天</span>' +
        '<span class="na-tag">日均 ' + (pex.avgMinutes || 0) + ' 分钟</span></div>' +
        '<div class="ach-bar-row"><div class="ach-bar na" title="手机只记录使用时长，没有成就系统"></div></div>' +
        '<div class="ach-icons"></div></div>';
    } else if (!gameHasAchievements(game)) {
      // PC / 模拟器没有成就数据：那一栏改显示更有意义的数字（PC=启动次数，模拟器=来源）
      // 任天堂仍然显示游玩天数（游戏日历是它的主战场）
      var p0 = (game.platforms[0] || {});
      var pex0 = p0.extra || {};
      var topSpan, tagTxt, tipTxt;
      if (p0.platform === 'pc') {
        topSpan = '启动 <b>' + (pex0.playCount || 0) + '</b> 次';
        tagTxt = pex0.sourceGroup || 'PC';
        tipTxt = 'Playnite 记录的分组';
      } else if (isEmuPlatform(p0.platform)) {
        topSpan = '来源 <b>' + esc(pex0.sourceZh || '模拟器') + '</b>';
        tagTxt = '模拟器计数';
        tipTxt = '来自本地模拟器计数器，没有成就数据';
      } else {
        topSpan = '游玩 <b>' + gamePlayDays(game) + '</b> 天';
        tagTxt = '本平台无成就';
        tipTxt = '任天堂全平台都没有成就系统';
      }
      achBlock = '<div class="ach-block no-ach">' +
        '<div class="ach-top"><span>' + topSpan + '</span>' +
        '<span class="na-tag">' + esc(tagTxt) + '</span></div>' +
        '<div class="ach-bar-row"><div class="ach-bar na" title="' + tipTxt + '"></div></div>' +
        '<div class="ach-icons"></div></div>';
    } else {
      achBlock = '<div class="ach-block">' +
        '<div class="ach-top"><span>成就 ' + achText + '</span><span>' + pct + '%</span></div>' +
        '<div class="ach-bar-row">' +
          '<div class="ach-bar"><i style="width:' + pct + '%"></i></div>' +
          (isFullAchievement(game) ? '<i class="ach-star" title="成就已全收集（100%）">★</i>' : '') +
        '</div>' +
        '<div class="ach-icons">' + icons + '</div>' +
        '</div>';
    }

    row.innerHTML =
      coverHtml(game) +
      '<div class="g-title">' + esc(game.title) + '<span class="g-sub">' + esc(genreSub) + '</span></div>' +
      '<div class="platform-tags">' + platTags + '</div>' +
      '<div class="time">' + formatMinutes(a.total) + ' <small>合计</small></div>' +
      achBlock +
      '<div class="last-played">' + (a.last ? datePart(a.last) : '—') + '</div>';

    row.addEventListener('click', function () { openDetail(game); });
    return row;
  }

  /**
   * 游戏库页签：**一行搞定** —— 「全部」+ 各平台。
   * 「全部」= 所有已接入平台的数据合并展示；
   * 点 Steam / Xbox = 只看那个平台的数据（按每个游戏的平台标记筛回各自数据源）；
   * 还没接入的平台（Switch / PSN…）灰着排在后面，点了跳「导入」页。
   */
  /**
   * 最近游玩横幅（参照 Exophase，用户 2026-10-18 提出）：
   * 取「最近在玩且有封面」的一款游戏 —— 封面图大幅模糊当横幅背景（竖图拉宽会糊，
   * 糊了正好当氛围色块），前景叠一张清晰小封面 + 游戏信息，点击打开详情。
   * 没有可用封面时整个横幅隐藏，不占位置。
   */
  function renderHero() {
    var el = document.getElementById('library-hero');
    if (!el) return;
    var best = null, bestLast = '';
    // 跟着页签走：手机页签横幅从手机应用里挑，其余页签不含手机应用
    var pool = displayPool();
    // 手机页签优先展示「游戏」，没有合适的再退回应用（用户 2026-10-20 定）——
    // 微信、B站这类每天都有使用记录，不优先的话横幅永远是应用
    if (inPhoneScope()) {
      var phoneGames = pool.filter(function (g) {
        return (((g.platforms || [])[0] || {}).extra || {}).categoryKey === 'game';
      });
      if (phoneGames.length) pool = phoneGames;
    }
    pool.forEach(function (g) {
      if (!g.cover) return;                       // 横幅靠封面图，没封面的不参选
      var last = aggGame(g).last || '';
      if (!last) return;
      if (last > bestLast) { bestLast = last; best = g; }
    });
    if (!best) { el.className = 'hero hero-none'; el.innerHTML = ''; return; }

    var a = aggGame(best);
    var full = isFullAchievement(best);
    var coverInner = '<span>' + esc(firstChar(best.title)) + '</span>' +
      (best.cover ? '<img src="' + esc(best.cover) + '" alt="" onerror="this.remove()">' : '');
    el.className = 'hero';
    el.innerHTML =
      '<div class="hero-inner">' +
        '<div class="hero-cover' + (full ? ' full' : '') + '" style="background:' + coverColor(best.title) + '"' +
          (full ? ' title="成就已全收集（100%）"' : '') + '>' + coverInner + '</div>' +
        '<div>' +
          '<div class="hero-label">最近游玩</div>' +
          '<div class="hero-title">' + esc(best.title) + '</div>' +
          '<div class="hero-meta">' +
            '<span class="p-tag" style="background:' + getPlatform((best.platforms[0] || {}).platform).color + '">' +
              esc(gameSourceLabel(best) || getPlatform((best.platforms[0] || {}).platform).name) + '</span>' +
            '<span>总时长 <b>' + formatMinutes(a.total) + '</b></span>' +
            (gameHasAchievements(best)
              ? '<span>成就 <b>' + achCountText(a.achUnlocked, a.achTotal) + '</b>（' + a.pct + '%）</span>'
              : '') +
            '<span>最后游玩 <b>' + datePart(a.last) + '</b></span>' +
          '</div>' +
        '</div>' +
      '</div>';
    el.onclick = function () { openDetail(best); };
  }

  /** 某个数据源里「真的有游戏」的平台（按该数据自己的平台表顺序） */
  function sourcePlatforms(src) {
    var d = sourceData(src);
    if (!d) return [];
    var map = {};
    d.games.forEach(function (g) {
      (g.platforms || []).forEach(function (p) { map[p.platform] = (map[p.platform] || 0) + 1; });
    });
    return (d.platforms || [])
      .filter(function (pl) { return map[pl.id]; })
      .map(function (pl) { return { id: pl.id, name: pl.name, count: map[pl.id] }; });
  }

  /** 一个数据源包含多台主机时（目前只有 RA），把它的平台 id 归到一组 */
  var PLATFORM_GROUPS = {};   // 组 id（= SOURCES[x].platform）→ [平台 id]
  var GROUP_SUBTABS = {};     // 组 id → 子页签数组

  /** 平台 id 是否属于 RA（ra-nes / ra-gba / …） */
  function isRaPlatform(id) { return String(id || '').indexOf('ra-') === 0; }

  /** 平台 id 是否属于模拟器页签（emu-wii / emu-arc / …，与 RA 多主机同构） */
  function isEmuPlatform(id) { return String(id || '').indexOf('emu-') === 0; }

  /** 游戏是否属于某个页签（页签可能是「一台主机」，也可能是「一整个多主机数据源」） */
  function matchesPlatform(game, pid) {
    if (pid === 'all') return true;
    // 手机类别子页签：phone:game / phone:app（数据自带 category，用户 2026-10-20 定）
    if (pid.indexOf('phone:') === 0) {
      var want = pid.slice(6);
      return (game.platforms || []).some(function (p) {
        return p.platform === 'phone' && ((p.extra || {}).categoryKey === want);
      });
    }
    var group = PLATFORM_GROUPS[pid];
    if (group) {
      return (game.platforms || []).some(function (p) { return group.indexOf(p.platform) >= 0; });
    }
    return (game.platforms || []).some(function (p) { return p.platform === pid; });
  }

  /**
   * RA 概览条（用户 2026-10-19 选的形态）：只在看 RA 数据时出现。
   * 数据全部来自 data_ra.js，不联网、不额外请求（RA 是小站，一次都不去打扰）。
   */
  function renderRaOverview(activeGroup) {
    var el = document.getElementById('ra-overview');
    if (!el) return;
    var inRa = isRaPlatform(currentPlatform) || currentPlatform === 'retroachievements';
    var d = window.GAME_DATA_RETRO;
    if (!inRa || !d || !d.games || !d.games.length) { el.className = ''; el.innerHTML = ''; return; }

    var meta = d.meta || {};
    var achU = 0, achT = 0, minutes = 0, timed = 0, beaten = 0, mastered = 0;
    var hosts = {};
    d.games.forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        achU += p.achievements.unlocked || 0;
        achT += p.achievements.total || 0;
        minutes += p.totalMinutes || 0;
        if (p.totalMinutes > 0) timed += 1;
        var st = (p.extra || {}).awardState;
        if (st === 'beaten') beaten += 1;
        if (st === 'mastered') mastered += 1;
        hosts[p.platform] = (hosts[p.platform] || 0) + 1;
      });
    });
    var hostRows = Object.keys(hosts).map(function (pid) {
      return { pl: getPlatform(pid), n: hosts[pid] };
    }).sort(function (a, b) { return b.n - a.n; });

    var stat = function (label, value, tip) {
      return '<div class="ra-stat" title="' + esc(tip || '') + '"><div class="ra-sv">' + value + '</div>' +
        '<div class="ra-sl">' + esc(label) + '</div></div>';
    };
    el.className = 'ra-overview';
    el.innerHTML =
      '<div class="ra-head"><span class="ra-title">RetroAchievements · 老游戏档案</span>' +
        '<span class="ra-user">' + esc(d.ownerId || '') + (meta.siteRank ? ' · 站排名 ' + esc(meta.siteRank) : '') + '</span>' +
        (meta.updatedAt ? '<span class="ra-time">数据更新于 ' + esc(String(meta.updatedAt).slice(0, 10)) + '</span>' : '') +
      '</div>' +
      '<div class="ra-stats">' +
        stat('游戏', d.games.length, 'RA 上有过进度的游戏总数') +
        stat('成就', achU + '<small>/' + achT + '</small>', '已解锁 / 总成就数') +
        (meta.points ? stat('点数', meta.points + '<small>点</small>', meta.trueRatio ? ('TrueRatio ' + meta.trueRatio) : '') : '') +
        // 通关数 = beaten + mastered（精通的游戏也一定通关了），精通数单独小字标注
        stat('通关', (beaten + mastered) + (mastered ? '<small>含精通 ' + mastered + '</small>' : ''), 'RA 判定为 beaten / mastered 的游戏数') +
        stat('主机', hostRows.length, '覆盖的老主机 / 掌机数量') +
        (meta.averageCompletion ? stat('平均完成度', esc(meta.averageCompletion), 'RA 官方口径') : '') +
        (timed ? stat('已记录时长', formatMinutes(minutes), timed + ' 款游戏有 RA 记录的游玩时长') : '') +
      '</div>' +
      '<div class="ra-hosts">' + hostRows.map(function (r) {
        return '<span class="p-tag" style="background:' + r.pl.color + '">' + esc(r.pl.name) + ' <b>' + r.n + '</b></span>';
      }).join('') + '</div>';
  }

  /* ============================ 游玩日历 ==============================
   * 任天堂没有成就系统，详情页那个位置改成「这款游戏的游玩日历」（用户 2026-10-19 定）。
   * 游戏库顶部再放一个「总日历」：所有任天堂游戏按天汇总（每天玩了几小时）。
   * 数据来自 data_nintendo_calendar.js：
   *   NINTENDO_PLAY_DAYS  —— { titleId: [['2026-10-17', 分钟], …] }
   *   NINTENDO_DAILY_TOTAL—— { '2026-10-17': 分钟 }（全部游戏汇总）
   * ================================================================ */

  /** 单款月历当前浏览的月份：externalId → 'YYYY-MM'（总览是柱状图，不需要记月份） */
  var gameMonth = {};

  function todayMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** 'YYYY-MM' 加减一个月 */
  function shiftMonth(ym, delta) {
    var m = /^(\d{4})-(\d{2})$/.exec(ym || todayMonth());
    if (!m) return todayMonth();
    var y = Number(m[1]), mo = Number(m[2]) - 1 + delta;
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return y + '-' + String(mo + 1).padStart(2, '0');
  }

  /** 有记录的最晚一个月（打开日历时默认停在那儿，而不是空白的当月） */
  function latestMonthOf(map) {
    var keys = Object.keys(map || {});
    if (!keys.length) return todayMonth();
    keys.sort();
    return keys[keys.length - 1].slice(0, 7);
  }

  /**
   * 画一个月柱状图（2026-10-20 改版：格子月历天生只有 7 列宽，在宽弹窗里缩成
   * 一小块、手机上又太小 —— 换成「这个月每天一根柱子」，与主页
   * 「Nintendo·游玩日历」同一套视觉，宽度自适应，手机端也清晰）。
   * @param map  { 'YYYY-MM-DD': 分钟 }
   * @param ym   'YYYY-MM'
   * @param opts { navId }
   */
  function monthBarsHtml(map, ym, opts) {
    opts = opts || {};
    var verb = opts.verb || '玩了';
    var m = /^(\d{4})-(\d{2})$/.exec(ym);
    var y = m ? Number(m[1]) : new Date().getFullYear();
    var mo = m ? Number(m[2]) - 1 : new Date().getMonth();
    var mm = String(mo + 1).padStart(2, '0');
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var total = 0, active = 0, max = 0, maxDay = 0, d, key, min;
    for (d = 1; d <= daysInMonth; d++) {
      key = y + '-' + mm + '-' + String(d).padStart(2, '0');
      min = map[key] || 0;
      total += min;
      if (min) { active += 1; if (min > max) { max = min; maxDay = d; } }
    }
    var H = 96, bars = '';
    for (d = 1; d <= daysInMonth; d++) {
      key = y + '-' + mm + '-' + String(d).padStart(2, '0');
      min = map[key] || 0;
      var h = min ? Math.max(5, Math.round(min / max * H)) : 3;
      var tip = key + ' · ' + (min ? verb + ' ' + formatMinutes(min) : '没用');
      bars += '<div class="gcal-col" title="' + esc(tip) + '">' +
        '<div class="gcal-bar' + (min ? '' : ' zero') + '" style="height:' + h + 'px"></div>' +
        '<span class="gcal-l">' + (d === 1 || d % 5 === 0 ? d : '') + '</span>' +
      '</div>';
    }
    return '<div class="cal-wrap">' +
      '<div class="cal-head">' +
        '<button class="cal-nav" data-cal-nav="' + esc(opts.navId || '') + '" data-delta="-1">‹</button>' +
        '<span class="cal-title">' + y + ' 年 ' + (mo + 1) + ' 月</span>' +
        '<button class="cal-nav" data-cal-nav="' + esc(opts.navId || '') + '" data-delta="1">›</button>' +
        '<span class="cal-sum">' + (active ? (verb + ' ' + active + ' 天 · 共 ' + formatMinutes(total)) : '这个月没有记录') + '</span>' +
      '</div>' +
      '<div class="gcal-row">' + bars + '</div>' +
      '<div class="day-hint">' + (active
        ? ('柱高 = 当天时长 · 最多一天 ' + formatMinutes(max) + '（' + (mo + 1) + ' 月 ' + maxDay + ' 日）')
        : '这个月一天都没用。') + '</div>' +
    '</div>';
  }

  /**
   * 总日历改用柱状图（用户 2026-10-19：月历放在宽卡片里显得空）。
   * 最近 N 天，每天一根柱子，高度 = 当天时长；没玩的日子一根矮灰点。
   * 31 天不算长——横着排一天一根，正好利用卡片宽度；90 天也塞得下。
   */
  var nintendoRange = 30;      // 总日历显示最近多少天（30 / 90）
  var nintendoDayKey = null;   // 点进去看明细的那一天（'YYYY-MM-DD'）
  var nintendoDayScope = null; // 上面这天是「哪个页签」点的（换页签要清掉）

  function dailyBarsHtml(map, days) {
    var cols = [], total = 0, active = 0, max = 0;
    var base = new Date();
    base.setHours(0, 0, 0, 0);
    for (var i = days - 1; i >= 0; i--) {
      var dt = new Date(base.getTime() - i * 86400000);
      var mm = String(dt.getMonth() + 1).padStart(2, '0');
      var dd = String(dt.getDate()).padStart(2, '0');
      var key = dt.getFullYear() + '-' + mm + '-' + dd;
      var min = map[key] || 0;
      total += min;
      if (min) { active += 1; if (min > max) max = min; }
      cols.push({ key: key, min: min, day: dt.getDate(), mon: dt.getMonth() + 1, dow: dt.getDay() });
    }
    var bars = cols.map(function (c) {
      var h = max ? Math.max(4, Math.round(c.min / max * 100)) : 4;
      // 标签：每月 1 号必标，其余每周一标一次（90 天也不会挤成一团）
      var showLabel = (c.day === 1) || (c.dow === 1) || (days <= 30 && c.day % 5 === 0);
      return '<div class="dbar-col' + (nintendoDayKey === c.key ? ' picked' : '') + '"' +
        ' data-ns-day="' + c.key + '"' +
        ' title="' + esc(c.key + ' · ' + (c.min ? formatMinutes(c.min) + '（点一下看玩了什么）' : '没玩')) + '">' +
        '<div class="dbar' + (c.min ? '' : ' zero') + '" style="height:' + (c.min ? h : 3) + 'px"></div>' +
        '<span class="dbar-l">' + (showLabel ? c.day : '') + '</span></div>';
    }).join('');

    return '<div class="dbar-legend">' +
        '<span>最近 ' + days + ' 天玩了 ' + active + ' 天 · 共 ' + formatMinutes(total) +
        (max ? ' · 最多一天 ' + formatMinutes(max) : '') + '</span>' +
        '<span class="dbar-toggle">' +
          '<button class="cal-nav rng' + (nintendoRange === 30 ? ' on' : '') + '" data-ns-range="30">30 天</button>' +
          '<button class="cal-nav rng' + (nintendoRange === 90 ? ' on' : '') + '" data-ns-range="90">90 天</button>' +
        '</span>' +
      '</div>' +
      '<div class="dbar-row">' + bars + '</div>' +
      dayDetailHtml();
  }

  /**
   * 点某一天 → 列出那天玩了哪些游戏、各玩多久。
   * 总览柱状图看得出「哪天肝了」，但看不出玩的是什么，所以补这一层。
   */
  function nintendoDayGames(dateKey) {
    var out = [];
    (DATA.games || []).forEach(function (g) {
      if (!matchesPlatform(g, currentPlatform)) return;
      (g.platforms || []).forEach(function (p) {
        if (!isNintendoPlatform(p.platform)) return;
        var arr = (window.NINTENDO_PLAY_DAYS || {})[p.externalId];
        if (!arr) return;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i][0] === dateKey) out.push({ game: g, p: p, minutes: arr[i][1] || 0 });
        }
      });
    });
    out.sort(function (a, b) { return b.minutes - a.minutes; });
    return out;
  }

  function dayDetailHtml() {
    if (!nintendoDayKey) return '<div class="day-hint">点上面任意一天，看那天具体玩了什么</div>';
    var rows = nintendoDayGames(nintendoDayKey);
    if (!rows.length) {
      return '<div class="day-panel"><div class="day-head">' +
        '<span class="day-date">' + esc(nintendoDayKey) + '</span>' +
        '<span class="day-total">这天没有游玩记录</span>' +
        '<button class="day-close" data-ns-dayclose="1">×</button></div></div>';
    }
    var total = rows.reduce(function (s, r) { return s + r.minutes; }, 0);
    var lis = rows.map(function (r) {
      var pl = getPlatform(r.p.platform);
      return '<div class="day-row" data-ns-game="' + esc(r.p.externalId || '') + '">' +
        '<img class="day-cover" src="' + esc(r.game.cover || '') + '" alt="" loading="lazy">' +
        '<span class="day-name">' + esc(r.game.title) + '</span>' +
        '<span class="p-tag day-pl" style="background:' + pl.color + '">' + esc(pl.name) + '</span>' +
        '<span class="day-min">' + formatMinutes(r.minutes) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="day-panel">' +
      '<div class="day-head">' +
        '<span class="day-date">' + esc(nintendoDayKey) + '</span>' +
        '<span class="day-total">' + rows.length + ' 款 · 共 ' + formatMinutes(total) + '</span>' +
        '<button class="day-close" data-ns-dayclose="1">×</button>' +
      '</div>' + lis + '</div>';
  }

  /** 取「当前页签范围内」的按天汇总：{ 'YYYY-MM-DD': 分钟 } */
  function nintendoDailyMap() {
    var out = {};
    var games = (DATA.games || []).filter(function (g) { return matchesPlatform(g, currentPlatform); });
    games.forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (!isNintendoPlatform(p.platform)) return;
        var arr = (window.NINTENDO_PLAY_DAYS || {})[p.externalId];
        if (!arr) return;
        for (var i = 0; i < arr.length; i++) {
          out[arr[i][0]] = (out[arr[i][0]] || 0) + (arr[i][1] || 0);
        }
      });
    });
    return out;
  }

  /** 单款游戏的按天记录：{ 'YYYY-MM-DD': 分钟 }（任天堂用总表；手机用 extra.daily，毫秒换算分钟） */
  function gameDailyMap(p) {
    var out = {};
    if (isNintendoPlatform(p.platform)) {
      var arr = (window.NINTENDO_PLAY_DAYS || {})[p.externalId];
      if (!arr) return out;
      for (var i = 0; i < arr.length; i++) out[arr[i][0]] = arr[i][1] || 0;
      return out;
    }
    var daily = (p.extra || {}).daily || {};
    for (var k in daily) {
      if (Object.prototype.hasOwnProperty.call(daily, k)) out[k] = Math.round((daily[k] || 0) / 60000);
    }
    return out;
  }

  /**
   * 详情页里的「这款游戏的游玩日历」。
   * 任天堂没有成就系统，成就列表那一块就不渲染了，由这个日历顶上（用户 2026-10-19 定）。
   */
  var gameCalCtx = null;    // 当前详情页在展示哪一款（翻月份时要重画）

  function gameCalendarHtml(p) {
    var map = gameDailyMap(p);
    if (!Object.keys(map).length) {
      return '<div class="a-desc">这款游戏没有按天记录' +
        (p.platform === 'nintendo-3ds' ? ' —— 3DS 任天堂不提供日历，属正常现象（小黑盒同样没有）。' : '。') +
        '</div>';
    }
    var key = String(p.externalId || '');
    if (!gameMonth[key]) gameMonth[key] = latestMonthOf(map);
    return monthBarsHtml(map, gameMonth[key], {
      navId: key,
      verb: isNintendoPlatform(p.platform) ? '玩了' : '用了',
    });
  }

  function gameCalendarSection(game) {
    // 任天堂 = 游玩日历；手机 = 使用日历（用户 2026-10-20 定：手机详情页也要日历，
    // 但列表页顶部那条「总日历」不要 —— 手机天天用，柱子全是满的没信息量）
    var p = (game.platforms || []).filter(function (x) { return isNintendoPlatform(x.platform); })[0]
         || phoneEntry(game);
    if (!p) return '';
    gameCalCtx = p;
    var title = isNintendoPlatform(p.platform) ? '游玩日历' : '使用日历';
    return '<div class="section-title">' + title + '</div>' +
      '<div id="game-cal-box">' + gameCalendarHtml(p) + '</div>';
  }

  function refreshGameCalendar() {
    if (!gameCalCtx) return;
    var box = document.getElementById('game-cal-box');
    if (box) box.innerHTML = gameCalendarHtml(gameCalCtx);
  }

  /** 日历交互：总览的 30/90 天切换、点某一天看明细、单款月历左右翻月（一个委托监听搞定） */
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var rng = e.target.closest('[data-ns-range]');
    if (rng) {
      nintendoRange = Number(rng.getAttribute('data-ns-range')) || 30;
      renderNintendoOverview('nintendo');
      return;
    }
    var closeBtn = e.target.closest('[data-ns-dayclose]');
    if (closeBtn) { nintendoDayKey = null; renderNintendoOverview('nintendo'); return; }

    var col = e.target.closest('[data-ns-day]');
    if (col) {
      var key = col.getAttribute('data-ns-day');
      nintendoDayKey = (nintendoDayKey === key) ? null : key;   // 再点一下收起
      renderNintendoOverview('nintendo');
      return;
    }

    if (e.target.closest('#share-growth')) { buildGrowthPoster(); return; }
    if (e.target.closest('#gp-download')) { downloadGrowthPoster(); return; }
    if (e.target.closest('#gp-close')) {
      var gp = document.getElementById('growth-poster');
      if (gp) gp.remove();
      growthPosterUrl = null;
      return;
    }

    // 明细里点某一款 → 打开这款游戏的详情页
    var grow = e.target.closest('[data-ns-game]');
    if (grow) {
      var tid = String(grow.getAttribute('data-ns-game') || '');
      var g = (DATA.games || []).filter(function (x) {
        return (x.platforms || []).some(function (p) { return String(p.externalId) === tid; });
      })[0];
      if (g) openDetail(g);
      return;
    }
    // 时间轴：加载更多（按月 +6 / 按天 +30）/ 切换粒度 / 点某一款打开详情
    var tlm = e.target.closest('[data-tl-mode]');
    if (tlm) {
      var mv = tlm.getAttribute('data-tl-mode');
      if (mv !== tlMode) {
        tlMode = mv;
        careerTlMonths = 6; careerTlDays = 30; careerFirstYears = 1;   // 换粒度从头开始
        refreshTimeline();
        // 按钮高亮跟手（refreshTimeline 只重画内容区，按钮是面板头里的静态 HTML）
        [].forEach.call(document.querySelectorAll('[data-tl-mode]'), function (b) {
          b.className = 'cal-nav rng' + (b.getAttribute('data-tl-mode') === tlMode ? ' on' : '');
        });
      }
      return;
    }
    if (e.target.closest('#tl-more')) {
      // 首次游玩按年加载，按月 +6，按天 +30——各视图自己的步长
      if (tlMode === 'first') careerFirstYears += 1;
      else if (tlMode === 'day') careerTlDays += 30;
      else careerTlMonths += 6;
      refreshTimeline();
      return;
    }
    // Top 排行：展开到 50
    if (e.target.closest('#top-more')) {
      topLimit = 50;
      refreshTop();
      return;
    }
    var btn = e.target.closest('[data-cal-nav]');
    if (!btn) return;
    var id = btn.getAttribute('data-cal-nav');
    var delta = Number(btn.getAttribute('data-delta')) || 0;
    gameMonth[id] = shiftMonth(gameMonth[id] || todayMonth(), delta);
    refreshGameCalendar();
  });

  /** 顶部「任天堂游玩日历」总览（位置同 RA 概览条） */
  function renderNintendoOverview(activeGroup) {
    var el = document.getElementById('nintendo-overview');
    if (!el) return;
    var inNin = isNintendoPlatform(currentPlatform) || currentPlatform === 'nintendo';
    if (!inNin || activeGroup !== 'nintendo') { el.className = ''; el.innerHTML = ''; return; }

    var map = nintendoDailyMap();
    var allKeys = Object.keys(map);
    if (!allKeys.length) { el.className = ''; el.innerHTML = ''; return; }
    // 换主机页签时清掉「点进去的那天」，免得明细和柱状图不是一个范围
    if (nintendoDayScope !== currentPlatform) {
      nintendoDayScope = currentPlatform;
      nintendoDayKey = null;
    }

    var totalMin = 0, dayCount = 0;
    allKeys.forEach(function (k) { totalMin += map[k]; dayCount += 1; });
    var scope = getPlatform(currentPlatform);
    var scopeName = (currentPlatform === 'nintendo') ? '全部主机' : (scope ? scope.name : '');

    el.className = 'nintendo-overview';
    el.innerHTML =
      '<div class="ra-head"><span class="ra-title">Nintendo · 游玩日历</span>' +
        '<span class="ra-user">' + esc(scopeName) + '</span>' +
        '<span class="ra-time">共 ' + dayCount + ' 天有记录 · 累计 ' + formatMinutes(totalMin) + '</span>' +
      '</div>' +
      dailyBarsHtml(map, nintendoRange);
  }

  function renderLibrary() {
    renderHero();
    var tabsEl = document.getElementById('library-tabs');
    var listEl = document.getElementById('library-list');

    // 还没有任何数据：显示引导（手机可能单独有数据，别把它漏了）
    if ((!DATA.games || DATA.games.length === 0) && !(sourceData('phone') || { games: [] }).games.length) {
      tabsEl.innerHTML = '';
      var ovEmpty = document.getElementById('ra-overview');
      if (ovEmpty) { ovEmpty.className = ''; ovEmpty.innerHTML = ''; }
      listEl.innerHTML = '<div class="placeholder"><div class="big">[ + ]</div><h2>还没有游戏数据</h2>' +
        '<p>去「导入」页连接一个平台（Steam / Xbox），把你的游戏库拉取下来。</p>' +
        '<button class="src-btn go-import" id="empty-go-import">前往导入页连接平台</button></div>';
      var go = document.getElementById('empty-go-import');
      if (go) go.addEventListener('click', function () { navigate('import'); });
      return;
    }

    // 页签：每个数据源只出「自己真的有游戏」的那些平台。
    // RA 特殊：一个数据源里游戏分属多台主机（FC/GBA/NDS…），按 ra-主机 拆成多个平台，
    // 所以额外再出一排主机子页签（用户 2026-10-19 定，和 exophase 的 RA-GBA / RA-NDS 一致）。
    PLATFORM_GROUPS = {};
    GROUP_SUBTABS = {};
    var tabs = [{ id: 'all', name: '全部', count: DATA.games.length, on: true, src: '' }];
    SOURCE_ORDER.forEach(function (s) {
      var def = SOURCES[s];
      var d = sourceData(s);
      if (!d) { tabs.push({ id: def.platform, name: def.short, count: null, on: false, src: s }); return; }
      var plats = sourcePlatforms(s);
      if (plats.length <= 1) {
        tabs.push({ id: plats.length ? plats[0].id : def.platform, name: def.short, count: d.games.length, on: true, src: s });
        return;
      }
      PLATFORM_GROUPS[def.platform] = plats.map(function (p) { return p.id; });
      tabs.push({ id: def.platform, name: def.short, count: d.games.length, on: true, src: s });
      GROUP_SUBTABS[def.platform] = [{ id: def.platform, name: '全部主机', count: d.games.length, on: true, src: s }]
        .concat(plats.map(function (p) { return { id: p.id, name: p.name, count: p.count, on: true, src: s }; }));
    });

    // 手机：一个源里全是 App，按「类别」拆子页签（用户 2026-10-20 定，形态同任天堂主机子页签）。
    // 类别来自导出文件自带的 category 字段：游戏 / 应用。
    var phoneData = sourceData('phone');
    if (phoneData && phoneData.games.length) {
      var nGame = 0, nApp = 0;
      phoneData.games.forEach(function (g) {
        var k = (((g.platforms || [])[0] || {}).extra || {}).categoryKey;
        if (k === 'game') nGame += 1; else nApp += 1;
      });
      GROUP_SUBTABS.phone = [
        { id: 'phone', name: '全部', count: phoneData.games.length, on: true, src: 'phone' },
        { id: 'phone:game', name: '游戏', count: nGame, on: true, src: 'phone' },
        { id: 'phone:app', name: '应用', count: nApp, on: true, src: 'phone' }
      ];
    }

    function tabHtml(t) {
      var active = (t.id === currentPlatform) ? ' active' : '';
      var cls = 'tab' + (t.on ? '' : ' off') + active;
      var tip = t.on ? (t.name + ' · ' + t.count + ' 款') : (t.name + ' 还没接入，点我去「导入」页连接');
      return '<button class="' + cls + '" data-pid="' + esc(t.id) + '" data-src="' + esc(t.src || '') + '" title="' + esc(tip) + '">' +
        esc(t.name) + (t.on ? '<small>' + t.count + '</small>' : '') +
        '</button>';
    }

    // 当前选中的平台属于哪个「多主机组」？属于就补一排主机子页签
    var activeGroup = null;
    Object.keys(PLATFORM_GROUPS).forEach(function (gid) {
      if (currentPlatform === gid || PLATFORM_GROUPS[gid].indexOf(currentPlatform) >= 0) activeGroup = gid;
    });
    // 手机的子页签不是「主机」，而是「类别」，单独认一下
    if (GROUP_SUBTABS.phone && (currentPlatform === 'phone' || currentPlatform.indexOf('phone:') === 0)) {
      activeGroup = 'phone';
    }

    tabsEl.innerHTML = '<div class="tabs">' + tabs.map(tabHtml).join('') + '</div>' +
      (activeGroup ? '<div class="tabs sub">' + GROUP_SUBTABS[activeGroup].map(tabHtml).join('') + '</div>' : '');

    [].forEach.call(tabsEl.querySelectorAll('.tab'), function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-pid');
        var src = btn.getAttribute('data-src');
        if (pid !== 'all' && src && !sourceData(src)) { navigate('import'); return; }
        currentPlatform = pid;
        renderLibrary();
      });
    });

    renderRaOverview(activeGroup);
    renderNintendoOverview(activeGroup);
    // 手机不做列表页总日历（用户 2026-10-20 定：手机天天用，柱子全是满的没信息量）；
    // 日历放在每个应用的详情页里（gameCalendarSection 已支持手机）。

    // 排序工具条
    var sortBar = listEl.querySelector('.sort-bar');
    if (!sortBar) {
      sortBar = document.createElement('div');
      sortBar.className = 'sort-bar';
      sortBar.innerHTML = '<span class="sort-label">排序</span>' +
        '<select id="sort-select">' +
          '<option value="lastPlayed">最近游玩</option>' +
          '<option value="playtime">总时长</option>' +
          '<option value="achievements">成就进度</option>' +
          '<option value="title">游戏名称</option>' +
        '</select>';
      listEl.appendChild(sortBar);
      sortBar.querySelector('#sort-select').addEventListener('change', function (e) {
        currentSort = e.target.value;
        renderLibrary();
      });
    }
    sortBar.querySelector('#sort-select').value = currentSort;

    // 列表：手机页签用手机自己的数据池（手机应用不进「全部」，用户 2026-10-20 拍板）
    var games = displayPool().slice();
    if (currentPlatform !== 'all') {
      games = games.filter(function (g) { return matchesPlatform(g, currentPlatform); });
    }
    sortGames(games);

    if (games.length === 0) {
      listEl.innerHTML = '<div class="placeholder"><div class="big">[ ]</div><h2>该平台暂无游戏</h2></div>';
      appendPhoneHiddenBar(listEl);
      return;
    }

    // 保留 sort-bar，只重建游戏行
    var bar = listEl.querySelector('.sort-bar');
    listEl.innerHTML = '';
    listEl.appendChild(bar);
    games.forEach(function (g) { listEl.appendChild(buildGameRow(g)); });
    appendPhoneHiddenBar(listEl);
  }

  /* ====================== 游戏详情弹层 ====================== */

  /** 取手机的 platformPlay（不是手机条目返回 null） */
  function phoneEntry(game) {
    var arr = (game && game.platforms) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].platform === 'phone') return arr[i];
    }
    return null;
  }

  /**
   * 手机条目专属：分类手改 + 显示 / 隐藏开关。
   * 分类（用户 2026-10-20 定）：UU加速器这类被系统填成「游戏」的，手动改成「应用」后
   * 不进游戏排行、不进「游戏」子页签。改动存 overrides.json，重新导入不覆盖。
   */
  function phoneToggleHtml(game) {
    var p = phoneEntry(game);
    if (!p) return '';
    var hidden = !!(p.extra || {}).hidden;
    var cat = (p.extra || {}).category || '应用';
    return '<div class="ph-toggle-row">' +
        '<span class="ph-cat-label">分类</span>' +
        '<span class="ph-cat-seg">' +
          '<button class="ph-cat-btn' + (cat === '游戏' ? ' active' : '') + '" data-ph-cat="游戏">游戏</button>' +
          '<button class="ph-cat-btn' + (cat === '应用' ? ' active' : '') + '" data-ph-cat="应用">应用</button>' +
        '</span>' +
        '<span class="ph-toggle-tip">手改分类决定它进不进游戏排行和「游戏」子页签</span>' +
      '</div>' +
      '<div class="ph-toggle-row">' +
        '<button class="ph-btn' + (hidden ? ' on' : '') + '" id="ph-vis-btn">' +
          (hidden ? '恢复显示' : '在列表中隐藏') +
        '</button>' +
        '<span class="ph-toggle-tip">' +
          (hidden ? '当前已隐藏，统计里也不计入' : '隐藏后，列表和统计都不再算它') +
        '</span></div>';
  }

  /** 手改分类：存 overrides → 就地更新弹层按钮和分类格 → 重绘背后列表 */
  function setPhoneCategory(game, cat, mask) {
    var p = phoneEntry(game);
    if (!p) return;
    var pkg = (p.extra || {}).pkg || p.externalId;
    fetch('/api/phone/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkg: pkg, category: cat })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '保存失败');
      if (!p.extra) p.extra = {};
      p.extra.category = cat;
      p.extra.categoryKey = (cat === '游戏') ? 'game' : 'app';
      invalidateSource('phone');
      renderLibrary();
      // 弹层不用关：按钮态 + 「类别」一格就地更新
      [].forEach.call(mask.querySelectorAll('.ph-cat-btn'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-ph-cat') === cat);
      });
      [].forEach.call(mask.querySelectorAll('.pcard .k'), function (k) {
        if (k.textContent === '类别' && k.nextElementSibling) k.nextElementSibling.textContent = cat;
      });
    }).catch(function (e) {
      window.alert('保存失败：' + e.message);
    });
  }

  /** 点开关 → 存到 data/phone/overrides.json（本地文件，不联网）→ 重绘当前列表 */
  function togglePhoneVisible(game, mask) {
    var p = phoneEntry(game);
    if (!p) return;
    var pkg = (p.extra || {}).pkg || p.externalId;
    var nextHidden = !(p.extra || {}).hidden;
    var btn = mask ? mask.querySelector('#ph-vis-btn') : null;
    if (btn) { btn.disabled = true; btn.textContent = '正在保存…'; }
    fetch('/api/phone/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkg: pkg, visible: !nextHidden })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '保存失败');
      if (!p.extra) p.extra = {};
      p.extra.hidden = nextHidden;
      invalidateSource('phone');       // 数据是原地改的，引用没变 → 手动清缓存
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
      renderLibrary();
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = '保存失败，点我重试'; }
      window.alert('保存失败：' + e.message);
    });
  }

  /** 按登记表格式化某个平台特有字段；无值返回 null */
  function formatFieldValue(type, v) {
    if (v === null || v === undefined || v === '') return null;
    if (type === 'minutes') return formatMinutes(v);
    if (type === 'date') return datePart(v);
    if (type === 'bool') return v ? '是' : '否';
    if (type === 'number') return String(v);
    if (Array.isArray(v)) return v.join(' / ');
    return String(v);
  }

  /* ============================ 平台差异化展示（详情页） ==============================
   * 不同平台的详情页注定长得不一样（用户 2026-10-18 确认），所以做成登记表：
   *   hasAchievements —— 该平台有没有成就系统（任天堂 Switch 没有 → 详情页不渲染成就区）
   *   achStyle        —— 成就区样式：'card'(Xbox 官方风大卡片) / 'compact'(紧凑列表) / 'none'
   * 以后接新平台（Switch / PSN / Epic / 模拟器）只在这里加一行，不用改渲染主流程。
   * ============================================================================ */
  var PLATFORM_DETAIL = {
    steam:  { hasAchievements: true,  achStyle: 'compact' },
    xbox:   { hasAchievements: true,  achStyle: 'card' },     // 官方风：大图 + G 分数 + 获得率
    psn:    { hasAchievements: true,  achStyle: 'compact' },  // 奖杯（未来接入）
    epic:   { hasAchievements: false, achStyle: 'none' },     // Epic 成就接口已关闭，平台层面没有成就 → 不渲染成就区
    phone:  { hasAchievements: false, achStyle: 'none' },     // 手机（屏幕账本）只记使用时长，没有成就
    pc:     { hasAchievements: true,  achStyle: 'compact' },  // PC（Playnite 本地库）只有拿到本地成就数据（AchievementWall）才显示成就——gameHasAchievements 里对 pc 有特判
    emulator: { hasAchievements: false, achStyle: 'none' },   // 模拟器（本地计数器）没有成就数据
    switch: { hasAchievements: false, achStyle: 'none' },     // 任天堂没有成就系统（旧占位，保留）
    retroachievements: { hasAchievements: true, achStyle: 'compact' }
  };

  /** 任天堂主机（nintendo-switch / nintendo-switch2 / nintendo-3ds / nintendo-ds）
   *  任天堂从没做过成就系统——不是没拉到，是压根没有，所以成就区永远不渲染。
   *  nintendo-ds 是 3DS 实机上的 DS 卡带（2026-10-23，时长为估算值）。 */
  var NINTENDO_PLATFORM_IDS = ['nintendo-switch', 'nintendo-switch2', 'nintendo-3ds', 'nintendo-ds'];
  function isNintendoPlatform(id) { return NINTENDO_PLATFORM_IDS.indexOf(id) >= 0; }

  function platformDetail(platform) {
    if (isNintendoPlatform(platform)) return { hasAchievements: false, achStyle: 'none' };
    if (isEmuPlatform(platform)) return PLATFORM_DETAIL.emulator;   // emu-* 主机共用模拟器一张表
    return PLATFORM_DETAIL[platform] || { hasAchievements: true, achStyle: 'compact' };
  }

  /** 取某平台的「特有字段」登记表；
   *  RA 拆出来的 ra-* 主机共用 retroachievements 一张表，
   *  任天堂三台主机共用 nintendo 一张表，
   *  模拟器拆出来的 emu-* 主机共用 emulator 一张表。 */
  function platformFieldDefs(pid) {
    var F = window.PLATFORM_FIELDS || {};
    if (F[pid]) return F[pid];
    if (isRaPlatform(pid)) return F.retroachievements || [];
    if (isNintendoPlatform(pid)) return F.nintendo || [];
    if (isEmuPlatform(pid)) return F.emulator || [];
    if (pid.indexOf('phone:') === 0) return F.phone || [];
    return [];
  }

  /** 这款游戏的详情页要不要显示成就区（任一所属平台有成就系统就算有） */
  function gameHasAchievements(game) {
    return (game.platforms || []).some(function (p) {
      // PC 特判（2026-10-25）：只有真拿到本地成就数据才显示成就区，没数据的老 PC 游戏照旧不渲染
      if (p.platform === 'pc') return (p.achievements.items || []).length > 0;
      return platformDetail(p.platform).hasAchievements;
    });
  }

  /** 游玩天数：优先用按天记录的实际条数；3DS 拿不到日历，退回官方清单给的天数 */
  function gamePlayDays(game) {
    var n = 0;
    (game.platforms || []).forEach(function (p) {
      var ex = p.extra || {};
      var d = Number(ex.calendarDays || 0) || Number(ex.totalPlayedDays || 0);
      if (d > n) n = d;
    });
    return n;
  }

  /** 这款游戏里，所有「有成就系统且有明细」的平台（跨端游戏可能同时有 Steam + Xbox 成就） */
  function achievementPlatforms(game) {
    return (game.platforms || []).filter(function (p) {
      return platformDetail(p.platform).hasAchievements && (p.achievements.items || []).length > 0;
    });
  }

  /** 紧凑列表式成就条目（Steam / PSN / 模拟器 等，图标小、一行一条） */
  function compactAchHtml(it) {
    // unlockedAt 为空但 unlocked=true（本地成就墙只有计数没时间）也算已解锁
    var on = !!it.unlockedAt || it.unlocked === true;
    // 远程图标：本地版先不加载（走后端按需下载→本地）；线上版直接显示（CDN 地址可靠）
    var badgeInner = !it.iconUrl ? '★'
      : (/^https?:/.test(it.iconUrl)
          ? (window.GH_STATIC
              ? '<img src="' + esc(it.iconUrl) + '" alt="" loading="lazy" onerror="this.remove()">'
              : '<img class="pending" data-ach="' + esc(it.id) + '" data-remote="' + esc(it.iconUrl) + '">')
          : '<img src="' + esc(it.iconUrl) + '" alt="" onerror="this.remove()">');
    // RA 成就带点数（0 点的是「进度型」成就），有的平台没有这项，就自动不显示
    var pts = (it.points !== null && it.points !== undefined && it.points !== '') ? (' · ' + it.points + ' 点') : '';
    var extra = pts + (on ? (it.unlockedAt ? ' · 解锁于 ' + datePart(it.unlockedAt) : ' · 已解锁（时间未记录）') : ' · 未解锁');
    return '<div class="ach-item ' + (on ? 'on' : 'off') + '">' +
      '<div class="badge">' + badgeInner + (on ? '<i class="tick">✓</i>' : '') + '</div>' +
      '<div><div class="a-name">' + esc(it.name) + '</div>' +
      '<div class="a-desc">' + esc(it.description || '') + extra + '</div></div>' +
    '</div>';
  }

  /**
   * Xbox 官方风成就卡片：左边大图（约占一半），右边文字 + G 分数 + 获得率 + 进度条。
   * 参照 Xbox 官方成就页的排版（用户 2026-10-18 提出参照官方放大）。
   */
  function xboxAchCardHtml(it) {
    var on = !!it.unlockedAt;
    var img = !it.iconUrl ? '<span class="xach-noimg">★</span>'
      : (/^https?:/.test(it.iconUrl)
          ? (window.GH_STATIC
              ? '<img src="' + esc(it.iconUrl) + '" alt="" loading="lazy" onerror="this.remove()">'
              : '<img class="pending" data-ach="' + esc(it.id) + '" data-remote="' + esc(it.iconUrl) + '" alt="">')
          : '<img src="' + esc(it.iconUrl) + '" alt="" onerror="this.remove()">');
    var rarityTxt = (it.rarity != null) ? (' · ' + it.rarity + '% 的玩家已获得') : '';
    return '<div class="xach-card ' + (on ? 'on' : 'off') + '">' +
      '<div class="xach-img">' + img +
        (on ? '<i class="xach-tick">✓</i>' : '<i class="xach-lock">🔒</i>') + '</div>' +
      '<div class="xach-info">' +
        '<div class="xach-top"><span class="xach-name">' + esc(it.name) + '</span>' +
          (it.gamerscore ? '<span class="xach-g">' + esc(it.gamerscore) + '</span>' : '') + '</div>' +
        '<div class="xach-desc">' + esc(it.description || '') + '</div>' +
        '<div class="xach-bar"><i style="width:' + (on ? 100 : 0) + '%"></i></div>' +
        '<div class="xach-meta">' + (on ? ('已解锁 ' + datePart(it.unlockedAt)) : '已解锁 0%') + rarityTxt + '</div>' +
      '</div>' +
    '</div>';
  }

  function openDetail(game) {
    var a = aggGame(game);

    var pcards = game.platforms.map(function (p) {
      var pl = getPlatform(p.platform);
      var pct = achPct(p.achievements.unlocked, p.achievements.total, p);
      var cell = function (k, v) {
        return '<div><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
      };
      // 通用字段：没值的就不显示（例如 Steam 没有「首次游玩」）
      var cells = '';
      cells += cell('时长', formatMinutes(p.totalMinutes));
      if (p.lastPlayedAt) cells += cell('最后游玩', datePart(p.lastPlayedAt));
      if (p.firstPlayedAt) cells += cell('首次游玩', datePart(p.firstPlayedAt));
      // 成就一行：该平台没有成就系统（如 Switch）就不显示；PC 只有真有成就数据才显示
      if (platformDetail(p.platform).hasAchievements && (p.platform !== 'pc' || (p.achievements.items || []).length > 0)) {
        cells += cell('成就', achCountText(p.achievements.unlocked, p.achievements.total));
      }
      if (p.launchSessions && p.launchSessions.length) cells += cell('启动次数', p.launchSessions.length);
      if (p.timeRecords && p.timeRecords.length) cells += cell('时间记录', p.timeRecords.length);
      // 平台特有字段：来自 platform_fields.js 登记表
      // RA 按主机拆成 ra-nes / ra-gba … 多个平台，它们共用 retroachievements 那张字段表
      var defs = platformFieldDefs(p.platform);
      var extraCells = defs.map(function (d) {
        var v = formatFieldValue(d.type, (p.extra || {})[d.key]);
        return v === null ? '' : cell(d.label, esc(v));
      }).join('');
      return '<div class="pcard" style="border-left-color:' + pl.color + '">' +
        '<div class="pcard-head">' +
          '<span class="p-tag" style="background:' + pl.color + '">' + esc(pl.name) + '</span>' +
          // 平台原始名只在「有区分价值」时显示：不是十六进制代号、也不与标题重复
          (!/^[0-9a-f]{32}$/i.test(String(p.title || '')) && p.title !== game.title
            ? '<span class="pcard-title">' + esc(p.title) + '</span>'
            : '') +
        '</div>' +
        '<div class="pcard-grid">' + cells + extraCells + '</div>' +
        (defs.length ? '<div class="pcard-note">以上为该平台特有字段（' + esc(pl.name) + '）</div>' : '') +
        // 没有成就系统的平台（任天堂全平台）不画那条进度条，免得看着像「0% 未解锁」
        (platformDetail(p.platform).hasAchievements
          ? '<div class="ach-bar" style="margin-top:9px"><i style="width:' + pct + '%"></i></div>'
          : '') +
      '</div>';
    }).join('');

    var achHtml = a.items.map(compactAchHtml).join('')
      || '<div class="a-desc" style="color:var(--text-2)">暂无成就数据</div>';

    // 成就区：按平台登记表决定「显示不显示」+「每个平台各用什么样式」。
    // 任天堂 Switch 这类没有成就系统的平台 → 整块不渲染（用户 2026-10-18 要求提前分开设计）。
    // 跨端游戏（如同时在 Steam 和 Xbox 有记录）→ 各平台各渲染一段，互不吞掉。
    var showAch = gameHasAchievements(game);
    var achBlockHtml = '';
    if (showAch) {
      var achPlats = achievementPlatforms(game);
      var multi = achPlats.length > 1;   // 多于一个平台有成就时才加小标题
      // RA 的成就明细是「打开详情才按需拉」的（省请求）；没拉到时给一句人话提示，别让人以为坏了
      // total > 0 说明有成就组要拉明细；total 为 0 但时长也空 → 也要拉（这类游戏没有成就组，
      // 但 RA 仍记了游玩时长，不拉就永远显示「—」）。已经拉到明细的一律不再请求。
      var raPending = achPlats.some(function (p) {
        return String(p.platform).indexOf('ra-') === 0
          && !(p.achievements.items || []).length
          && (p.achievements.total > 0 || !p.totalMinutes);
      });
      achBlockHtml = achPlats.map(function (p) {
        var st = platformDetail(p.platform).achStyle;
        var body = (st === 'card')
          // Xbox 官方风大卡片：大图占一半、文字占一半，带 G 分数 / 获得率 / 进度条
          ? '<div class="xach-grid">' + p.achievements.items.map(xboxAchCardHtml).join('') + '</div>'
          : '<div class="ach-list">' + p.achievements.items.map(compactAchHtml).join('') + '</div>';
        return (multi ? '<div class="ach-sub">' + esc(getPlatform(p.platform).name) + ' 成就</div>' : '') + body;
      }).join('');
      if (!achBlockHtml) achBlockHtml = '<div class="ach-list">' + achHtml + '</div>';   // 明细还没拉到时用聚合列表兜底
      if (raPending) {
        achBlockHtml = '<div class="a-desc" style="color:var(--text-2);margin-bottom:8px">'
          + '正在从 RetroAchievements 补全成就明细和游玩时长（只这一次，之后存本地）…</div>' + achBlockHtml;
      }
    }

    var metaHtml =
      metaCell('总时长', formatMinutes(a.total)) +
      metaCell('首次游玩', a.first ? datePart(a.first) : '—') +
      metaCell('最后游玩', a.last ? datePart(a.last) : '—') +
      metaCell('数据来源', gameSourceLabel(game) || '—') +
      (game.developer ? metaCell('开发商', esc(game.developer)) : '') +
      (game.publisher && game.publisher !== game.developer ? metaCell('发行商', esc(game.publisher)) : '') +
      (game.releaseDate ? metaCell('发行日期', esc(game.releaseDate)) : '') +
      (showAch ? metaCell('成就', achCountText(a.achUnlocked, a.achTotal)) : '') +
      metaCell('类型', (game.genres && game.genres.length) ? game.genres.join(' / ') : '—');

    // 别名行：滤掉无意义的十六进制代号（Epic 的 appName）和与标题重复的，别让人看乱码
    var aliases = ((game.aliases || []).filter(function (x) {
      return x && !/^[0-9a-f]{32}$/i.test(x) && x !== game.title;
    })).join(' · ');

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal" role="dialog">' +
        '<div class="modal-head">' +
          coverHtml(game, true) +
          '<div><h2>' + esc(game.title) + '</h2><div class="aliases">' + esc(aliases) + '</div></div>' +
          '<button class="modal-close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="section-title">基本信息</div>' +
        '<div class="meta-grid">' + metaHtml + '</div>' +
        (function () {
          // 简介优先长文 description，enrich/各平台补的通常是 shortDescription（PC/模拟器详情页 2026-10-22 修复）
          var desc = game.description || game.shortDescription;
          return desc ? '<div class="a-desc" style="margin:10px 2px 0">' + esc(desc) + '</div>' : '';
        })() +
        phoneToggleHtml(game) +
        (function () {
          // 实机存档实拍（DS 卡带特例，2026-10-24）：数据自带 extra.proofImages 才显示
          var imgs = [];
          (game.platforms || []).forEach(function (p) {
            if (p.extra && Array.isArray(p.extra.proofImages)) imgs = imgs.concat(p.extra.proofImages);
          });
          if (!imgs.length) return '';
          return '<div class="section-title">实机存档实拍</div>' +
            '<div class="proof-grid">' + imgs.map(function (src) {
              return '<img class="proof-img" src="' + esc(src) + '" loading="lazy" alt="实机存档实拍（点开看大图）">';
            }).join('') + '</div>';
        })() +
        '<div class="section-title">' + esc(gameSourceLabel(game) || '平台') + ' 原始数据（按该平台自己的字段展示）</div>' +
        pcards +
        (showAch ? '<div class="section-title">成就列表（' + achCountText(a.achUnlocked, a.achTotal) + '）</div>' + achBlockHtml : '') +
        gameCalendarSection(game) +
      '</div>';

    function close() {
      if (mask.parentNode) { mask.parentNode.removeChild(mask); }
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelector('.modal-close').addEventListener('click', close);
    var phBtn = mask.querySelector('#ph-vis-btn');
    if (phBtn) phBtn.addEventListener('click', function () { togglePhoneVisible(game, mask); });
    [].forEach.call(mask.querySelectorAll('.ph-cat-btn'), function (b) {
      b.addEventListener('click', function () { setPhoneCategory(game, b.getAttribute('data-ph-cat'), mask); });
    });
    document.addEventListener('keydown', onKey);
    window.__closeModal = close;
    document.body.appendChild(mask);
    localizeIcons(mask, game);
    lazyLoadXboxAchievements(mask, game);
    lazyLoadRaDetail(mask, game);
    bindAchLightbox(mask);
    // 实机存档实拍：点开大图（复用成就灯箱）
    [].forEach.call(mask.querySelectorAll('.proof-img'), function (img) {
      img.addEventListener('click', function () { openLightbox(img.src, '实机存档实拍'); });
    });
  }

  /**
   * 成就大图浮层：点击成就徽章，把同一张图（微软官方 CDN 原图，分辨率很高）
   * 放大显示在当前页面中央；点 ×、点空白处或按 Esc 关闭。
   */
  function openLightbox(src, title) {
    var lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML =
      '<div class="lightbox-body">' +
        '<button class="modal-close" aria-label="关闭">×</button>' +
        '<img src="' + esc(src) + '" alt="">' +
        (title ? '<div class="lightbox-title">' + esc(title) + '</div>' : '') +
      '</div>';
    function close() {
      if (lb.parentNode) { lb.parentNode.removeChild(lb); }
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    lb.querySelector('.modal-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(lb);
  }

  /** 给详情弹层里每个成就图绑「点击看大图」（图标可能在本地化后才有 src，点击时才取）。
   * 两种形态都支持：Steam 的 .badge 和 Xbox 大卡片的 .xach-img。 */
  function bindAchLightbox(mask) {
    [].forEach.call(mask.querySelectorAll('.ach-item .badge, .xach-card .xach-img'), function (badge) {
      badge.classList.add('zoomable');
      badge.addEventListener('click', function () {
        var img = badge.querySelector('img');
        if (!img) return;                     // 没图的成就（只有 ★ 占位）不弹
        var card = badge.closest('.ach-item, .xach-card');
        var name = card && (card.querySelector('.a-name') || card.querySelector('.xach-name'));
        openLightbox(img.src, name ? name.textContent : '');
      });
    });
  }

  /**
   * Xbox 成就按需加载：标题历史里只有「数量」，没有明细。
   * 打开某款游戏详情时才去拉它的成就列表，拿到后刷新弹层（每款只拉一次）。
   */
  function lazyLoadXboxAchievements(mask, game) {
    var xbox = null;
    game.platforms.forEach(function (p) {
      if (p.platform === 'xbox' && p.externalId && !p.__achLoaded) { xbox = p; }
    });
    if (!xbox) return;
    xbox.__achLoaded = true;              // 标记，避免重复/循环刷新
    // 线上只读版：成就明细由发布脚本从本地缓存打包成 data_xbox_ach.js（window.GAME_XBOX_ACH）
    var st = window.GAME_XBOX_ACH && window.GAME_XBOX_ACH[String(xbox.externalId)];
    if (st && st.items && st.items.length) {
      xbox.achievements.items = st.items;
      xbox.achievements.total = st.items.length;
      xbox.achievements.unlocked = st.items.filter(function (i) { return !!i.unlockedAt; }).length;
      if (window.__closeModal) window.__closeModal();
      openDetail(game);                   // 重新渲染
      return;
    }
    fetch('/api/xbox/achievements?titleId=' + encodeURIComponent(xbox.externalId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.items || !d.items.length) return;
        xbox.achievements.items = d.items;
        xbox.achievements.total = d.items.length;
        xbox.achievements.unlocked = d.items.filter(function (i) { return !!i.unlockedAt; }).length;
        if (window.__closeModal) window.__closeModal();
        openDetail(game);                 // 重新渲染（此时 __achLoaded 已为 true，不会再触发）
      })
      .catch(function () { /* 静默失败：详情页仍显示数量 */ });
  }

  /**
   * RetroAchievements 按需补全：打开某款 RA 游戏详情时才发那 1 个请求。
   * 一次拿回：成就明细（含图标）+ 游玩时长 + 发售日 / 开发商 / 发行商 / 类型。
   * 结果存在本地，所以每款游戏一生只打扰 RA 一次（配合导入页的「补全全部」可以先跑完）。
   */
  function lazyLoadRaDetail(mask, game) {
    var p = null;
    game.platforms.forEach(function (x) {
      if (String(x.platform).indexOf('ra-') === 0 && x.externalId && !x.__raLoaded) p = x;
    });
    if (!p) return;
    p.achievements = p.achievements || { total: 0, unlocked: 0, items: [] };
    // 明细和时长都已经有了 → 不用再拉
    if ((p.achievements.items || []).length && p.totalMinutes) return;
    p.__raLoaded = true;                 // 标记，避免重复请求 / 循环重渲染
    fetch('/api/ra/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: p.externalId }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.game) return;
        var info = d.game;
        if (info.items && info.items.length) {
          p.achievements.items = info.items;
          p.achievements.total = info.items.length;
          p.achievements.unlocked = info.items.filter(function (i) { return !!i.unlockedAt; }).length;
        }
        if (d.playtimeMinutes) p.totalMinutes = d.playtimeMinutes;
        if (info.releaseDate) game.releaseDate = info.releaseDate;
        if (info.developer) game.developer = info.developer;
        if (info.publisher) game.publisher = info.publisher;
        if (info.genre) {
          game.genres = String(info.genre).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        }
        if (p.extra && info.completion != null) p.extra.percent = Math.round(Number(info.completion));
        if (window.__closeModal) window.__closeModal();
        openDetail(game);                // 重新渲染（此时 __raLoaded 已为 true，不会再触发）
      })
      .catch(function () { /* 静默失败：详情页仍显示原有的数量与时长 */ });
  }

  /**
   * 成就图标「按需本地化」：打开详情时才向后端要这一款游戏的图标（下载一次，之后全走本地）。
   * 非 Steam 平台或请求失败时，退回直接加载远程地址（加载失败由 onerror 移除，露出色块）。
   */
  function localizeIcons(mask, game) {
    if (window.GH_STATIC) return;   // 线上只读版：图标已由补齐任务本地化，不再请求服务端
    var imgs = mask.querySelectorAll('img.pending');
    if (!imgs.length) return;
    var fallback = function () {
      [].forEach.call(imgs, function (im) {
        im.className = '';
        im.src = im.getAttribute('data-remote');
        im.onerror = function () { im.remove(); };
      });
    };
    var steam = null, xbox = null;
    game.platforms.forEach(function (p) {
      if (p.platform === 'steam' && p.externalId) steam = p;
      if (p.platform === 'xbox' && p.externalId) xbox = p;
    });

    /** 把「成就名/成就id -> 本地路径」的映射应用到图片上，并同步回内存数据 */
    function applyMap(map, play) {
      [].forEach.call(imgs, function (im) {
        var key = im.getAttribute('data-ach');
        var local = map[key] || map[String(key)];
        if (local && play) {
          (play.achievements.items || []).forEach(function (it) {
            if (String(it.id) === String(key)) it.iconUrl = local;   // 下次打开直接命中本地文件
          });
        }
        im.className = '';
        im.src = local || im.getAttribute('data-remote');
        im.onerror = function () { im.remove(); };
      });
    }

    if (steam) {
      fetch('/api/steam/icons?appid=' + encodeURIComponent(steam.externalId))
        .then(function (r) { return r.json(); })
        .then(function (d) { applyMap((d && d.ok && d.icons) || {}, steam); })
        .catch(fallback);
      return;
    }
    if (xbox) {
      // Xbox 也一样：图标下载到 assets/xbox/<titleId>/icons/，封面到 assets/covers/xbox/
      fetch('/api/xbox/icons?titleId=' + encodeURIComponent(xbox.externalId))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          applyMap((d && d.ok && d.icons) || {}, xbox);
          if (d && d.ok && d.cover) { game.cover = d.cover; }   // 封面也换成本地文件
        })
        .catch(fallback);
      return;
    }
    fallback();
  }

  /* ============================ 生涯页面 ============================ */

  /* ============================ 跨平台统一时间轴 ==============================
   * 用户 2026-10-19 明确：**不合并游戏身份**，只把各平台的游玩记录排到同一条时间轴上，
   * 同一天玩了什么，各平台并列列出来（Steam / Xbox / Nintendo / Retro 各归各的行）。
   *
   * 数据现实（必须诚实标注，不能假装精确）：
   *   - Nintendo：有按天记录 → 当天玩了多少分钟是**精确值**
   *   - Steam / Xbox / Retro：官方只给「最后游玩日期」 → 只知道这天**玩过**，
   *     当天具体多久**拿不到**，显示「—」并在悬停里说明原因。
   * ================================================================ */

  // 用户 2026-10-19：默认按月（这个月玩了哪些游戏），按天保留成切换项；封面参考游戏库放大
  var tlMode = 'month';         // 'month' | 'day' | 'first'
  var careerTlDays = 30;        // 按天视图已展开多少天
  var careerTlMonths = 6;       // 按月视图已展开多少个月
  var careerFirstYears = 1;     // 首次游玩视图：一次加载一年（用户 2026-10-19 定）
  var careerTlFilter = 'all';   // 平台筛选：all / steam / xbox / nintendo / retro…

  function unifiedTimeline() {
    var tl = {};
    (DATA.games || []).forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (isNintendoPlatform(p.platform)) {
          var arr = (window.NINTENDO_PLAY_DAYS || {})[p.externalId];
          if (!arr) return;
          for (var i = 0; i < arr.length; i++) {
            (tl[arr[i][0]] = tl[arr[i][0]] || []).push({ game: g, p: p, minutes: arr[i][1], exact: true });
          }
        } else if (p.lastPlayedAt) {
          var d = String(p.lastPlayedAt).slice(0, 10);
          (tl[d] = tl[d] || []).push({ game: g, p: p, minutes: null, exact: false });
        }
      });
    });
    return tl;
  }

  function tlMatchFilter(p) {
    if (careerTlFilter === 'all') return true;
    if (careerTlFilter === 'nintendo') return isNintendoPlatform(p.platform);
    if (careerTlFilter === 'retro') return isRaPlatform(p.platform);
    if (careerTlFilter === 'emu') return isEmuPlatform(p.platform);
    return p.platform === careerTlFilter;
  }

  /**
   * 按月聚合：把按天的记录归并到「年-月」，月内再按 游戏×平台 合并。
   * 任天堂多条按天记录 → 当月总分钟 + 玩过几天；其他平台仍只有「动过」一次。
   * 返回 [{ month:'2026-10', rows:[{game,p,minutes,days,exact,lastDate}] }]，月份倒序。
   */
  function monthGroups() {
    var tl = unifiedTimeline();
    var months = {};
    Object.keys(tl).forEach(function (d) {
      var rows = tl[d].filter(function (r) { return tlMatchFilter(r.p); });
      if (!rows.length) return;
      var m = d.slice(0, 7);
      var agg = months[m] = months[m] || {};
      rows.forEach(function (r) {
        var key = r.p.platform + '|' + String(r.p.externalId || '');
        var it = agg[key];
        if (!it) {
          it = agg[key] = { game: r.game, p: r.p, minutes: 0, days: 0, exact: false, lastDate: d };
        }
        if (r.exact) { it.exact = true; it.minutes += r.minutes || 0; it.days += 1; }
        if (d > it.lastDate) it.lastDate = d;
      });
    });
    return Object.keys(months).sort().reverse().map(function (m) {
      var list = Object.keys(months[m]).map(function (k) { return months[m][k]; });
      list.sort(function (a, b) { return (b.minutes || 0) - (a.minutes || 0); });
      return { month: m, rows: list };
    });
  }

  function tlRowHtml(r, minTxt) {
    var pl = getPlatform(r.p.platform);
    return '<div class="tl-row" data-ns-game="' + esc(String(r.p.externalId || '')) + '">' +
      '<img class="tl-cover" src="' + esc(r.game.cover || '') + '" alt="" loading="lazy">' +
      '<span class="tl-name">' + esc(r.game.title) + '</span>' +
      '<span class="p-tag tl-pl" style="background:' + pl.color + '">' + esc(pl.name) + '</span>' +
      '<span class="tl-min">' + minTxt + '</span>' +
      '</div>';
  }

  /** 月视图：某个月玩了哪些游戏（小黑盒式），默认视图 */
  function timelineMonthHtml() {
    var groups = monthGroups();
    if (!groups.length) return '<div class="a-desc">这个筛选下没有记录。</div>';
    var shown = groups.slice(0, careerTlMonths);

    var body = shown.map(function (mo) {
      var y = mo.month.slice(0, 4), mth = Number(mo.month.slice(5, 7));
      var known = mo.rows.filter(function (r) { return r.exact; })
        .reduce(function (s, r) { return s + r.minutes; }, 0);
      var head = '<div class="tl-date">' +
        '<span class="tl-d">' + y + ' 年 ' + mth + ' 月</span>' +
        '<span class="tl-sum">' + mo.rows.length + ' 款' +
          (known ? ' · 已知 ' + formatMinutes(known) + '（任天堂）' : '') + '</span>' +
        '</div>';
      var rows = mo.rows.map(function (r) {
        var minTxt = r.exact
          ? formatMinutes(r.minutes) + (r.days > 1 ? ' <i class="tl-days">玩过 ' + r.days + ' 天</i>' : '')
          : '<span class="tl-unknown" title="最后一次游玩：' + esc(r.lastDate) +
              '。这个平台只记录最后一次的时间点，没有历史">—</span>';
        return tlRowHtml(r, minTxt);
      }).join('');
      return '<div class="tl-day">' + head + rows + '</div>';
    }).join('');

    var more = (groups.length > shown.length)
      ? '<button class="src-btn tl-more" id="tl-more">再往前 6 个月（还有 ' + (groups.length - shown.length) + ' 个月）</button>'
      : '<div class="day-hint">已经到底了 —— 最早 ' + groups[groups.length - 1].month + '</div>';

    return '<div class="tl-note">每个月玩了哪些游戏（任天堂按月精确汇总；' +
      'Steam / Xbox / Retro 只知道那个月<b>碰过</b>哪些，时长官方不给，显示 —）。</div>' +
      body + more;
  }

  /**
   * 首次游玩视图（小黑盒同款，2026-10-19）：
   * 按「第一次玩这款游戏」的年月分组，每月一张卡片网格。
   * 硬前提：只有任天堂给 firstPlayedAt（226/226 全有），Steam/Xbox/Retro 官方没有这个字段，
   * 所以这个视图只含任天堂——绝不拿成就时间之类的去凑（用户已否决）。
   * 返回 [{ month:'2026-10', rows:[{game,p,minutes}] }]，月份倒序，月内按首次时间倒序。
   */
  function firstPlayGroups() {
    var months = {};
    (DATA.games || []).forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (!isNintendoPlatform(p.platform)) return;
        if (!p.firstPlayedAt) return;
        if (!tlMatchFilter(p)) return;
        var m = String(p.firstPlayedAt).slice(0, 7);
        (months[m] = months[m] || []).push({
          game: g, p: p,
          minutes: Number(p.totalMinutes) || 0,
          first: String(p.firstPlayedAt),
        });
      });
    });
    return Object.keys(months).sort().reverse().map(function (m) {
      var list = months[m];
      list.sort(function (a, b) { return a.first < b.first ? 1 : -1; });
      return { month: m, rows: list };
    });
  }

  /** 一张封面卡（首次游玩视图用）：右下角角标 = 首次游玩日期（2026-10-21 用户定，替换原来的时长角标） */
  function fcCardHtml(r) {
    var d = String(r.first || '');
    var dateTxt = d.length >= 10 ? (Number(d.slice(5, 7)) + '月' + Number(d.slice(8, 10)) + '日') : '';
    return '<div class="fc-card" data-ns-game="' + esc(String(r.p.externalId || '')) + '">' +
      '<div class="fc-imgwrap">' +
        '<img class="fc-img" src="' + esc(r.game.cover || '') + '" alt="" loading="lazy">' +
        '<span class="fc-min">' + esc(dateTxt) + '</span>' +
      '</div>' +
      '<span class="fc-name" title="' + esc(r.game.title) + '">' + esc(r.game.title) + '</span>' +
    '</div>';
  }

  /**
   * 首次游玩视图：按自然年加载，一次一年（用户 2026-10-19 定）。
   * 年内再按月分组——这样「这一年每个月都开了什么」一眼能看清。
   */
  function timelineFirstHtml() {
    var groups = firstPlayGroups();
    if (!groups.length) return '<div class="a-desc">这个筛选下没有首次游玩记录。</div>';

    // 月 → 年
    var byYear = {};
    groups.forEach(function (mo) {
      var y = mo.month.slice(0, 4);
      (byYear[y] = byYear[y] || []).push(mo);
    });
    var allYears = Object.keys(byYear).sort().reverse();
    var years = allYears.slice(0, careerFirstYears);
    var total = groups.reduce(function (s, g) { return s + g.rows.length; }, 0);

    var body = years.map(function (y) {
      var mos = byYear[y];
      var yCount = mos.reduce(function (s, m) { return s + m.rows.length; }, 0);
      var yMin = mos.reduce(function (s, m) {
        return s + m.rows.reduce(function (t, r) { return t + r.minutes; }, 0);
      }, 0);
      var head = '<div class="tl-year"><span class="tl-y">' + y + ' 年</span>' +
        '<span class="tl-sum">新玩 ' + yCount + ' 款 · 累计 ' + formatMinutes(yMin) + '</span></div>';
      var blocks = mos.map(function (mo) {
        var mth = Number(mo.month.slice(5, 7));
        return '<div class="tl-day">' +
          '<div class="tl-date"><span class="tl-d">' + mth + ' 月</span>' +
            '<span class="tl-sum">第一次玩了 ' + mo.rows.length + ' 款</span></div>' +
          '<div class="fc-grid">' + mo.rows.map(fcCardHtml).join('') + '</div>' +
        '</div>';
      }).join('');
      return '<div class="tl-yearblock">' + head + blocks + '</div>';
    }).join('');

    var left = allYears.length - years.length;
    var more = left > 0
      ? '<button class="src-btn tl-more" id="tl-more">再往前一年（还有 ' + left + ' 年，共 ' + total + ' 款）</button>'
      : '<div class="day-hint">已经到底了 —— 最早 ' + allYears[allYears.length - 1] + ' 年（你的任天堂入坑年）</div>';

    return '<div class="tl-note">按<b>第一次玩这款游戏</b>的时间排（小黑盒同款），<b>一次加载一年</b>，年内再按月分开。' +
        '<b>只有任天堂提供首次游玩时间</b>（226 款全有），Steam / Xbox / Retro 官方没有这个字段，' +
        '所以这个视图只含任天堂 —— 也不用成就时间去凑。卡片右下角是这款游戏的<b>首次游玩日期</b>。</div>' +
      '<div class="tl-bar"><button class="src-btn" id="share-growth">生成分享成长图</button>' +
        '<span class="tl-lb">把任天堂的入坑轨迹做成一张竖图存下来</span></div>' +
      body + more;
  }

  /* ============ 分享成长图（2026-10-19，首次游玩模块的衍生功能） ============
   * 把任天堂的入坑轨迹画成一张竖图，可以存下来分享。
   * 关键约束：canvas 画外链 CDN 图会跨域污染、导出失败 —— 所以封面必须先用
   * /api/nintendo/covers 落到本地 assets/covers/nintendo/ 再画（同源才干净）。
   * 只有任天堂有首次游玩时间，所以这张图只讲任天堂，不掺其他平台。
   */
  var growthPosterUrl = null;

  function growthData() {
    var rows = [];
    (DATA.games || []).forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (!isNintendoPlatform(p.platform)) return;
        if (!p.firstPlayedAt) return;
        rows.push({ game: g, p: p, minutes: Number(p.totalMinutes) || 0, first: String(p.firstPlayedAt) });
      });
    });
    rows.sort(function (a, b) { return b.minutes - a.minutes; });
    var firsts = rows.map(function (r) { return r.first; }).sort();
    var byYear = {};
    rows.forEach(function (r) {
      var y = r.first.slice(0, 4);
      byYear[y] = (byYear[y] || 0) + 1;
    });
    // 成长图主拼图 = 「今年新玩的游戏」全部列出（用户 2026-10-19：截图到 6 月就有丢失，
    // 原来只取时长前 15 不对）→ 不截断，按首玩时间新→旧排，画图时再按月分组
    var nowY = String(new Date().getFullYear());
    var yearRows = rows.filter(function (r) { return r.first.slice(0, 4) === nowY; })
      .sort(function (a, b) { return a.first < b.first ? 1 : -1; });
    return {
      rows: rows,
      count: rows.length,
      totalMinutes: rows.reduce(function (s, r) { return s + r.minutes; }, 0),
      firstDay: firsts.length ? firsts[0] : null,
      top: rows.slice(0, 12),
      year: nowY,
      yearTop: yearRows,
      yearCount: yearRows.length,
      yearMinutes: yearRows.reduce(function (s, r) { return s + r.minutes; }, 0),
      byYear: byYear,
    };
  }

  function gpRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 文字太长就截断加省略号（canvas 没有 CSS 的 ellipsis） */
  function gpFit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function gpLoadImg(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('图片加载失败')); };
      im.src = src;
    });
  }

  function drawGrowthPoster(d, imgs) {
    var W = 750;
    // 拼图主体 = 今年新玩（全部，不截断），按月分组；今年没玩就退回「玩得最多」
    var grid = d.yearTop && d.yearTop.length ? d.yearTop : d.top;
    var gridTitle = d.yearTop && d.yearTop.length ? ('今年玩的游戏 · ' + d.year) : '玩得最多的游戏';
    var byMonth = null;
    if (d.yearTop && d.yearTop.length) {
      byMonth = {};
      grid.forEach(function (r) {
        var m = r.first.slice(5, 7);
        (byMonth[m] = byMonth[m] || []).push(r);
      });
    }
    var segs = byMonth
      ? Object.keys(byMonth).sort().reverse().map(function (m) {
          return { label: Number(m) + ' 月 · 新玩 ' + byMonth[m].length + ' 款', rows: byMonth[m] };
        })
      : [{ label: '', rows: grid }];
    // 高度 = 头部 452 + 每组（月标题 34 + 行数×232 + 组间距 12）+ 底部 110
    var H = 452 + 110;
    segs.forEach(function (seg) {
      H += (seg.label ? 34 : 0) + Math.ceil(seg.rows.length / 3) * 232 + 12;
    });
    var cv = document.createElement('canvas');
    cv.width = W * 2; cv.height = H * 2;
    var c = cv.getContext('2d');
    c.scale(2, 2);
    var F = '"Microsoft YaHei","PingFang SC",sans-serif';

    // 底色
    c.fillStyle = '#f7f8fa';
    c.fillRect(0, 0, W, H);

    // 顶部红条 + 标题（任天堂红）
    c.fillStyle = '#e60012';
    c.fillRect(0, 0, W, 8);
    c.fillStyle = '#111318';
    c.font = '600 34px ' + F;
    c.fillText('我的任天堂成长图', 40, 78);
    if (d.firstDay) {
      c.fillStyle = '#6b7280';
      c.font = '20px ' + F;
      var y0 = Number(d.firstDay.slice(0, 4)), m0 = Number(d.firstDay.slice(5, 7));
      var now = new Date();
      var months = (now.getFullYear() - y0) * 12 + (now.getMonth() + 1 - m0);
      c.fillText('入坑于 ' + d.firstDay.slice(0, 10).replace(/-/g, '.') +
        '　·　至今 ' + Math.floor(months / 12) + ' 年 ' + (months % 12) + ' 个月', 40, 116);
    }

    // 三个大数字
    var stats = [
      { v: String(d.count), l: '款游戏' },
      { v: Math.round(d.totalMinutes / 60).toLocaleString('en-US'), l: '小时' },
      { v: String(Object.keys(d.byYear).length), l: '个年份' },
    ];
    stats.forEach(function (s, i) {
      var x = 40 + i * 232;
      c.fillStyle = '#ffffff';
      gpRoundRect(c, x, 140, 212, 96, 14);
      c.fill();
      c.fillStyle = '#e60012';
      c.font = '600 38px ' + F;
      c.fillText(s.v, x + 20, 190);
      c.fillStyle = '#6b7280';
      c.font = '18px ' + F;
      c.fillText(s.l, x + 20, 220);
    });

    // 入坑年份分布
    var years = Object.keys(d.byYear).sort();
    var maxY = Math.max.apply(null, years.map(function (y) { return d.byYear[y]; }));
    c.fillStyle = '#111318';
    c.font = '600 22px ' + F;
    c.fillText('每年新开了几款', 40, 288);
    var bw = Math.min(52, (W - 80) / years.length);
    years.forEach(function (y, i) {
      var x = 40 + i * bw;
      var h = Math.max(4, Math.round(d.byYear[y] / maxY * 92));
      c.fillStyle = '#e60012';
      gpRoundRect(c, x + 2, 388 - h, bw - 6, h, 3);
      c.fill();
      if (i % 2 === 0 || years.length <= 8) {
        c.fillStyle = '#9aa1ac';
        c.font = '13px ' + F;
        c.fillText(y.slice(2), x, 410);
      }
    });

    // 拼图区：今年新玩按月分组（一行 3 个），imgs 与 buildGrowthPoster 的 grid 顺序一致
    var gy = 452;
    c.fillStyle = '#111318';
    c.font = '600 22px ' + F;
    c.fillText(gridTitle, 40, gy - 14);

    var yy = gy;
    var gi = 0;
    segs.forEach(function (seg) {
      if (seg.label) {
        c.fillStyle = '#e60012';
        c.font = '600 18px ' + F;
        c.fillText(seg.label, 40, yy + 6);
        yy += 34;
      }
      seg.rows.forEach(function (r, i) {
        var x = 40 + (i % 3) * 224, y = yy + Math.floor(i / 3) * 232;
        var im = imgs[gi++];
        c.save();
        gpRoundRect(c, x, y, 200, 200, 12);
        c.clip();
        if (im) {
          c.drawImage(im, x, y, 200, 200);
        } else {
          // 没封面就用平台色块 + 首字母兜底，不留白洞
          c.fillStyle = '#e8eaef';
          c.fillRect(x, y, 200, 200);
          c.fillStyle = '#e60012';
          c.font = '600 60px ' + F;
          c.fillText(String(r.game.title || '?').slice(0, 1), x + 78, y + 120);
        }
        c.restore();
        // 时长角标
        c.fillStyle = 'rgba(0,0,0,.62)';
        gpRoundRect(c, x + 130, y + 166, 62, 26, 6);
        c.fill();
        c.fillStyle = '#fff';
        c.font = '15px ' + F;
        c.fillText(Math.round(r.minutes / 60) + ' h', x + 141, y + 184);
        // 名字（月份已在分组标题里，不重复标）
        c.fillStyle = '#111318';
        c.font = '15px ' + F;
        c.fillText(gpFit(c, r.game.title, 200), x, y + 222);
      });
      yy += Math.ceil(seg.rows.length / 3) * 232 + 12;
    });

    // 底部
    c.fillStyle = '#9aa1ac';
    c.font = '15px ' + F;
    c.fillText('生成于 ' + new Date().toLocaleDateString('zh-CN') + '　·　本地聚合游戏平台 · 数据来自 Nintendo 官方接口', 40, H - 34);

    // 弹出展示 + 下载
    var url = cv.toDataURL('image/png');
    growthPosterUrl = url;
    var box = document.createElement('div');
    box.id = 'growth-poster';
    box.className = 'gp-modal';
    box.innerHTML = '<div class="gp-panel">' +
      '<div class="gp-head"><span>分享成长图</span><button class="gp-x" id="gp-close">×</button></div>' +
      '<img class="gp-img" src="' + url + '" alt="成长图">' +
      '<div class="gp-foot"><button class="src-btn" id="gp-download">下载图片</button>' +
        '<span class="tl-lb">右键图片也可以「另存为」</span></div>' +
      '</div>';
    document.body.appendChild(box);
  }

  function buildGrowthPoster() {
    var btn = document.getElementById('share-growth');
    if (btn) { btn.disabled = true; btn.textContent = '正在准备封面…'; }
    var d = growthData();
    if (!d.count) { if (btn) { btn.disabled = false; btn.textContent = '生成分享成长图'; } return; }
    // 拼图列表要和 drawGrowthPoster 里选的一致：优先今年新玩，空则退回玩得最多
    var grid = d.yearTop && d.yearTop.length ? d.yearTop : d.top;
    var items = grid.map(function (r) {
      return { titleId: String(r.p.externalId || ''), url: r.game.cover || '' };
    }).filter(function (x) { return x.titleId && x.url; });

    fetch('/api/nintendo/covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items }),
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        var map = (j && j.map) || {};
        var jobs = grid.map(function (r) {
          var tid = String(r.p.externalId || '');
          // 只用「已落到本地」的封面：外链 CDN 图会污染 canvas，导出必失败 → 宁可画色块
          var src = map[tid] || '';
          return src ? gpLoadImg(src).catch(function () { return null; }) : Promise.resolve(null);
        });
        return Promise.all(jobs).then(function (imgs) { drawGrowthPoster(d, imgs); });
      })
      .catch(function (e) { alert('生成失败：' + (e && e.message ? e.message : e)); })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = '生成分享成长图'; }
      });
  }

  function downloadGrowthPoster() {
    if (!growthPosterUrl) return;
    var a = document.createElement('a');
    a.href = growthPosterUrl;
    a.download = '任天堂成长图-' + new Date().toISOString().slice(0, 10) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function timelineHtml() {
    if (tlMode === 'first') return timelineFirstHtml();
    if (tlMode === 'month') return timelineMonthHtml();
    var tl = unifiedTimeline();
    var days = Object.keys(tl).sort().reverse();
    var shown = [], kept = 0;
    for (var i = 0; i < days.length && kept < careerTlDays; i++) {
      var rows = tl[days[i]].filter(function (r) { return tlMatchFilter(r.p); });
      if (!rows.length) continue;
      rows.sort(function (a, b) { return (b.minutes || 0) - (a.minutes || 0); });
      shown.push({ date: days[i], rows: rows });
      kept += 1;
    }
    // 有记录的总天数（筛选后）
    var totalDays = days.filter(function (d) {
      return tl[d].some(function (r) { return tlMatchFilter(r.p); });
    }).length;

    if (!shown.length) return '<div class="a-desc">这个筛选下没有记录。</div>';

    var W = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var body = shown.map(function (day) {
      var known = day.rows.filter(function (r) { return r.exact; })
        .reduce(function (s, r) { return s + r.minutes; }, 0);
      var dt = new Date(day.date + 'T00:00:00');
      var head = '<div class="tl-date">' +
        '<span class="tl-d">' + esc(day.date) + '</span>' +
        '<span class="tl-w">' + (W[dt.getDay()] || '') + '</span>' +
        '<span class="tl-sum">' + day.rows.length + ' 款' +
          (known ? ' · 已知 ' + formatMinutes(known) : '') + '</span>' +
        '</div>';
      var rows = day.rows.map(function (r) {
        var minTxt = r.exact ? formatMinutes(r.minutes)
          : '<span class="tl-unknown" title="最后一次游玩：' + esc(day.date) +
            '。这个平台只记录最后一次的时间点，没有历史，也不给当天时长">—</span>';
        return tlRowHtml(r, minTxt);
      }).join('');
      return '<div class="tl-day">' + head + rows + '</div>';
    }).join('');

    var more = (kept < totalDays)
      ? '<button class="src-btn tl-more" id="tl-more">再往前 30 天（还有 ' + (totalDays - kept) + ' 天）</button>'
      : '<div class="day-hint">已经到底了 —— 最早 ' + days[days.length - 1] + '</div>';

    return '<div class="tl-note">任天堂按天记录，<b>精确到分钟、有完整历史</b>；' +
      'Steam / Xbox / Retro 官方只给<b>最后一次游玩</b>的时间点 —— 这些平台的游戏在时间轴上只会<b>出现一次</b>' +
      '（就是它最后一次玩的那天），当天时长官方不给，显示 — 。</div>' +
      body + more;
  }

  /* ============ 最近在玩（2026-10-19 加） ============
   * 和上面的「游玩时间轴」互补，不重复：
   *   时间轴   —— 按天看：某一天玩了什么。
   *   最近在玩 —— 按游戏看：哪些游戏最近还在碰，各碰了多少。
   *
   * 三档数据源，界面上如实标注，绝不混为一谈：
   *   ① 任天堂：有完整按天历史 → 能算出「最近 N 天玩了几天、共多久」，精确到分钟。
   *     新账号刚绑定、226 款按天记录还没跑完时，回退到官方 NINTENDO_RECENT
   *     （清单接口本来就带，最近几个有玩的日子，一个额外请求都不用发）。
   *   ② Steam / Xbox / Retro：官方只给「最后一次游玩」的时间点 → 只能判断最近有没有碰过，
   *     给不出「最近 N 天玩了多久」。
   */

  // 用户 2026-10-19 拍板：只看最近 7 天，更早的去「游玩时间轴 / 时长排行」看
  var rpDays = 7;
  var rpFilter = 'all';     // 平台筛选

  function rpMatchFilter(p) {
    if (rpFilter === 'all') return true;
    if (rpFilter === 'nintendo') return isNintendoPlatform(p.platform);
    if (rpFilter === 'retro') return isRaPlatform(p.platform);
    if (rpFilter === 'emu') return isEmuPlatform(p.platform);
    return p.platform === rpFilter;
  }

  /** 官方「最近游玩」兜底：按 titleId 找它最近一次出现在哪天、玩了多久 */
  function nintendoRecentFallback(externalId) {
    var arr = window.NINTENDO_RECENT || [];
    for (var i = 0; i < arr.length; i++) {
      var gs = arr[i].games || [];
      for (var j = 0; j < gs.length; j++) {
        if (String(gs[j].titleId) === String(externalId)) {
          return { date: arr[i].date, minutes: Number(gs[j].minutes) || 0 };
        }
      }
    }
    return null;
  }

  /** 相对时间：今天 / 昨天 / N 天前 / N 周前 / N 个月前 */
  function agoText(dateKey) {
    var base = new Date(); base.setHours(0, 0, 0, 0);
    var d = new Date(dateKey + 'T00:00:00');
    var diff = Math.round((base.getTime() - d.getTime()) / 86400000);
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 7) return diff + ' 天前';
    if (diff < 30) return Math.floor(diff / 7) + ' 周前';
    if (diff < 365) return Math.floor(diff / 30) + ' 个月前';
    return Math.floor(diff / 365) + ' 年前';
  }

  /**
   * 汇总「最近还在玩的游戏」，按最后一次游玩时间倒序。
   * 一条记录 = 一款游戏在某个平台上的游玩（不合并身份，和全站规则一致）。
   */
  function recentPlayingList() {
    var base = new Date(); base.setHours(0, 0, 0, 0);
    var since = base.getTime() - (rpDays - 1) * 86400000;   // 含今天
    var out = [];
    (DATA.games || []).forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (!rpMatchFilter(p)) return;
        var rec = {
          game: g, p: p,
          lastDate: null,        // 最后一次游玩的日期
          lastMinutes: null,     // 最后一次玩了多久（只有任天堂有）
          days: 0, minutes: 0,   // 最近 N 天内的游玩天数 / 总分钟（只有任天堂有）
          exact: false,          // true = 有按天历史，能给出上面两项
          fromRecent: false,     // true = 用的是官方 recentPlayHistories 兜底
        };

        if (isNintendoPlatform(p.platform)) {
          var arr = (window.NINTENDO_PLAY_DAYS || {})[p.externalId];
          if (arr && arr.length) {
            rec.exact = true;
            rec.lastDate = arr[0][0];               // 已按日期倒序
            rec.lastMinutes = Number(arr[0][1]) || 0;
            for (var i = 0; i < arr.length; i++) {
              if (new Date(arr[i][0] + 'T00:00:00').getTime() >= since) {
                rec.days += 1;
                rec.minutes += Number(arr[i][1]) || 0;
              }
            }
          } else {
            var fb = nintendoRecentFallback(p.externalId);
            if (fb) {
              rec.exact = true; rec.fromRecent = true;
              rec.lastDate = fb.date; rec.lastMinutes = fb.minutes;
              rec.days = 1; rec.minutes = fb.minutes;
            }
          }
        }

        // Steam 额外有「近两周时长」：不知道具体哪天，但能判断最近确实在玩
        var w2 = (p.extra && Number(p.extra.playtime2Weeks)) || 0;
        if (w2 > 0) rec.twoWeeks = w2;

        // 其他平台：只有最后一次游玩的时间点
        if (!rec.lastDate && p.lastPlayedAt) rec.lastDate = String(p.lastPlayedAt).slice(0, 10);
        if (!rec.lastDate) return;
        if (new Date(rec.lastDate + 'T00:00:00').getTime() < since) return;   // 超出范围

        out.push(rec);
      });
    });

    out.sort(function (a, b) {
      if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
      return (b.minutes || 0) - (a.minutes || 0);
    });
    return out;
  }

  function recentPlayingHtml() {
    var rows = recentPlayingList();
    if (!rows.length) {
      return '<div class="a-desc">最近 ' + rpDays + ' 天没有游玩记录。' +
        '（任天堂有完整按天历史；其他平台只记「最后一次游玩」，最后一次玩得早就进不了这个列表）</div>';
    }

    var cards = rows.map(function (r) {
      var pl = getPlatform(r.p.platform);
      var stat;
      if (r.exact) {
        stat = '<span class="rp-stat">最近 ' + rpDays + ' 天玩了 <b>' + r.days + '</b> 天 · <b>' +
          formatMinutes(r.minutes) + '</b>' +
          (r.fromRecent ? ' <i title="按天记录还没跑完，先用任天堂官方的最近游玩数据">（官方最近游玩）</i>' : '') + '</span>';
      } else if (r.twoWeeks) {
        // Steam 的近两周时长：有量，但官方不给具体是哪天玩的
        stat = '<span class="rp-stat">近两周 <b>' + formatMinutes(r.twoWeeks) + '</b>' +
          ' <i title="Steam 只给近两周的总时长，不给具体哪天玩了多久">（不分天）</i></span>';
      } else {
        stat = '<span class="rp-stat dim" title="这个平台只记录最后一次游玩的时间点，没有历史，也给不出最近累计时长">只知最后游玩时间</span>';
      }

      return '<div class="rp-card" data-ns-game="' + esc(String(r.p.externalId || '')) + '">' +
        '<img class="rp-cover" src="' + esc(r.game.cover || '') + '" alt="" loading="lazy">' +
        '<div class="rp-body">' +
          '<div class="rp-name" title="' + esc(r.game.title) + '">' + esc(r.game.title) + '</div>' +
          '<div class="rp-meta">' +
            '<span class="p-tag rp-pl" style="background:' + pl.color + '">' + esc(pl.name) + '</span>' +
            '<span class="rp-when">' + esc(r.lastDate) + ' · ' + esc(agoText(r.lastDate)) + '</span>' +
            stat +
            '<span class="rp-stat dim">本平台累计 ' + formatMinutes(r.p.totalMinutes || 0) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var nExact = rows.filter(function (r) { return r.exact; }).length;
    var n2w = rows.filter(function (r) { return r.twoWeeks; }).length;
    // 「玩得最多」：任天堂有精确值就用它，Steam 只有近两周总时长也能比
    var hot = rows.slice().sort(function (a, b) {
      return (b.minutes || b.twoWeeks || 0) - (a.minutes || a.twoWeeks || 0);
    })[0];
    var hotMin = hot ? (hot.minutes || hot.twoWeeks || 0) : 0;

    return '<div class="tl-note">最近 ' + rpDays + ' 天里有 <b>' + rows.length + '</b> 款游戏动过，' +
        '按最后一次游玩时间倒序。其中 <b>' + nExact + '</b> 款来自任天堂，有完整按天历史，' +
        '能算出这几天玩了几天、共多久' +
        (n2w ? '；Steam 另有 <b>' + n2w + '</b> 款能给出「近两周总时长」（但不分天）' : '') +
        '；其余平台官方只给最后一次的时间点。' +
      (hot && hotMin ? ' 这几天玩得最多的是 <b>' + esc(hot.game.title) + '</b>（' + formatMinutes(hotMin) + '）。' : '') +
        ' 更早的记录看下面的<b>游玩时间轴</b>和<b>时长排行</b>。</div>' +
      '<div class="rp-grid">' + cards + '</div>';
  }

  function recentPlayingPanel() {
    return '<div class="panel" id="panel-recent"><h3>最近在玩 · 最近 7 天</h3>' +
      '<div class="tl-bar">' +
        '<span class="tl-lb">只看</span>' +
        '<select class="year-select" id="rp-filter">' + tlFilterOpts(rpFilter) + '</select>' +
      '</div>' +
      '<div id="rp-box">' + recentPlayingHtml() + '</div>' +
    '</div>';
  }

  function refreshRecentPlaying() {
    var box = document.getElementById('rp-box');
    if (box) box.innerHTML = recentPlayingHtml();
  }

  /* ============ Top 游戏排行（2026-10-19 商量后拍板） ============
   * 御三家年度总结里唯一我们数据完全支持的核心模块。
   * 铁律不变：每行 = 游戏 × 平台，同名游戏不合并（Fortnite 出两行各标平台）；
   * 0 时长的游戏不进榜（Xbox 有 86 款只有日期没有时长）。
   */
  var topFilter = 'all';
  var topLimit = 20;        // 先展示 20，可展开到 50

  function topMatchFilter(p) {
    if (topFilter === 'all') return true;
    if (topFilter === 'nintendo') return isNintendoPlatform(p.platform);
    if (topFilter === 'retro') return isRaPlatform(p.platform);
    if (topFilter === 'emu') return isEmuPlatform(p.platform);
    return p.platform === topFilter;
  }

  /** 榜单：[{ game, p, minutes }]，按时长降序 */
  function topGamesList() {
    var out = [];
    (DATA.games || []).forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (!topMatchFilter(p)) return;
        var m = Number(p.totalMinutes) || 0;
        if (m <= 0) return;                        // 没时长的没有排名意义
        out.push({ game: g, p: p, minutes: m });
      });
    });
    out.sort(function (a, b) { return b.minutes - a.minutes; });
    return out;
  }

  function topHtml() {
    var rows = topGamesList();
    if (!rows.length) return '<div class="a-desc">这个筛选下没有带时长的游戏。</div>';
    var shown = rows.slice(0, topLimit);
    var max = shown[0].minutes;
    var totalAll = rows.reduce(function (s, r) { return s + r.minutes; }, 0);
    var topSum = shown.reduce(function (s, r) { return s + r.minutes; }, 0);

    var lis = shown.map(function (r, i) {
      var pl = getPlatform(r.p.platform);
      var pct = Math.max(2, Math.round(r.minutes / max * 100));
      return '<div class="top-row" data-ns-game="' + esc(String(r.p.externalId || '')) + '">' +
        '<span class="top-rank' + (i < 3 ? ' t' + (i + 1) : '') + '">' + (i + 1) + '</span>' +
        '<img class="top-cover" src="' + esc(r.game.cover || '') + '" alt="" loading="lazy">' +
        '<div class="top-main">' +
          '<div class="top-line">' +
            '<span class="top-name" title="' + esc(r.game.title) + '">' + esc(r.game.title) + '</span>' +
            '<span class="p-tag top-pl" style="background:' + pl.color + '">' + esc(pl.name) + '</span>' +
            '<span class="top-min">' + formatMinutes(r.minutes) + '</span>' +
          '</div>' +
          '<div class="top-track"><div class="top-fill" style="width:' + pct + '%;background:' + pl.color + '"></div></div>' +
        '</div>' +
      '</div>';
    }).join('');

    var more = (rows.length > topLimit && topLimit < 50)
      ? '<button class="src-btn tl-more" id="top-more">展开到 Top 50（榜外还有 ' + Math.min(rows.length - topLimit, 50 - topLimit) + ' 款）</button>'
      : (topLimit >= 50 ? '<div class="day-hint">已展示 Top 50</div>' : '');

    return '<div class="tl-note">共 <b>' + rows.length + '</b> 款有记录时长，榜单前 ' + shown.length +
        ' 款占了全部时长的 <b>' + Math.round(topSum / totalAll * 100) + '%</b>。' +
        '每行 = 游戏 × 平台，<b>同名游戏不合并</b>（如 Fortnite 各平台各占一行）。</div>' +
      lis + more;
  }

  function topPanel() {
    return '<div class="panel" id="panel-top"><h3>游戏时长排行</h3>' +
      '<div class="tl-bar">' +
        '<span class="tl-lb">只看</span>' +
        '<select class="year-select" id="top-filter">' + tlFilterOpts(topFilter) + '</select>' +
      '</div>' +
      '<div id="top-box">' + topHtml() + '</div>' +
    '</div>';
  }

  function refreshTop() {
    var box = document.getElementById('top-box');
    if (box) box.innerHTML = topHtml();
  }

  /* ---- 生涯页左侧目录（2026-10-19：面板多了要能跳、滚动时高亮当前面板） ---- */
  var CAREER_NAV = [
    { id: 'panel-recent',   name: '最近在玩' },
    { id: 'panel-top',      name: '时长排行' },
    { id: 'panel-year',     name: '年度统计' },
    { id: 'panel-timeline', name: '游玩时间轴' },
    { id: 'panel-dist',     name: '平台分布' },
  ];

  function careerNavHtml() {
    return '<div class="cn-title">本页内容</div>' +
      CAREER_NAV.map(function (n) {
        return '<div class="cn-item" data-panel="' + esc(n.id) + '">' + esc(n.name) + '</div>';
      }).join('');
  }

  function bindCareerNav() {
    var nav = document.getElementById('career-nav');
    if (!nav) return;
    [].forEach.call(nav.querySelectorAll('[data-panel]'), function (it) {
      it.addEventListener('click', function () {
        var target = document.getElementById(it.getAttribute('data-panel'));
        if (!target) return;
        var y = target.getBoundingClientRect().top + window.pageYOffset - 12;
        window.scrollTo({ top: y, behavior: 'smooth' });
      });
    });
    // 用赋值而不是 addEventListener：每次重绘只保留一个监听，不会越绑越多
    window.onscroll = careerNavSpy;
    careerNavSpy();
  }

  /** 滚动时把「当前正在看的面板」在左侧高亮出来 */
  function careerNavSpy() {
    var nav = document.getElementById('career-nav');
    if (!nav || currentPage !== 'career') return;
    var items = [].slice.call(nav.querySelectorAll('[data-panel]'));
    var best = items[0];
    items.forEach(function (it) {
      var p = document.getElementById(it.getAttribute('data-panel'));
      if (p && p.getBoundingClientRect().top <= 140) best = it;
    });
    items.forEach(function (it) {
      it.className = 'cn-item' + (it === best ? ' on' : '');
    });
  }

  function renderCareer() {
    var el = document.getElementById('career-content');

    // 无数据：显示引导（与游戏库一致）
    if (!DATA.games || DATA.games.length === 0) {
      el.innerHTML = '<div class="placeholder"><div class="big">[ ~ ]</div><h2>还没有生涯数据</h2>' +
        '<p>先去「导入」页连接 Steam，拉取成功后这里会展示你的游戏生涯统计。</p></div>';
      return;
    }

    var k = computeKPIs();
    var dist = platformDistribution();

    var maxDist = dist.length ? dist[0].minutes : 1;
    var distHtml = dist.map(function (r) {
      var pct = Math.max(2, Math.round(r.minutes / maxDist * 100));
      return '<div class="pdist-row">' +
        '<div class="pdist-name">' + esc(r.platform.name) + '</div>' +
        '<div class="pdist-track"><div class="pdist-fill" style="width:' + pct + '%;background:' + r.platform.color + '">' +
          formatMinutes(r.minutes) + '</div></div></div>';
    }).join('');

    el.innerHTML =
      '<div class="career-layout">' +
      // 左侧目录（用户 2026-10-19：面板多了要能跳）
      '<nav class="career-nav" id="career-nav">' + careerNavHtml() + '</nav>' +
      '<div class="career-main">' +
      '<div class="kpi-row">' +
        kpiCard('游戏总数', k.games, '', '已收录于本地') +
        kpiCard('总时长', formatMinutes(k.total), '', '累计游玩分钟') +
        kpiCard('已解锁成就', k.achUnlocked, '/ ' + k.achTotal, '已解锁 / 总数') +
        kpiCard('平台数', k.platforms, '', '跨平台聚合') +
      '</div>' +
      // 面板顺序（用户 2026-10-19 定；近12周已按用户 2026-10-21 要求删除；年度统计 2026-10-21 重设计）：
      // 最近在玩 → 时长排行 → 年度 → 时间轴 → 平台分布（最末）
      recentPlayingPanel() +
      topPanel() +
      '<div class="panel" id="panel-year"><h3>年度统计</h3>' +
        '<div class="year-bar"><span style="color:var(--text-2);font-size:13px">选择年份</span>' +
          '<select class="year-select" id="year-select"></select></div>' +
        '<div id="year-stats" class="muted">统计加载中…</div>' +
      '</div>' +
      '<div class="panel" id="panel-timeline"><h3>游玩时间轴 · 跨平台</h3>' +
        '<div class="tl-bar">' +
          '<span class="dbar-toggle">' +
            '<button class="cal-nav rng' + (tlMode === 'month' ? ' on' : '') + '" data-tl-mode="month">按月</button>' +
            '<button class="cal-nav rng' + (tlMode === 'day' ? ' on' : '') + '" data-tl-mode="day">按天</button>' +
            '<button class="cal-nav rng' + (tlMode === 'first' ? ' on' : '') + '" data-tl-mode="first">首次游玩</button>' +
          '</span>' +
          '<span class="tl-lb">只看</span>' +
          '<select class="year-select" id="tl-filter">' + tlFilterOpts() + '</select>' +
        '</div>' +
        '<div id="tl-box">' + timelineHtml() + '</div>' +
      '</div>' +
      '<div class="panel" id="panel-dist"><h3>平台时长分布</h3>' + distHtml + '</div>' +
      '</div></div>';

    bindCareerNav();
    loadYearStats('');
    var sel = document.getElementById('year-select');
    if (sel) {
      sel.addEventListener('change', function () { loadYearStats(sel.value); });
    }
    var tlf = document.getElementById('tl-filter');
    if (tlf) {
      tlf.addEventListener('change', function () {
        careerTlFilter = tlf.value;
        careerTlDays = 30;                       // 换筛选从头开始
        careerTlMonths = 6;
        careerFirstYears = 1;
        refreshTimeline();
      });
    }
    var rpf = document.getElementById('rp-filter');
    if (rpf) {
      rpf.addEventListener('change', function () {
        rpFilter = rpf.value;
        refreshRecentPlaying();
      });
    }
    var topf = document.getElementById('top-filter');
    if (topf) {
      topf.addEventListener('change', function () {
        topFilter = topf.value;
        topLimit = 20;                           // 换筛选从头展示
        refreshTop();
      });
    }
  }

  /** 时间轴的平台下拉：只列出真正有数据的平台（时间轴和「最近在玩」共用，各自传自己当前值） */
  function tlFilterOpts(current) {
    var cur = current || careerTlFilter;
    var seen = {};
    (DATA.games || []).forEach(function (g) {
      (g.platforms || []).forEach(function (p) { seen[p.platform] = 1; });
    });
    var groups = [
      { id: 'all', name: '全部平台' },
      { id: 'steam', name: 'Steam' },
      { id: 'xbox', name: 'Xbox' },
      { id: 'epic', name: 'Epic' },
      { id: 'nintendo', name: 'Nintendo（三台主机）' },
      { id: 'retro', name: 'Retro 老游戏' },
      { id: 'pc', name: 'PC（Playnite）' },
      { id: 'emu', name: '模拟器' },
    ].filter(function (g) {
      if (g.id === 'all') return true;
      return Object.keys(seen).some(function (pid) {
        if (g.id === 'nintendo') return isNintendoPlatform(pid);
        if (g.id === 'retro') return isRaPlatform(pid);
        if (g.id === 'emu') return isEmuPlatform(pid);
        return pid === g.id;
      });
    });
    return groups.map(function (g) {
      return '<option value="' + g.id + '"' + (g.id === cur ? ' selected' : '') + '>' + esc(g.name) + '</option>';
    }).join('');
  }

  function refreshTimeline() {
    var box = document.getElementById('tl-box');
    if (box) box.innerHTML = timelineHtml();
  }

  /* ---- 年度统计 v2（2026-10-21 设计定稿）----
   * 指标与口径见 importers/year_stats.mjs 顶部注释；手机不参与。
   * 数据由服务端 /api/stats/year 纯本地聚合（任天堂按天 + Xbox 成就明细都在服务端磁盘上）。
   */
  var yearStatsCache = {};

  function yearBarRow(name, count, max, color) {
    var pct = Math.max(2, Math.round(count / (max || 1) * 100));
    return '<div class="pdist-row">' +
      '<div class="pdist-name">' + esc(name) + '</div>' +
      '<div class="pdist-track"><div class="pdist-fill" style="width:' + pct + '%;background:' + (color || 'var(--accent)') + '">' +
        count + ' 款</div></div></div>';
  }

  /** 标题 → 封面 本地映射（给 100% 列表等文字行补图标；纯本地匹配，不发请求） */
  function coverByTitle() {
    var map = {};
    (DATA.games || []).forEach(function (g) {
      if (g.cover && g.title) map[String(g.title).toLowerCase()] = g.cover;
    });
    return map;
  }

  function renderYearStats(j) {
    var box = document.getElementById('year-stats');
    if (!box) return;
    var html = '';

    html += '<div class="kpi-row">' +
      kpiCard('今年玩过', j.playedTotal, ' 款', '最后游玩在今年 · 时长 ≥1 小时') +
      kpiCard('今年新玩', j.newTotal, ' 款', '玩过里面今年首次的 · 同样 ≥1 小时') +
      kpiCard('今年成就', j.achTotal, ' 个', '按解锁日期') +
      kpiCard('今年时长 · 任天堂', formatMinutes(j.nintendo.totalMinutes || 0), '', '按天记录 · ' + (j.nintendo.daysPlayed || 0) + ' 天') +
    '</div>';

    // 各平台今年玩过 · 柱状对比（用户 2026-10-21 加）
    var colors = { Steam: '#1b9be8', Xbox: '#3ea743', Retro: '#c86428', '任天堂': '#d43d3d', Epic: '#6d6d6d', 'PC': '#7c5cff', '模拟器': '#2f9e77' };
    var playedRows = j.byPlatform.filter(function (p) { return p.played > 0; });
    if (playedRows.length) {
      var maxP = Math.max.apply(null, playedRows.map(function (p) { return p.played; }));
      html += '<div class="year-block"><div class="year-block-title">各平台今年玩过</div>' +
        playedRows.map(function (p) { return yearBarRow(p.name, p.played, maxP, colors[p.name]); }).join('') +
        '</div>';
    } else {
      html += '<div class="year-block muted">今年还没有各平台的游玩记录。</div>';
    }

    // 今年 100% 达成（没有就整块隐藏）
    var cMap = coverByTitle();
    if (j.hundred && j.hundred.length) {
      html += '<div class="year-block"><div class="year-block-title">今年 100% 达成 · ' + j.hundred.length + ' 款</div>' +
        j.hundred.map(function (h) {
          var cv = cMap[String(h.title).toLowerCase()] || '';
          return '<div class="hundred-row">' +
            (cv ? '<img class="hundred-cover" src="' + esc(cv) + '" alt="" loading="lazy">' : '<span class="hundred-cover hundred-nocover"></span>') +
            '<span class="hundred-name">' + esc(h.title) + '</span>' +
            '<span class="hundred-meta">' + esc(h.platform) + ' · ' + esc(h.date) + '</span></div>';
        }).join('') + '</div>';
    }

    // 今年最上头（任天堂专属，有按天数据且连续 ≥2 天才显示）
    var t = j.nintendo && j.nintendo.topStreak;
    if (t) {
      var hotCv = cMap[String(t.title).toLowerCase()] || '';
      html += '<div class="year-block year-hot">' +
        '<div class="year-block-title">今年最上头 · 任天堂</div>' +
        '<div class="hot-line">' +
          (hotCv ? '<img class="hundred-cover" src="' + esc(hotCv) + '" alt="" loading="lazy">' : '') +
          '<span class="hot-text"><b>' + esc(t.title) + '</b>　连续 <b>' + t.streak +
          '</b> 天没放下，今年共玩 <b>' + formatMinutes(t.minutes) + '</b>（' + t.days + ' 天有记录）</span>' +
        '</div></div>';
    }

    html += '<div class="year-note">口径：手机不参与；「玩过」= 最后游玩时间在今年且总时长 ≥1 小时（无时长数据的不剔除，Epic 没有游玩数据不参与）；' +
      '「新玩」= 在「玩过」里面，首次游玩 / 首个成就 / 新领落在今年 —— 所以新玩一定不超过玩过。</div>';

    box.className = '';
    box.innerHTML = html;
  }

  function loadYearStats(year) {
    if (window.GH_STATIC) return;   // 线上只读版没有服务端，且该面板本就隐藏
    var sel = document.getElementById('year-select');
    var box = document.getElementById('year-stats');
    if (!box) return;
    var cacheKey = String(year || '');
    if (yearStatsCache[cacheKey]) {
      var c = yearStatsCache[cacheKey];
      fillYearSelect(c.years, c.year);
      renderYearStats(c);
      return;
    }
    box.className = 'muted';
    box.innerHTML = '统计加载中…';
    fetch('/api/stats/year' + (year ? '?year=' + encodeURIComponent(year) : ''))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || '统计失败');
        yearStatsCache[cacheKey] = j;
        fillYearSelect(j.years, j.year);
        renderYearStats(j);
      })
      .catch(function (e) {
        box.className = 'muted';
        box.innerHTML = '统计读取失败：' + esc(e.message);
      });
  }

  function fillYearSelect(years, current) {
    var sel = document.getElementById('year-select');
    if (!sel) return;
    var list = (years || []).slice().reverse();
    sel.innerHTML = list.map(function (y) {
      return '<option value="' + esc(y) + '"' + (String(y) === String(current) ? ' selected' : '') + '>' + esc(y) + ' 年</option>';
    }).join('');
  }

  /* ============ 游戏数据库（docs/03 §16.7：库列表 + 手动添加向导） ============ */
  var DB = null;              // 游戏库数据（懒加载一次，改库后清掉重新拉）
  var dbFilter = 'all';
  var dbSort = 'name';

  function dbSlug(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || ('game-' + Date.now());
  }

  function dbLoad(force) {
    if (DB && !force) return Promise.resolve(DB);
    return fetch('/api/library').then(function (r) { return r.json(); }).then(function (j) {
      DB = (j && j.games) || [];
      return DB;
    }).catch(function () { DB = []; return DB; });
  }

  /** 搜索命中：展示名 + 中英文名 + 别名 + 各平台原名，中英文都认 */
  function dbMatch(g, q) {
    if (!q) return true;
    var parts = [g.displayName, g.names && g.names.en, g.names && g.names.zh]
      .concat(g.aliases || [])
      .concat((g.platforms || []).map(function (p) { return p.name; }));
    return parts.filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0;
  }

  function dbHasPlatform(g, p) { return (g.platforms || []).some(function (x) { return x.platform === p; }); }

  /* ---- 平台展示名：库内平台值 → 中文短名（NDS / 3DS / GBA / 街机…） ---- */
  var DB_PLAT_NAME = {
    steam: 'Steam', xbox: 'Xbox', epic: 'Epic Games', pc: 'PC',
    'nintendo-switch': 'Switch', 'nintendo-switch2': 'Switch 2', 'nintendo-3ds': '3DS',
    'nintendo-wiiu': 'Wii U', 'nintendo-ds': 'NDS',
  };
  var DB_PLAT_ZH = {
    nes: 'FC/NES', fds: 'FC磁碟机', snes: 'SFC/SNES', sfc: 'SFC/SNES', gba: 'GBA', gb: 'GB',
    gbc: 'GBC', ds: 'NDS', '3ds': '3DS', psp: 'PSP', ps1: 'PS1', ps2: 'PS2', wii: 'Wii',
    gc: 'NGC', md: 'MD', sms: 'SMS', gg: 'GG', ngp: 'NGP', ngpc: 'NGPC', n64: 'N64',
    dc: 'DC', saturn: '土星', pce: 'PCE', vb: 'Virtual Boy', ws: 'WonderSwan', wsc: 'WonderSwan Color',
    lynx: 'Lynx', atari2600: 'Atari 2600', atari7800: 'Atari 7800', '32x': '32X',
    sg1000: 'SG-1000', neogeocd: 'NeoGeo CD', segacd: 'Mega CD', pcecd: 'PCE-CD',
    arcade: '街机', arc: '街机',
  };
  function dbPlatName(p) {
    var id = String(p || '');
    if (DB_PLAT_NAME[id]) return DB_PLAT_NAME[id];
    var m = /^(?:ra|emu|gamedb)-(.+)$/.exec(id);
    if (m && DB_PLAT_ZH[m[1]]) return DB_PLAT_ZH[m[1]];
    if (m) return m[1].toUpperCase();
    return getPlatform(id).name;
  }

  /** Epic 无名 offer 的库内条目：displayName 是一串十六进制 hash，对用户没有意义 */
  var DB_HEX_RE = /^[0-9a-f]{16,}$/i;
  function dbUnreadable(g) { return DB_HEX_RE.test(String(g.displayName || '')); }

  /** 平台筛选下拉：按库内实际出现过的平台动态生成（含各主机），保留跨平台/待补全两项 */
  function dbRenderFilterOptions(games) {
    var el = document.getElementById('db-filter');
    if (!el) return;
    var count = {};
    games.forEach(function (g) {
      (g.platforms || []).forEach(function (p) { count[p.platform] = (count[p.platform] || 0) + 1; });
    });
    var PRIO = { steam: 0, xbox: 1, epic: 2, pc: 3, 'nintendo-switch': 4, 'nintendo-switch2': 5, 'nintendo-3ds': 6 };
    var keys = Object.keys(count).sort(function (a, b) {
      var pa = PRIO[a] !== undefined ? PRIO[a] : 100, pb = PRIO[b] !== undefined ? PRIO[b] : 100;
      if (pa !== pb) return pa - pb;
      return count[b] - count[a];
    });
    var html = '<option value="all">全部平台</option>';
    keys.forEach(function (k) {
      html += '<option value="' + esc(k) + '">' + esc(dbPlatName(k)) + '（' + count[k] + '）</option>';
    });
    html += '<option value="multi">跨平台（多平台同一款）</option>';
    html += '<option value="nometadata">元数据待补全</option>';
    var cur = dbFilter;
    el.innerHTML = html;
    if (cur && (cur === 'all' || count[cur] || cur === 'multi' || cur === 'nometadata')) el.value = cur;
    else { dbFilter = 'all'; el.value = 'all'; }
  }

  function renderDatabase() {
    var statsEl = document.getElementById('db-stats');
    var listEl = document.getElementById('db-list');
    listEl.innerHTML = '<div class="db-add-hint">正在读取游戏库…</div>';
    dbLoad().then(function (games) {
      // Epic 无名 offer（displayName 是十六进制 hash）对浏览没意义：整列隐藏
      var visible = games.filter(function (g) { return !dbUnreadable(g); });
      var hiddenCount = games.length - visible.length;
      dbRenderFilterOptions(visible);
      var q = String(document.getElementById('db-search').value || '').trim().toLowerCase();
      var list = visible.filter(function (g) {
        if (!dbMatch(g, q)) return false;
        if (dbFilter === 'all') return true;
        if (dbFilter === 'multi') return (g.platforms || []).length > 1;
        if (dbFilter === 'nometadata') return !g.releaseDate;
        return dbHasPlatform(g, dbFilter);
      });
      if (dbSort === 'recent') {
        list.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
      } else if (dbSort === 'ach') {
        list.sort(function (a, b) { return ((b.achievements || {}).total || 0) - ((a.achievements || {}).total || 0); });
      } else {
        list.sort(function (a, b) { return String(a.displayName || '').localeCompare(String(b.displayName || ''), 'zh'); });
      }

      var multi = visible.filter(function (g) { return (g.platforms || []).length > 1; }).length;
      var zh = visible.filter(function (g) { return g.names && g.names.zh; }).length;
      var noMeta = visible.filter(function (g) { return !g.releaseDate; }).length;
      var ach = visible.filter(function (g) { return g.achievements && g.achievements.hasAchievements; }).length;
      statsEl.innerHTML =
        '<span>收录 <b>' + visible.length + '</b> 款</span>' +
        '<span>跨平台同名 <b>' + multi + '</b> 款</span>' +
        '<span>有中文名 <b>' + zh + '</b> 款</span>' +
        '<span>有成就 <b>' + ach + '</b> 款</span>' +
        '<span>元数据待补全 <b>' + noMeta + '</b> 款</span>' +
        (hiddenCount ? '<span style="opacity:.7">已隐藏无法识别的名字 <b>' + hiddenCount + '</b> 款（Epic 无名条目）</span>' : '') +
        '<span style="opacity:.7">当前显示 ' + list.length + ' 款</span>';

      if (!visible.length) {
        listEl.innerHTML = '<div class="placeholder"><div class="big">[ + ]</div><h2>游戏库还是空的</h2>' +
          '<p>点右上角「添加游戏」，或先去「导入」页拉取平台数据（拉取后会自动补库）。</p></div>';
        return;
      }
      if (!list.length) { listEl.innerHTML = '<div class="db-add-hint">没有匹配的游戏。</div>'; return; }

      listEl.innerHTML = list.map(function (g) {
        var cover = g.cover ? '<img class="db-cover" src="' + g.cover + '" alt="">'
          : '<div class="db-cover"></div>';
        var plats = (g.platforms || []).map(function (p) {
          return '<span class="db-tag">' + esc(dbPlatName(p.platform)) + '</span>';
        }).join('');
        var bits = [];
        if (g.releaseDate) bits.push(g.releaseDate.slice(0, 4) + ' 年');
        if (g.achievements && g.achievements.hasAchievements) bits.push('成就 ' + (g.achievements.total || 0) + ' 个');
        if ((g.developers || []).length) bits.push(g.developers[0]);
        if (!g.releaseDate) bits.push('元数据待补全');
        var alias = (g.aliases || []).length ? '别名：' + g.aliases.join('、') : '';
        var warn = !g.releaseDate ? ' warn' : '';
        return '<div class="db-row" data-id="' + esc(g.id) + '">' + cover +
          '<div class="db-main"><div class="db-name">' + esc(g.displayName || g.id) + '</div>' +
          '<div class="db-sub">' + plats + '<span class="db-tag' + warn + '">' + esc(bits.join(' · ')) + '</span></div>' +
          (alias ? '<div class="db-sub">' + esc(alias) + '</div>' : '') + '</div></div>';
      }).join('');
      [].forEach.call(listEl.querySelectorAll('.db-row'), function (el) {
        el.addEventListener('click', function () {
          var g = list.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
          if (g) dbOpenEdit(g);   // 点进列表直接开编辑弹窗（省掉中间详情页）
        });
      });
    });
  }

  /* ===== 编辑资料弹窗 ===== */
  var dbEditId = null;

  function dbGetGame(id) {
    return (DB || []).filter(function (g) { return g.id === id; })[0] || null;
  }

  function dbOpenEdit(g) {
    dbEditId = g.id;
    // 弹窗头部：封面 + 名字 + 平台，确认在改哪款
    var head = '<div class="db-e-head">' +
      (g.cover ? '<img src="' + esc(g.cover) + '" alt="">'
               : '<div class="db-e-cover"></div>') +
      '<div class="db-e-ht"><div class="db-e-hn">' + esc(g.displayName || g.id) + '</div>' +
      '<div class="db-e-hp">' + esc((g.platforms || []).map(function (p) { return dbPlatName(p.platform); }).join(' · ')) + '</div></div></div>';
    var row = function (key, label, val, ph, textarea) {
      var v = esc(val == null ? '' : String(val));
      var input = textarea
        ? '<textarea id="db-e-' + key + '" class="db-input" placeholder="' + esc(ph || '') + '">' + v + '</textarea>'
        : '<input id="db-e-' + key + '" class="db-input" value="' + v + '" placeholder="' + esc(ph || '') + '">';
      return '<div class="db-e-row"><label>' + label + '</label>' + input + '</div>';
    };
    var listJoin = function (a) { return (a || []).join('、'); };
    document.getElementById('db-edit-body').innerHTML =
      head +
      row('displayName', '显示名', g.displayName, '列表和页签里显示的名字') +
      row('zh', '中文名', g.names && g.names.zh, '官方或常用中文译名') +
      row('en', '英文名', g.names && g.names.en, '') +
      row('aliases', '别名', listJoin(g.aliases), '用顿号或逗号分隔，可以填多个') +
      row('releaseDate', '发售日期', g.releaseDate, '如 2021 或 2021-12-17') +
      row('developers', '开发商', listJoin(g.developers), '') +
      row('publishers', '发行商', listJoin(g.publishers), '') +
      row('genres', '类型', listJoin(g.genres), '如 动作、角色扮演') +
      row('shortDescription', '简介', g.shortDescription, '一两句话介绍', true);
    document.getElementById('db-edit-hint').textContent = '';
    document.getElementById('db-edit-mask').style.display = 'flex';
  }

  function dbCloseEdit() {
    document.getElementById('db-edit-mask').style.display = 'none';
    dbEditId = null;
  }

  function dbSaveEdit() {
    var g = dbGetGame(dbEditId);
    var hint = document.getElementById('db-edit-hint');
    if (!g || !hint) return;
    var val = function (key) { return String(document.getElementById('db-e-' + key).value || '').trim(); };
    var splitList = function (s) {
      return s ? s.split(/[,，、;；]/).map(function (t) { return t.trim(); }).filter(Boolean) : [];
    };
    var name = val('displayName');
    if (!name) { hint.textContent = '显示名不能为空。'; return; }
    hint.textContent = '正在保存…';
    var entry = JSON.parse(JSON.stringify(g));
    entry.overrides = Object.assign({}, g.overrides || {});
    var locked = [];
    if (name !== g.displayName) { entry.displayName = name; entry.overrides.displayName = true; locked.push(true); }
    var zh = val('zh'), en = val('en');
    if (zh !== (g.names && g.names.zh || '') || en !== (g.names && g.names.en || '')) {
      entry.names = entry.names || { en: null, zh: null, zhSource: null };
      if (zh) { entry.names.zh = zh; if (!entry.names.zhSource || entry.names.zhSource === 'steam-appdetails') entry.names.zhSource = 'manual'; }
      else entry.names.zh = null;
      entry.names.en = en || entry.names.en;
      entry.overrides.names = true; locked.push(true);
    }
    var aliasNew = splitList(val('aliases'));
    if (aliasNew.join('|') !== (g.aliases || []).join('|')) { entry.aliases = aliasNew; entry.overrides.aliases = true; locked.push(true); }
    var rd = val('releaseDate');
    if (rd !== (g.releaseDate || '')) { entry.releaseDate = rd || null; entry.overrides.releaseDate = true; locked.push(true); }
    var dv = splitList(val('developers'));
    if (dv.join('|') !== (g.developers || []).join('|')) { entry.developers = dv; entry.overrides.developers = true; locked.push(true); }
    var pb = splitList(val('publishers'));
    if (pb.join('|') !== (g.publishers || []).join('|')) { entry.publishers = pb; entry.overrides.publishers = true; locked.push(true); }
    var ge = splitList(val('genres'));
    if (ge.join('|') !== (g.genres || []).join('|')) { entry.genres = ge; entry.overrides.genres = true; locked.push(true); }
    var sd = val('shortDescription');
    if (sd !== (g.shortDescription || '')) { entry.shortDescription = sd || null; entry.overrides.shortDescription = true; locked.push(true); }
    if (locked.length) entry.meta = Object.assign({}, entry.meta, { manual: true });
    fetch('/api/library/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: entry }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) {
        DB = null;                          // 强制下次重新读库
        hint.textContent = '已保存 ✓（锁定 ' + locked.length + ' 个字段）';
        setTimeout(function () { dbCloseEdit(); dbLoad().then(renderDatabase); }, 500);
      } else {
        hint.textContent = '保存失败：' + ((j && j.error) || '未知错误');
      }
    }).catch(function (e) { hint.textContent = '保存出错：' + e.message; });
  }

  /* ---- 添加游戏向导 ---- */
  function openDbAdd() { document.getElementById('db-add-mask').style.display = 'flex'; }
  function closeDbAdd() { document.getElementById('db-add-mask').style.display = 'none'; }

  function dbDoSearch() {
    var q = String(document.getElementById('db-add-q').value || '').trim();
    var src = String(document.getElementById('db-add-source').value || 'auto');
    var resEl = document.getElementById('db-add-results');
    var hint = document.getElementById('db-add-hint');
    if (!q) { hint.textContent = '先输入游戏名。'; return; }
    hint.textContent = '正在从' + (src === 'bangumi' ? ' Bangumi ' : src === 'steam' ? ' Steam ' : ' Steam ') + '搜索「' + q + '」…（国内网络偶尔很慢，最长约 40 秒）';
    resEl.innerHTML = '';
    fetch('/api/library/search?q=' + encodeURIComponent(q) + '&source=' + encodeURIComponent(src)).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { hint.textContent = '搜索失败：' + (j.error || '未知错误') + '（可改用下方手动添加）'; return; }
        var items = j.items || [];
        var tookMs = Number(j.tookMs || 0);
        var tookTxt = tookMs > 0 ? '（用时 ' + (tookMs / 1000).toFixed(1).replace(/\.0$/, '') + ' 秒）' : '';
        if (!items.length) {
          hint.textContent = (j.source === 'bangumi' ? 'Bangumi 也没搜到。' : '没搜到。')
            + '可以在上面把数据源切成「Bangumi」再试（Bangumi 的中文译名最全，Steam 搜不到的中文名它多半有），或用下方「手动添加」。' + tookTxt;
          return;
        }
        var srcLabel = j.source === 'bangumi' ? 'Bangumi' : 'Steam';
        var switchTxt = j.switched ? '（Steam 没搜到，已自动切换到 Bangumi）' : '';
        var partial = items.filter(function (it) { return it.partial; }).length;
        hint.textContent = '找到 ' + items.length + ' 条，来自 ' + srcLabel + switchTxt + '，点一条添加：' + tookTxt
          + (partial ? '（其中 ' + partial + ' 条 Steam 详情没拉到，先用商店列表信息显示，可稍后重试补全）' : '');
        resEl.innerHTML = items.map(function (it, i) {
          var isBgm = it.source === 'bangumi';
          var srcTag = isBgm
            ? '<span style="margin-left:6px;font-size:12px;font-weight:400;opacity:.85;background:rgba(255,255,255,.12);padding:1px 6px;border-radius:4px">Bangumi</span>'
            : '';
          var subBits = isBgm
            ? [it.releaseDate ? it.releaseDate.slice(0, 10) : '', it.nameEn && it.nameEn !== it.nameZh ? it.nameEn : '']
            : [it.releaseDate ? it.releaseDate.slice(0, 4) : '', (it.developers || [])[0] || '',
              it.partial ? '资料未完整' : '成就 ' + (it.achievements || 0)];
          var partialTag = it.partial
            ? '<span style="margin-left:6px;font-size:12px;font-weight:400;opacity:.85">网络不稳，资料未完整（可重试）</span>' : '';
          return '<div class="db-res" data-i="' + i + '">' +
            (it.cover ? '<img src="' + it.cover + '" alt="">' : '<div style="width:92px"></div>') +
            '<div class="r-main"><div class="r-name">' + esc(it.nameZh || it.nameEn) +
            (it.nameZh && it.nameEn && it.nameZh !== it.nameEn ? ' <span style="opacity:.6;font-weight:400">' + esc(it.nameEn) + '</span>' : '') +
            srcTag + partialTag + '</div>' +
            '<div class="r-sub">' + esc(subBits.filter(Boolean).join(' · ')) + '</div></div></div>';
        }).join('');
        [].forEach.call(resEl.querySelectorAll('.db-res'), function (el) {
          el.addEventListener('click', function () { dbAddItem(items[Number(el.getAttribute('data-i'))]); });
        });
      }).catch(function (e) {
        hint.textContent = '搜索出错：' + e.message + '（可改用下方手动添加）';
      });
  }

  function dbAddItem(it) {
    var hint = document.getElementById('db-add-hint');
    var isBgm = it.source === 'bangumi';
    var id = isBgm ? dbSlug(it.nameZh || it.nameEn) + '-bgm' + it.bgmId : dbSlug(it.nameEn || it.nameZh);
    var entry = {
      id: id,
      displayName: it.nameZh || it.nameEn,
      names: { en: it.nameEn || null, zh: it.nameZh || null, zhSource: it.nameZh ? (isBgm ? 'bangumi' : 'steam-cn') : null },
      aliases: [],
      releaseDate: it.releaseDate || null,
      releaseDatePrecision: it.releaseDate ? (String(it.releaseDate).length <= 4 ? 'year' : 'day') : 'unknown',
      developers: it.developers || [],
      publishers: it.publishers || [],
      genres: it.genres || [],
      categories: [],
      tags: [],
      shortDescription: it.shortDescription || '',
      description: null,
      cover: it.cover || null,
      headerImage: it.cover || null,
      platforms: isBgm
        ? [{ platform: 'bangumi', externalId: it.bgmId, name: it.nameZh || it.nameEn, verified: false }]
        : [{ platform: 'steam', externalId: it.appid, name: it.nameZh || it.nameEn, verified: true }],
      achievements: { total: it.achievements || 0, hasAchievements: (it.achievements || 0) > 0, source: isBgm ? null : 'steam-appdetails', items: [] },
      links: isBgm
        ? { bangumi: 'https://bgm.tv/subject/' + it.bgmId + '/' }
        : { steam: 'https://store.steampowered.com/app/' + it.appid + '/' },
      overrides: {},
      meta: {
        sources: isBgm ? ['bangumi'] : ['steam-cn', 'steam-en'],
        fetchedAt: new Date().toISOString(),
        manual: false,
        notes: isBgm ? '来自 Bangumi（官方中文名）。搜索结果不带发售日/简介，需要的话以后补。' : '',
      },
    };
    hint.textContent = '正在添加「' + (it.nameZh || it.nameEn) + '」并下载封面…';
    fetch('/api/library/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, entry: entry }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { hint.textContent = '添加失败：' + (j.error || '未知错误'); return; }
      hint.textContent = '已添加「' + (it.nameZh || it.nameEn) + '」（库内共 ' + j.count + ' 款）。';
      document.getElementById('db-add-results').innerHTML = '';
      DB = null;
      renderDatabase();
    }).catch(function (e) { hint.textContent = '添加失败：' + e.message; });
  }

  function dbAddManual() {
    var nameEl = document.getElementById('db-manual-name');
    var aliasEl = document.getElementById('db-manual-alias');
    var hint = document.getElementById('db-add-hint');
    var name = String(nameEl.value || '').trim();
    if (!name) { hint.textContent = '请填游戏名。'; return; }
    var aliases = String(aliasEl.value || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var id = dbSlug(name);
    var entry = {
      id: id, displayName: name,
      names: { en: /[\u4e00-\u9fa5]/.test(name) ? null : name, zh: /[\u4e00-\u9fa5]/.test(name) ? name : null, zhSource: 'manual' },
      aliases: aliases, releaseDate: null, releaseDatePrecision: 'unknown',
      developers: [], publishers: [], genres: [], categories: [], tags: [],
      shortDescription: null, description: null, cover: null, headerImage: null,
      platforms: [],
      achievements: { total: 0, hasAchievements: false, source: null, items: [] },
      links: {}, overrides: {},
      meta: { sources: [], fetchedAt: null, manual: true, notes: '纯手动添加' },
    };
    fetch('/api/library/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, entry: entry }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { hint.textContent = '添加失败：' + (j.error || '未知错误'); return; }
      hint.textContent = '已手动添加「' + name + '」（库内共 ' + j.count + ' 款）。';
      nameEl.value = ''; aliasEl.value = '';
      DB = null;
      renderDatabase();
    }).catch(function (e) { hint.textContent = '添加失败：' + e.message; });
  }

  /* ============================ 导航与初始化 ============================ */

  function navigate(page) {
    currentPage = page;
    [].forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-page') === page);
    });
    [].forEach.call(document.querySelectorAll('.page'), function (p) {
      p.classList.toggle('active', p.id === 'page-' + page);
    });
    window.scrollTo(0, 0);   // 切页后回到顶部（上一页可能停得很深，尤其导入页）
    if (page === 'career') { renderCareer(); }
    if (page === 'library') { renderLibrary(); }
    if (page === 'db') { renderDatabase(); }
  }

  /** 某款游戏的数据来源平台名（可能有多个，用 / 连接），用于详情页标签 */
  function gameSourceLabel(game) {
    return (game.platforms || []).map(function (p) { return getPlatform(p.platform).name; }).join(' / ');
  }

  /**
   * 切换筛选（页签 / 侧边栏通用）：
   *  - src 为空或 'all' → 看「全部」（所有已接入平台合并展示）；
   *  - src 是具体平台且已拉取 → 只看那个平台；
   *  - 还没拉过 → 引导去「导入」页连接。
   * 数据本身始终用合并视图 DATA，靠 currentPlatform 筛选，不再整份数据切来切去。
   */
  function setSource(src) {
    if (src && src !== 'all') {
      if (!sourceData(src)) { navigate('import'); return; }
      currentPlatform = SOURCES[src].platform;
    } else {
      currentPlatform = 'all';
    }
    [].forEach.call(document.querySelectorAll('.src-btn[data-src]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-src') === src);
    });
    currentPage = 'library';   // 切完直接带用户去看游戏库（原来停留原页，看起来像"没反应"）
    navigate('library');
  }

  /**
   * Xbox 成就总数后台补齐：
   * 标题历史接口的 totalAchievements 字段不可靠（经常为 0），但成就明细接口有全量名单。
   * 这里在页面打开后，把「有进度但总数未知」的 Xbox 游戏逐款补一次明细
   * （串行请求、服务端有磁盘缓存，一次性成本，之后全走本地）。
   * 补完把 total/unlocked 修正为明细里的真实值，并刷新列表。
   */
  var __achBackfillStarted = false;
  function backfillXboxAchievementTotals() {
    if (__achBackfillStarted) return;
    if (window.GH_STATIC) return;   // 线上只读版：没有服务端，明细已打包在 data_xbox_ach.js
    var todo = [];
    DATA.games.forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        if (p.platform === 'xbox' && p.externalId && !(p.achievements.total > 0) &&
            ((p.achievements.unlocked > 0) || (p.extra && Number(p.extra.percentComplete) > 0))) {
          todo.push(p);
        }
      });
    });
    if (!todo.length) return;
    // 最近玩的排前面（用户最关心的先补齐）；每轮限量，避免撞 150 次/小时的免费配额
    todo.sort(function (a, b) { return String(b.lastPlayedAt || '').localeCompare(String(a.lastPlayedAt || '')); });
    // 50 款/轮：免费配额是 150 次/小时，一轮最多用掉 1/3，留足余量给「打开详情」这类随时请求
    var MAX_PER_SESSION = 50;
    if (todo.length > MAX_PER_SESSION) todo = todo.slice(0, MAX_PER_SESSION);
    __achBackfillStarted = true;
    var i = 0, changed = 0;
    (function next() {
      if (i >= todo.length) {
        if (changed) { if (currentPage === 'library') renderLibrary(); if (currentPage === 'career') renderCareer(); }
        return;
      }
      var p = todo[i++];
      fetch('/api/xbox/achievements?titleId=' + encodeURIComponent(p.externalId))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.items && d.items.length) {
            p.achievements.items = d.items;
            p.achievements.total = d.items.length;
            p.achievements.unlocked = d.items.filter(function (it) { return !!it.unlockedAt; }).length;
            changed++;
            if (changed % 10 === 0 && currentPage === 'library') renderLibrary();   // 每 10 款刷一次，边拉边看
          } else if (d && !d.ok) {
            i = todo.length;   // 被限流(429)等错误：立即停，剩余的下次打开页面接着补
          }
        })
        .catch(function () { i = todo.length; })   // 网络错误同样停下
        .then(next);   // 串行：一个接一个，避免瞬时打满接口限流
    })();
  }

  /** 供导入页调用：注入某平台的拉取结果并切过去 */
  window.__applyPlatformData = function (platform, unified) {
    var def = SOURCES[platform];
    if (!def) return;
    if (unified) { window[def.varName] = unified; }
    refreshData();             // 重建「全部」合并视图，把新平台的数据算进去
    var btn = document.getElementById('src-' + platform + '-btn');
    if (btn) { btn.disabled = false; btn.title = ''; }   // 之前是禁用状态，拉取后放开
    setSource(platform);
  };

  /** 兼容旧调用（“查看我的 Steam”） */
  window.__applySteamData = function (unified) {
    window.__applyPlatformData('steam', unified);
  };

  /* ==================== 资源补齐（后台任务进度，2026-10-21） ====================
   * 本地导入 Steam/Xbox 成功后服务端自动跑；这里只负责在导入页显示进度 + 手动补跑。
   * 轮询三闸门：确认在跑才启动 / 终态立刻 clearInterval / 硬上限 1800 次（约 1 小时）。
   */
  var syncTimer = null, syncPolls = 0;

  function fmtSyncState(st) {
    if (!st || !st.ok) return '状态获取失败';
    if (st.running) {
      var pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      return '补齐中 ' + pct + '%（' + st.done + '/' + st.total + '）· 新下载 ' + st.okCount +
             ' · 跳过 ' + st.skipCount + ' · 失败 ' + st.failCount + ' · 当前：' + (st.current || '…');
    }
    if (st.total > 0 && st.finishedAt) {
      return '上次补齐完成：新下载 ' + st.okCount + ' · 跳过 ' + st.skipCount + ' · 失败 ' + st.failCount;
    }
    return '图片已完整，无需补齐';
  }

  function stopSyncPoll() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  function pollSyncState() {
    syncPolls++;
    if (syncPolls > 1800) stopSyncPoll();     // 硬上限，防止自激轮询（2026-10-19 事故教训）
    fetch('/api/assets/sync?brief=1')
      .then(function (r) { return r.json(); })
      .then(function (st) {
        var el = document.getElementById('assets-sync-status');
        if (el) el.textContent = fmtSyncState(st);
        if (!st || !st.running) stopSyncPoll();
      })
      .catch(function () { /* 服务端没起就不刷了 */ });
  }

  function initAssetSyncPanel() {
    var btn = document.getElementById('assets-sync-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        fetch('/api/assets/sync', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            btn.disabled = false;
            if (!j.ok && j.reason) {
              var el = document.getElementById('assets-sync-status');
              if (el) el.textContent = j.reason;
            }
            startSyncPoll();
          })
          .catch(function () { btn.disabled = false; });
      });
    }
    startSyncPoll();
  }

  function startSyncPoll() {
    if (syncTimer) return;                     // 闸门1：已在跑就不重复启动
    syncPolls = 0;
    pollSyncState();
    syncTimer = setInterval(pollSyncState, 2000);
  }

  function init() {
    // 线上只读版：发布脚本把 GH_STATIC 改成 true，隐藏一切会写数据的功能
    if (window.GH_STATIC) document.body.classList.add('gh-static');
    if (!window.GH_STATIC) initAssetSyncPanel();
    [].forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      b.addEventListener('click', function () { navigate(b.getAttribute('data-page')); });
    });
    // 锚点直达：网址带 #import / #career 等就直接切到那一页（验证 / 分享定位用）
    var h0 = (location.hash || '').replace('#', '');
    if (h0 && document.getElementById('page-' + h0)) navigate(h0);
    // 只绑定带 data-src 的按钮（.src-btn 这个类在页面里也被普通按钮复用了）
    [].forEach.call(document.querySelectorAll('.src-btn[data-src]'), function (b) {
      b.addEventListener('click', function () { setSource(b.getAttribute('data-src')); });
    });
    // 还没拉取过的平台：灰掉并给出提示
    SOURCE_ORDER.forEach(function (s) {
      var btn = document.getElementById('src-' + s + '-btn');
      if (btn && !sourceData(s)) {
        btn.disabled = true;
        btn.title = '还没拉取过' + SOURCES[s].label.replace('我的 ', '') + '数据，去「导入」页连接后即可查看';
      }
    });
    // 游戏数据库页：搜索 / 筛选 / 排序 / 添加向导
    var dbSearch = document.getElementById('db-search');
    if (dbSearch) dbSearch.addEventListener('input', function () { renderDatabase(); });
    var dbFilterEl = document.getElementById('db-filter');
    if (dbFilterEl) dbFilterEl.addEventListener('change', function () { dbFilter = this.value; renderDatabase(); });
    var dbSortEl = document.getElementById('db-sort');
    if (dbSortEl) dbSortEl.addEventListener('change', function () { dbSort = this.value; renderDatabase(); });
    var dbAddBtn = document.getElementById('db-add-btn');
    if (dbAddBtn) dbAddBtn.addEventListener('click', openDbAdd);
    var dbClose = document.getElementById('db-add-close');
    if (dbClose) dbClose.addEventListener('click', closeDbAdd);
    var dbMask = document.getElementById('db-add-mask');
    if (dbMask) dbMask.addEventListener('click', function (e) { if (e.target === dbMask) closeDbAdd(); });
    var dbGoSearch = document.getElementById('db-add-search');
    if (dbGoSearch) dbGoSearch.addEventListener('click', dbDoSearch);
    var dbQ = document.getElementById('db-add-q');
    if (dbQ) dbQ.addEventListener('keydown', function (e) { if (e.key === 'Enter') dbDoSearch(); });
    var dbManualAdd = document.getElementById('db-manual-add');
    if (dbManualAdd) dbManualAdd.addEventListener('click', dbAddManual);
    // 导入页分区导航：点击滚到对应板块
    [].forEach.call(document.querySelectorAll('.imp-nav-btn'), function (b) {
      b.addEventListener('click', function () {
        var t = document.getElementById(b.getAttribute('data-target'));
        if (!t) return;
        [].forEach.call(document.querySelectorAll('.imp-nav-btn'), function (x) {
          x.classList.toggle('active', x === b);
        });
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    // 编辑资料弹窗
    var dbEditClose = document.getElementById('db-edit-close');
    if (dbEditClose) dbEditClose.addEventListener('click', dbCloseEdit);
    var dbEditMask = document.getElementById('db-edit-mask');
    if (dbEditMask) dbEditMask.addEventListener('click', function (e) { if (e.target === dbEditMask) dbCloseEdit(); });
    var dbEditSave = document.getElementById('db-edit-save');
    if (dbEditSave) dbEditSave.addEventListener('click', dbSaveEdit);

    renderLibrary();
    renderCareer();
    backfillXboxAchievementTotals();   // 后台补齐 Xbox 成就总数（有缓存，一次性）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
