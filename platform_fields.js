/* ===========================================================================
 * platform_fields.js  ——  各平台「特有字段」登记表（渲染字典）
 *
 * 用途：游戏详情页里，每款游戏按来源平台显示**该平台自己的字段**；
 *       而顶部「基本信息」（聚合视图）只显示跨平台通用字段。
 *
 * 以后接入新平台（Xbox / Switch / RetroAchievements / 手机 / 模拟器）时，
 * 只需要：① 在下面这个表加一个条目；② 在对应的 importer 里把字段写进
 * platformPlay.extra。**不用改 app.js 的任何渲染代码。**
 *
 * 字段定义：{ key, label, type }
 *   key   —— platformPlay.extra 里的键名
 *   label —— 页面上显示的中文名
 *   type  —— 格式化方式：minutes(时长) | date(日期) | number(数字)
 *            | bool(是/否) | text(原样文本)
 * ======================================================================== */

window.PLATFORM_FIELDS = {

  /* ---------- Steam：官方字段已登记 ---------- */
  steam: [
    { key: 'appId',            label: 'Steam AppID', type: 'text' },
    { key: 'playtime2Weeks',   label: '近两周时长',   type: 'minutes' },
    { key: 'playtimeWindows',  label: 'Windows 时长', type: 'minutes' },
    { key: 'playtimeMac',      label: 'Mac 时长',     type: 'minutes' },
    { key: 'playtimeLinux',    label: 'Linux 时长',   type: 'minutes' },
    { key: 'hasStats',         label: '社区成就可见', type: 'bool' },
  ],

  /* ---------- 以下为待填写模板（接入对应平台时补上即可） ---------- */

  /* ---------- Xbox（走 OpenXBL 网关）：公开接口字段已登记 ---------- */
  xbox: [
    { key: 'titleId',           label: 'Title ID',   type: 'text' },
    { key: 'gamerscore',        label: '已获成就分数', type: 'number' },
    { key: 'possibleGamerscore', label: '总成就分数',   type: 'number' },
    { key: 'percentComplete',   label: '完成度',       type: 'number' },
  ],

  /* ---------- Epic Games（社区逆向接口）----------
   * 只登记对人有意义的字段；Product ID / Catalog ID / Namespace 这类十六进制 ID
   * 是机器对账用的，用户 2026-10-20 明确不展示。
   * 真名/开发商/发行日期/简介由 catalog 接口补全后存在游戏级字段（顶部「基本信息」显示）。
   * Epic 没有成就、没有按天记录、没有首次/最后游玩时间 —— 都是平台限制，不是没拉到。 */
  epic: [
    { key: 'acquisitionDate', label: '领取时间', type: 'date' },
    { key: 'platform',        label: '支持平台', type: 'text' },
  ],

  /* ---------- 手机（屏幕账本 App 手动导出，2026-10-20 接入）----------
   * 数据自带：类别（游戏/应用）、每天使用毫秒、当天最后一次进前台的时间戳。
   * 手机没有成就、拿不到「首次游玩」（导出窗口只有十几天），所以这些字段一个都不显示。
   * 包名（pkg）是机器用的，不展示 —— 同 Epic 的十六进制 ID 规则。 */
  phone: [
    { key: 'category',        label: '类别',      type: 'text' },
    { key: 'totalPlayedDays', label: '有记录天数',  type: 'number' },
    { key: 'avgMinutes',      label: '日均使用',   type: 'minutes' },
    { key: 'firstDay',        label: '最早记录',   type: 'text' },
    { key: 'lastDay',         label: '最近记录',   type: 'text' },
    { key: 'deviceName',      label: '设备',      type: 'text' },
  ],

  /* ---------- Nintendo（Switch / Switch 2 / 3DS 共用一张表） ----------
   * 数据来自 Nintendo Store app 同一套接口：清单 + 每款按天记录。
   * 注意：任天堂全平台没有成就系统；3DS 还拿不到按天记录（任天堂不提供）。 */
  nintendo: [
    { key: 'consoleName',     label: '主机',         type: 'text' },
    { key: 'platformCode',    label: '平台代号',      type: 'text' },   // HAC / BEE / CTR
    { key: 'titleId',         label: 'Title ID',    type: 'text' },
    { key: 'totalPlayedDays', label: '游玩天数',      type: 'number' },  // 官方清单口径
    { key: 'calendarDays',    label: '按天记录条数',   type: 'number' },  // 实际拉到的日历天数
    { key: 'hasCalendar',     label: '有日历',        type: 'bool' },    // 3DS 为否
  ],

  // Switch：官方无公开 API，数据来自手动导出；特色是「每次启动时间」
  switch: [
    // { key: 'launchCount',    label: '启动次数', type: 'number' },
    // { key: 'firstLaunch',    label: '首次启动', type: 'date' },
    // { key: 'lastLaunch',     label: '最后启动', type: 'date' },
    // { key: 'playSessions',   label: '游玩场次', type: 'number' },
  ],

  /* ---------- RetroAchievements：模拟器 / 老游戏成就 ----------
   * 注意：RA 的游戏是按主机拆成 ra-nes / ra-gba / ra-ds … 多个平台的（用户 2026-10-19 定），
   * 这张表用 retroachievements 这一个键当「RA 全家共用」的字段表，
   * app.js 里凡是以 ra- 开头的平台都会自动套用这张表。 */
  retroachievements: [
    { key: 'consoleName',  label: '主机平台',   type: 'text' },
    { key: 'awardLabel',   label: '通关状态',   type: 'text' },   // 已通关 / 已精通
    { key: 'percent',      label: '完成度(%)',  type: 'number' },
    { key: 'playtimeText', label: '页面时长原文', type: 'text' },  // "7 hours, 28 minutes"
    { key: 'spanText',     label: '起止跨度',   type: 'text' },   // "over 5 days, 5 hours"
  ],

  // 模拟器（3DS/PS3/PS4 等，无 RA 覆盖时手工造数据）
  'emulator-3ds': [
    // { key: 'romName',      label: 'ROM 名称', type: 'text' },
    // { key: 'emulatorName', label: '模拟器',   type: 'text' },
  ],

  // 手机（自定义计时工具导入）
  mobile: [
    // { key: 'device',      label: '设备',     type: 'text' },
    // { key: 'sessionCount',label: '计时次数', type: 'number' },
  ],

  // 自定义/手工录入
  custom: [
    // { key: 'note', label: '备注', type: 'text' },
  ],
};
