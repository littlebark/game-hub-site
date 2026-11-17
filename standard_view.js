/* 标准数据渲染器：从 standard_preview.html 抽取，作用域限定 #page-library，
   暴露 window.StdLibrary.{mount(),render()}，由 app.js 在游戏库页调用。数据来自 GAME_DATA_STANDARD + GAME_DATA_CUSTOM。 */
window.StdLibrary = 
(function(){
  'use strict';
  var ROOT = document.getElementById('page-library');
  function _id(id){ return ROOT ? ROOT.querySelector('#'+id) : document.getElementById(id); }
  function _all(sel){ return ROOT ? ROOT.querySelectorAll(sel) : document.querySelectorAll(sel); }
  var ALL = window.GAME_DATA_STANDARD || [];
  // 人工层标记：手改永远赢、刷新后保持（由 data/frontend/data_custom.js 提供）
  var CUSTOM_MARKS = (window.GAME_DATA_CUSTOM && window.GAME_DATA_CUSTOM.games) || {};
  var GROUPS = [
    {id:'nintendo',name:'任天堂',match:function(p){return p.indexOf('nintendo-')===0}},
    {id:'xbox',name:'Xbox',match:function(p){return p==='xbox'}},
    {id:'steam',name:'Steam',match:function(p){return p==='steam'}},
    {id:'retro',name:'Retro',match:function(p){return p.indexOf('ra-')===0}},
    {id:'epic',name:'Epic',match:function(p){return p==='epic'}},
    {id:'phone',name:'手机',match:function(p){return p==='phone'}},
    {id:'pc',name:'PC',match:function(p){return p==='pc'}},
    {id:'emu',name:'模拟器',match:function(p){return p.indexOf('emu-')===0}}
  ];
  var curGroup='all', curSub='all', showHidden=false;
  // 照搬主站排序工具条：排序4项（默认最近游玩）、通关3项、首次游玩年份（仅任天堂）、类型（游戏/应用）
  var curSort='lastPlayed', curClear='', curCat='', curYear='';

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  // 一条标准游戏里真正参与渲染的那个 source（当前每款只有 1 条）
  function srcOf(g){return (g.sources&&g.sources[0])||{}}
  // 人工层主键：与后端 setMark 约定完全一致 = sources[0].platform:externalId（防空）
  function markKeyOf(g){var s=srcOf(g);return (s.platform||'')+':'+(s.externalId||'')}
  // 人工层覆盖：手改永远赢。status==='finished' 覆盖通关（优先于官方 beaten/mastered）；
  // category/hidden 有值则覆盖全部 source。切回清空时这里不动 g.clearStatus，显示自然回落到官方值。
  function applyManual(){
    ALL.forEach(function(g){
      var m=CUSTOM_MARKS[markKeyOf(g)];
      if(!m)return;
      if(m.status==='finished')g.clearStatus='finished';
      if(m.category!==undefined&&m.category!==''){
        (g.sources||[]).forEach(function(s){s.category=m.category});
      }
      if(m.hidden!==undefined){
        (g.sources||[]).forEach(function(s){s.hidden=!!m.hidden});
      }
    });
  }
  function groupOf(g){var p=srcOf(g).platform||'';for(var i=0;i<GROUPS.length;i++)if(GROUPS[i].match(p))return GROUPS[i].id;return 'other'}
  function hasAch(s){var a=s.achievements||{};return !a.unsupported && (a.total||0)>0}
  function hasCal(s){return Object.keys(s.daily||{}).length>0 || (s.timeRecords||[]).length>0}
  function fmtMin(m){m=Math.round(m||0);if(m<60)return m+' 分钟';var h=Math.floor(m/60),r=m%60;return h+' 小时'+(r?' '+r+' 分':'')}
  function fmtDate(iso){if(!iso)return '';var d=new Date(iso);return isNaN(d.getTime())?'':d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function bjDate(iso){if(!iso)return '';var d=new Date(new Date(iso).getTime()+8*3600*1000);return d.toISOString().slice(0,10)}
  function datePart(iso){return bjDate(iso)}
  function formatMinutes(min){min=Math.round(min||0);if(min<60)return min+' 分钟';
    var h=Math.floor(min/60),r=min%60;return h+' 小时'+(r?' '+r+' 分':'')}
  var calMonth={};   // 每款游戏当前显示的月份 {'YYYY-MM'}，翻月用
  function shiftMonth(ym,delta){
    if(!ym)return ym;var p=ym.split('-'),y=Number(p[0]),mo=Number(p[1])-1+delta;
    y+=Math.floor(mo/12);mo=((mo%12)+12)%12;
    return y+'-'+String(mo+1).padStart(2,'0');
  }
  function subLabel(p){var m={'nintendo-switch':'Switch','nintendo-switch2':'Switch2','nintendo-3ds':'3DS',
    'nintendo-ds':'DS','ra-gba':'GBA','ra-nes':'NES','ra-snes':'SNES','ra-arc':'ARC','ra-ds':'DS',
    'ra-md':'MD','ra-psp':'PSP','ra-ps2':'PS2','ra-wii':'Wii','ra-gc':'GC','ra-ngp':'NGP','ra-sms':'SMS',
    'emu-ps3':'PS3','emu-wii':'Wii','emu-arc':'ARC'};return m[p]||p}
  // 平台配色：照抄各源数据 platforms[].color，按 platform id 查表（和 subLabel 一样是数据映射，不是按平台写 if）
  var PLAT_COLOR={'nintendo-switch':'#e60012','nintendo-switch2':'#00a8e8','nintendo-3ds':'#8e8e93','nintendo-ds':'#7c5cbf',
    'xbox':'#107c10','steam':'#1b9bf0','epic':'#333e48','pc':'hsl(331,52%,42%)','phone':'#2f7cf6',
    'emu-wii':'hsl(71,52%,42%)','emu-arc':'hsl(82,52%,42%)','emu-ps3':'hsl(80,52%,42%)',
    'ra-arc':'hsl(116,52%,42%)','ra-ds':'hsl(141,52%,42%)','ra-gba':'hsl(344,52%,42%)','ra-gc':'hsl(218,52%,42%)',
    'ra-md':'hsl(45,52%,42%)','ra-nes':'hsl(342,52%,42%)','ra-ngp':'hsl(41,52%,42%)','ra-ps2':'hsl(113,52%,42%)',
    'ra-psp':'hsl(175,52%,42%)','ra-sms':'hsl(355,52%,42%)','ra-snes':'hsl(127,52%,42%)','ra-wii':'hsl(105,52%,42%)'};
  function platColor(p){return PLAT_COLOR[p]||'#7f8c8d'}

  // 平台/子平台/隐藏这一层；筛选按钮的计数基于它，不含通关与类型条件
  function baseList(){
    return ALL.filter(function(g){
      var s=srcOf(g),p=s.platform||'';
      if(curGroup!=='all'){
        var grp=GROUPS.filter(function(x){return x.id===curGroup})[0];
        if(!grp||!grp.match(p))return false;
      }
      if(curSub!=='all'&&p!==curSub)return false;
      if(!showHidden && s.hidden===true)return false;   // 标准字段 hidden：列表默认隐藏，不认平台
      return true;
    });
  }
  // 排序器与主站 app.js sortGames() 同口径；切换下拉即换排序器
  var SORTERS={
    lastPlayed:function(a,b){return (b.lastPlayedAt||'').localeCompare(a.lastPlayedAt||'')},
    playtime:function(a,b){return (srcOf(b).totalMinutes||0)-(srcOf(a).totalMinutes||0)},
    achievements:function(a,b){
      function pct(g){var x=srcOf(g).achievements||{};return x.total?((x.unlocked||0)/x.total*100):0}
      return pct(b)-pct(a);
    },
    title:function(a,b){return String(a.title||'').localeCompare(String(b.title||''),'zh-Hans-CN')}
  };
  function firstYear(g){var f=srcOf(g).firstPlayedAt;return f?bjDate(f).slice(0,4):''}
  function visible(){
    return baseList().filter(function(g){
      var s=srcOf(g),p=s.platform||'';
      // 全部页签默认过滤：应用（category=app）和手机（platform=phone）。
      // 想看应用可用「类型=应用」下拉，想看手机可切「手机」页签，所以这里用 curCat!=='app' 放开应用入口。
      if(curGroup==='all'&&curCat!=='app'&&(s.category==='app'||p==='phone'))return false;
      // 通关：clearStatus 有值（beaten/mastered/finished）算已通关，其余算未通关
      if(curClear==='beaten'&&!g.clearStatus)return false;
      if(curClear==='playing'&&g.clearStatus)return false;
      // 类型：未标注 category 的按「游戏」处理（1481/1619 未标注，默认就是游戏）
      if(curCat==='app'&&s.category!=='app')return false;
      if(curCat==='game'&&s.category==='app')return false;
      // 首次游玩年份：只有任天堂有值；非任天堂组这个下拉根本不渲染，curYear 也会复位
      if(curYear&&firstYear(g)!==curYear)return false;
      return true;
    }).sort(SORTERS[curSort]||SORTERS.lastPlayed);
  }

  function renderTabs(){
    var counts={all:ALL.length};
    GROUPS.forEach(function(gp){counts[gp.id]=ALL.filter(function(x){return groupOf(x)===gp.id}).length});
    var h='<button class="tab'+(curGroup==='all'?' active':'')+'" data-g="all">全部<small>'+counts.all+'</small></button>';
    GROUPS.forEach(function(gp){
      if(!counts[gp.id])return;
      h+='<button class="tab'+(curGroup===gp.id?' active':'')+'" data-g="'+gp.id+'">'+gp.name+'<small>'+counts[gp.id]+'</small></button>';
    });
    // hidden 开关：验证「隐藏是标准字段，不是手机特判」
    h+='<button class="tab'+(showHidden?' active':'')+'" id="toggle-hidden" style="margin-left:auto">'+
      (showHidden?'隐藏已显示':'显示隐藏项 ('+ALL.filter(function(x){return srcOf(x).hidden===true}).length+')')+'</button>';
    _id('tabs').innerHTML=h;
    _id('toggle-hidden').onclick=function(){showHidden=!showHidden;render()};
    [].forEach.call(_all('.tab[data-g]'),function(b){
      b.onclick=function(){curGroup=b.getAttribute('data-g');curSub='all';render()}});
  }

  function renderSubtabs(){
    if(curGroup==='all'){_id('subtabs').innerHTML='';return}
    var map={};
    ALL.forEach(function(g){var s=srcOf(g),p=s.platform||'';
      var gp=GROUPS.filter(function(x){return x.id===curGroup})[0];
      if(gp&&gp.match(p))map[p]=(map[p]||0)+1});
    var keys=Object.keys(map);
    if(keys.length<=1){_id('subtabs').innerHTML='';return}
    var h='<button class="subtab'+(curSub==='all'?' active':'')+'" data-s="all">全部主机<small>'+ALL.filter(function(g){return groupOf(g)===curGroup}).length+'</small></button>';
    keys.forEach(function(k){h+='<button class="subtab'+(curSub===k?' active':'')+'" data-s="'+k+'">'+esc(subLabel(k))+'<small>'+map[k]+'</small></button>'});
    _id('subtabs').innerHTML=h;
    [].forEach.call(_all('.subtab'),function(b){
      b.onclick=function(){curSub=b.getAttribute('data-s');render()}});
  }

  // 排序工具条：选项与主站 app.js 完全一致（最近游玩 / 总时长 / 成就进度 / 游戏名称）。
  // 「首次游玩」年份下拉是任天堂专属：非任天堂组不渲染（对应主站切页签时 removeChild）。
  // 「类型」是本预览页新增的第四维（游戏/应用），主站没有。
  function renderSortBar(){
    var h='<span class="sort-label">排序</span>'+
      '<select id="sort-select">'+
        '<option value="lastPlayed">最近游玩</option>'+
        '<option value="playtime">总时长</option>'+
        '<option value="achievements">成就进度</option>'+
        '<option value="title">游戏名称</option>'+
      '</select>'+
      '<span class="sort-label">筛选</span>'+
      '<select id="beaten-filter">'+
        '<option value="">全部游戏</option>'+
        '<option value="beaten">已通关</option>'+
        '<option value="playing">未通关</option>'+
      '</select>'+
      '<span class="sort-label">类型</span>'+
      '<select id="cat-filter">'+
        '<option value="">全部</option>'+
        '<option value="game">游戏</option>'+
        '<option value="app">应用</option>'+
      '</select>';
    if(curGroup==='nintendo'){
      // 年份候选取当前平台/子平台游戏的 firstPlayedAt，倒序（新的在前）
      var ys={};
      baseList().forEach(function(g){var y=firstYear(g);if(y)ys[y]=1});
      var years=Object.keys(ys).sort().reverse();
      if(curYear&&years.indexOf(curYear)<0)curYear='';   // 换子平台后该年没游戏 → 回全部
      h+='<span class="sort-label">首次游玩</span><select id="year-filter">'+
        '<option value="">全部年份</option>'+
        years.map(function(y){return '<option value="'+y+'"'+(y===curYear?' selected':'')+'>'+y+' 年</option>'}).join('')+
        '</select>';
    }else if(curYear){
      curYear='';   // 切到别的页签就收起下拉并复位
    }
    _id('sortbar').innerHTML=h;
    function bind(id,set){
      var el=document.getElementById(id);
      if(el)el.onchange=function(){set(el.value);render()};
    }
    bind('sort-select',function(v){curSort=v});
    bind('beaten-filter',function(v){curClear=v});
    bind('cat-filter',function(v){curCat=v});
    bind('year-filter',function(v){curYear=v});
    var ss=_id('sort-select');if(ss)ss.value=curSort;
    var bf=_id('beaten-filter');if(bf)bf.value=curClear;
    var cf=_id('cat-filter');if(cf)cf.value=curCat;
  }

  // 最近游玩横幅：照搬主站 renderHero —— 全池取最近游玩且有封面的一款，不随筛选变；点整块开详情。
  function renderHero(){
    var el=_id('hero'),best=null,bestLast='';
    ALL.forEach(function(g){
      var s=srcOf(g);
      if(s.hidden===true||!g.cover)return;      // 隐藏项 / 无封面（横幅靠封面）不参选，同主站
      // 与首页「全部」页签同口径：横幅不展示应用（category=app）和手机（platform=phone）。
      // 首页是把这两类从默认列表过滤掉，横幅作为首页的一部分必须一致，否则会出现「数码宝贝（手机应用）」这类不合适的最近游玩。
      if(s.category==='app'||(s.platform||'')==='phone')return;
      var last=g.lastPlayedAt||s.lastPlayedAt||'';
      if(last>bestLast){bestLast=last;best=g}
    });
    if(!best){el.className='hero hero-none';el.innerHTML='';el.onclick=null;return}
    var s=srcOf(best),a=s.achievements||{},full=hasAch(s)&&a.total>0&&a.unlocked===a.total;
    var heroBeaten=!full&&!!(best&&best.clearStatus);
    var cover='<div class="hero-cover'+(full?' full':'')+(heroBeaten?' beaten':'')+'"><span>'+esc((best.title||'?').charAt(0).toUpperCase())+'</span>'+
      '<img src="'+esc(best.cover)+'" alt="" loading="lazy" onerror="this.remove()"></div>';
    var meta='<span class="chip plat" style="background:'+platColor(s.platform||'')+'">'+esc(subLabel(s.platform||''))+'</span>'+
      '<span>总时长 <b>'+fmtMin(s.totalMinutes)+'</b></span>'+
      (hasAch(s)?'<span>成就 <b>'+(a.unlocked||0)+'/'+(a.total||0)+'</b>（'+(a.total?Math.round((a.unlocked||0)/a.total*100):0)+'%）</span>':'')+
      '<span>最后游玩 <b>'+esc(fmtDate(best.lastPlayedAt||s.lastPlayedAt))+'</b></span>';
    el.className='hero';
    el.innerHTML='<div class="hero-inner">'+cover+'<div>'+
      '<div class="hero-label">最近游玩</div>'+
      '<div class="hero-title">'+esc(best.title)+(best.nameZh?' <span style="color:var(--t2);font-size:15px;font-weight:400">'+esc(best.nameZh)+'</span>':'')+'</div>'+
      '<div class="hero-meta">'+meta+'</div></div></div>';
    el.onclick=function(){openDlg(best)};
  }

  function renderStats(list){
    var mins=0,achN=0,calN=0,firstN=0;
    list.forEach(function(g){var s=srcOf(g);mins+=s.totalMinutes||0;if(hasAch(s))achN++;if(hasCal(s))calN++;if(s.firstPlayedAt)firstN++});
    // 用户 2026-11-16：值为 0 的统计卡不显示（如 Retro 的「有日历字段 0」「有首次游玩时间 0」）
    var cards=[
      [list.length,String(list.length),'款游戏'],
      [mins,Math.round(mins/60)+'h','总时长（分钟字段求和）'],
      [achN,String(achN),'有成就字段'],
      [calN,String(calN),'有日历字段'],
      [firstN,String(firstN),'有首次游玩时间']
    ];
    _id('stats').innerHTML=cards.filter(function(c){return c[0]>0}).map(function(c){
      return '<div class="stat"><div class="n">'+c[1]+'</div><div class="l">'+c[2]+'</div></div>'
    }).join('');
  }

  // 白色奖杯图标（画在 .achmark.cup / .tick 的彩色圆底上），2026-11-16 用户拍板替换原来的绿勾。
  var TROPHY_SVG='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'+
    '<path d="M7 2h10v6a5 5 0 0 1-10 0V2z"/>'+
    '<path d="M4 4h3v5a4 4 0 0 1-3-3.5V4z"/>'+
    '<path d="M17 4h3v1.5A4 4 0 0 1 17 9V4z"/>'+
    '<path d="M11 13h2v5h-2z"/>'+
    '<path d="M8 19h8v3H8z"/></svg>';
  function coverHtml(g,s,full){
    // 通关绿框口径与成就条绿奖杯一致：clearStatus 有值即通关；满成就金框优先（full 命中不再加 beaten）
    var beaten=!full&&!!(g&&g.clearStatus);
    if(g.cover)return '<img class="cover'+(full?' full':'')+(beaten?' beaten':'')+'" src="'+esc(g.cover)+'" alt="" loading="lazy">';
    return '<div class="cover-ph'+(full?' full':'')+(beaten?' beaten':'')+'">'+esc((g.title||'?').charAt(0).toUpperCase())+'</div>';
  }
  // 无成就平台：用标准字段挑一个「更有意义的数字」显示，不按平台名写 if。
  // 主站口径：PC=启动次数、模拟器=来源、手机=有记录N天/日均、任天堂=游玩N天。
  function noAchBox(s,g){
    var ex=s.extra||{},top,tag,grp=groupOf(g),days=s.calendarDays||s.totalPlayedDays;
    if(s.category==='app'&&days){
      top='有记录 <b>'+days+'</b> 天';
      tag=ex.avgMinutes!=null?('日均 '+ex.avgMinutes+' 分'):'应用';
    }else if(grp==='pc'&&s.launchCount){
      top='启动 <b>'+s.launchCount+'</b> 次';tag=ex.sourceGroup||'PC';
    }else if(grp==='emu'||ex.sourceGroup){
      top='来源 <b>'+esc(ex.sourceGroup||'模拟器')+'</b>';tag='模拟器计数';
    }else if(days){
      top='游玩 <b>'+days+'</b> 天';tag='本平台无成就';
    }else if(s.launchCount){
      top='启动 <b>'+s.launchCount+'</b> 次';tag='本平台无成就';
    }else{
      top='—';tag=(s.achievements||{}).unsupported?'平台无成就系统':'本平台无成就字段';
    }
    var mark=(g&&g.clearStatus)?'<i class="achmark cup" title="已通关">'+TROPHY_SVG+'</i>':'';
    return '<div class="achbox"><div class="na-top"><span>'+top+'</span><span class="na-tag">'+esc(tag)+'</span></div>'+
      '<div class="barrow"><div class="bar" style="background:transparent"></div>'+mark+'</div></div>';
  }
  function achBox(s,g){
    if(!hasAch(s))return noAchBox(s,g);
    var a=s.achievements,pct=a.total?Math.round(a.unlocked/a.total*100):0,full=pct===100;
    // 满成就金圆白星 > 已通关绿圆白奖杯；优先级同主站（full 命中时不再显示通关标记）
    var mark=full?'<i class="achmark star" title="成就已全收集（100%）">★</i>'
      :((g&&g.clearStatus)?'<i class="achmark cup" title="已通关">'+TROPHY_SVG+'</i>':'');
    // 成就点阵：前 8 条 items，有 unlockedAt 或 unlocked===true 就点亮
    var items=(a.items||[]).slice(0,8);
    var dots=items.length?'<div class="achdots">'+items.map(function(it){
      return '<i class="'+((it.unlockedAt||it.unlocked===true)?'on':'')+'"></i>'}).join('')+'</div>':'';
    return '<div class="achbox"><div class="top"><span>成就 '+a.unlocked+'/'+a.total+'</span><span>'+pct+'%</span></div>'+
      '<div class="barrow"><div class="bar'+(full?' full':'')+'"><i style="width:'+pct+'%"></i></div>'+mark+'</div>'+dots+'</div>';
  }
  function renderList(list){
    if(!list.length){_id('list').innerHTML='<div class="empty">该筛选下没有游戏</div>';return}
    _id('list').innerHTML=list.map(function(g,i){
      var s=srcOf(g),a=s.achievements||{},full=hasAch(s)&&a.total>0&&a.unlocked===a.total;
      var chips='<span class="chip plat" style="background:'+platColor(s.platform||'')+'">'+esc(subLabel(s.platform||''))+'</span>';
      if(s.category)chips+='<span class="chip" style="background:#fdf0e3;color:#a8661a">'+(s.category==='app'?'应用':'游戏')+'</span>';
      if(s.hidden===true)chips+='<span class="chip" style="background:#fdeaea;color:var(--red)">已隐藏</span>';
      if(hasCal(s))chips+='<span class="chip cal">日历 '+Object.keys(s.daily||{}).length+' 天</span>';
      if(hasAch(s))chips+='<span class="chip ach">成就 '+(a.unlocked||0)+'/'+(a.total||0)+'</span>';
      // 类型副标题：标准字段 genres 前 2 项，主站形态「动作 / 冒险」
      var genre=(g.genres||[]).slice(0,2).join(' / ');
      var genreHtml=genre?'<span class="ggenre">'+esc(genre)+'</span>':'';
      return '<div class="row" data-i="'+i+'">'+coverHtml(g,s,full)+
        '<div class="gmeta"><div class="gtitle">'+esc(g.title)+(g.nameZh?'<span class="zh">'+esc(g.nameZh)+'</span>':'')+genreHtml+'</div>'+
        '<div class="gsub">'+chips+'</div></div>'+
        '<div class="gmins"><b>'+fmtMin(s.totalMinutes)+'</b></div>'+
        '<div class="gdate">'+esc(fmtDate(s.lastPlayedAt))+'</div>'+achBox(s,g)+'</div>';
    }).join('');
    [].forEach.call(_all('.row'),function(r){
      r.onclick=function(){openDlg(list[Number(r.getAttribute('data-i'))])};
    });
  }

  // 月历柱状图（照搬主站 monthBarsHtml）：一天一根柱子，高度=当天时长，可翻月。
  // 数据来自标准字段 sources[].daily（YYYY-MM-DD → 分钟），不认平台。
  function monthBarsHtml(map,ym,key){
    var m=/^(\d{4})-(\d{2})$/.exec(ym);
    var y=m?Number(m[1]):new Date().getFullYear(),mo=m?Number(m[2])-1:new Date().getMonth();
    var mm=String(mo+1).padStart(2,'0'),days=new Date(y,mo+1,0).getDate();
    var total=0,active=0,max=0,maxDay=0,d,k,min;
    for(d=1;d<=days;d++){k=y+'-'+mm+'-'+String(d).padStart(2,'0');min=map[k]||0;
      total+=min;if(min){active++;if(min>max){max=min;maxDay=d}}}
    var H=96,bars='';
    var firstYm=Object.keys(map).sort()[0]||'',lastYm=Object.keys(map).sort().slice(-1)[0]||'';
    for(d=1;d<=days;d++){
      k=y+'-'+mm+'-'+String(d).padStart(2,'0');min=map[k]||0;
      var h=min?Math.max(5,Math.round(min/max*H)):3;
      var tip=k+' · '+(min?'玩了 '+formatMinutes(min):'没玩');
      bars+='<div class="gcal-col" title="'+esc(tip)+'">'+
        '<div class="gcal-bar'+(min?'':' zero')+'" style="height:'+h+'px"></div>'+
        '<span class="gcal-l">'+(d===1||d%5===0?d:'')+'</span></div>';
    }
    var disPrev=ym<=firstYm.slice(0,7),disNext=ym>=lastYm.slice(0,7);
    return '<div class="cal-wrap"><div class="cal-head">'+
      '<button class="cal-nav" data-cal-key="'+esc(key)+'" data-delta="-1"'+(disPrev?' disabled':'')+'>‹</button>'+
      '<span class="cal-title">'+y+' 年 '+(mo+1)+' 月</span>'+
      '<button class="cal-nav" data-cal-key="'+esc(key)+'" data-delta="1"'+(disNext?' disabled':'')+'>›</button>'+
      '<span class="cal-sum">'+(active?('玩了 '+active+' 天 · 共 '+formatMinutes(total)):'这个月没有记录')+'</span>'+
      '</div><div class="gcal-row">'+bars+'</div>'+
      '<div class="day-hint">'+(active?('柱高 = 当天时长 · 最多一天 '+formatMinutes(max)+'（'+(mo+1)+' 月 '+maxDay+' 日）'):'这个月一天都没用。')+'</div></div>';
  }
  function calHtml(s,key){
    if(!hasCal(s))return '';
    var map={};Object.keys(s.daily||{}).forEach(function(k){map[k]=Number(s.daily[k])||0});
    var keys=Object.keys(map).sort();
    if(!keys.length)return '<div class="day-hint">（timeRecords 有值但 daily 为空）</div>';
    if(!calMonth[key])calMonth[key]=keys[keys.length-1].slice(0,7);
    return monthBarsHtml(map,calMonth[key],key);
  }
  // 成就列表（照搬主站 compactAchHtml + .ach-list）：字段来自标准 achievements.items，不认平台。
  function compactAchHtml(it){
    var on=!!it.unlockedAt||it.unlocked===true;
    var icon=it.iconUrl
      ? '<img src="'+esc(it.iconUrl)+'" alt="" loading="lazy" onerror="this.remove()">'
      : '★';
    var pts=(it.points!==null&&it.points!==undefined&&it.points!=='')?(' · '+it.points+' 点'):'';
    var tail=pts+(on?(it.unlockedAt?' · 解锁于 '+datePart(it.unlockedAt):' · 已解锁（时间未记录）'):' · 未解锁');
    return '<div class="ach-item '+(on?'on':'off')+'">'+
      '<div class="badge">'+icon+(on?'<i class="tick" title="已解锁">'+TROPHY_SVG+'</i>':'')+'</div>'+
      '<div><div class="a-name">'+esc(it.name||'')+'</div>'+
      '<div class="a-desc">'+esc(it.description||'')+tail+'</div></div></div>';
  }
  function achHtml(s){
    if(!hasAch(s))return '';
    var a=s.achievements,items=a.items||[];
    var h='<div class="kv" style="margin-bottom:11px">'+
      '<div class="cell"><div class="k">解锁 / 总数</div><div class="v">'+a.unlocked+' / '+a.total+'</div></div>'+
      '<div class="cell"><div class="k">完成度</div><div class="v">'+(a.total?Math.round(a.unlocked/a.total*100):0)+'%</div></div>'+
      '<div class="cell"><div class="k">明细条数</div><div class="v">'+items.length+'</div></div></div>';
    if(items.length)h+='<div class="ach-list">'+items.map(compactAchHtml).join('')+'</div>';
    else h+='<div class="day-hint">有成就总数但明细未拉到（如 Xbox 懒加载）</div>';
    return h;
  }
  // 平台特有字段展示白名单（用户 2026-11-16 从 extra 字段清单里圈定的 A 档）。
  // 只显示这些键，加中文名；其余 extra 键（技术ID/布尔标记/重复数据）一律不展示。
  var EXTRA_WHITELIST={
    gamerscore:'G分数', possibleGamerscore:'G分数满分', devices:'游玩设备',
    acquisitionDate:'领取日期', installDir:'安装目录', sourceGroup:'玩家分组',
    avgMinutes:'日均时长(分)', firstDay:'首次记录日', deviceName:'设备型号',
    realTimeLabel:'存档计时', awardPoints:'成就点数', spanText:'时间跨度',
    accounts:'游玩账号', productCode:'卡带编号', region:'区服'
  };
  function extraHtml(s){
    var ex=s.extra||{};
    // 通用识别：图片证据 + 说明，不看平台名。
    var proofs=Array.isArray(ex.proofImages)?ex.proofImages.filter(function(p){return typeof p==='string'&&p}):[];
    var h='';
    if(ex.estimationNote)h+='<div class="proof-note">'+esc(ex.estimationNote)+'</div>';
    if(proofs.length){
      h+='<div class="proofs">'+proofs.map(function(p){
        return '<img src="'+esc(p)+'" alt="存档实拍" loading="lazy" title="点击放大">'}).join('')+'</div>';
    }
    // 白名单字段：有值才显示，用中文名。
    var keys=Object.keys(EXTRA_WHITELIST).filter(function(k){
      var v=ex[k];return v!==null&&v!==undefined&&v!==''&&!(Array.isArray(v)&&!v.length)});
    if(keys.length){
      h+=(h?'<div style="height:9px"></div>':'')+'<div class="fields">'+keys.map(function(k){
        var v=ex[k];if(Array.isArray(v))v=v.join('、');if(typeof v==='object')v=JSON.stringify(v).slice(0,60);
        if(k==='avgMinutes')v=v+' 分';
        return '<div class="f"><span class="fk">'+esc(EXTRA_WHITELIST[k])+'</span><span class="fv" title="'+esc(v)+'">'+esc(v)+'</span></div>';
      }).join('')+'</div>';
    }
    return h;
  }
  // 简介：标准字段区最后一块，另起一行。超过 90 字默认折叠 2 行，避免长简介撑开弹层。
  function descHtml(g){
    var d=g.description||'';
    if(!d)return '';
    var long=d.length>90;
    return '<div class="desc-box"><div class="dk">简介</div>'+
      '<div class="dt'+(long?' clamp':'')+'" id="desctxt">'+esc(d)+'</div>'+
      (long?'<button class="desc-toggle" id="desctoggle">展开全文 ▾</button>':'')+'</div>';
  }
  function openDlg(g){
    var s=srcOf(g),a=s.achievements||{},full=hasAch(s)&&a.total>0&&a.unlocked===a.total;
    // 第三项 = 点击切换的字段标记（act），只有 通关/分类/隐藏 三个是入口。
    // 通关展示统一「已通关/未通关」，不区分手标还是官方（Retro 才有官方通关状态）。
    var cells=[
      ['总时长',fmtMin(s.totalMinutes)],
      ['首次游玩',s.firstPlayedAt?bjDate(s.firstPlayedAt):'—'],
      ['最近游玩',s.lastPlayedAt?bjDate(s.lastPlayedAt):'—'],
      ['日历天数',s.calendarDays||0],
      ['游玩天数（源）',s.totalPlayedDays||0],
      ['启动次数',s.launchCount||0],
      ['开发商',g.developer||'—'],
      ['发行商',g.publisher||'—'],
      ['发售日',g.releaseDate||'—'],
      ['通关',g.clearStatus?'已通关':'未通关','clearStatus'],
      ['分类',s.category==='game'?'游戏':s.category==='app'?'应用':'未分类','category'],
      ['隐藏',s.hidden===true?'隐藏':'显示','hidden']
    ];
    var h='<div class="dlg-hd">'+coverHtml(g,s,full)+'<div><h2>'+esc(g.title)+
      (g.nameZh?' <span style="color:var(--t2);font-size:15px;font-weight:400">'+esc(g.nameZh)+'</span>':'')+'</h2>'+
      '<div class="sub">'+esc(subLabel(s.platform||''))+' · '+esc(g.id)+'</div></div>'+
      '<button class="close" id="dlgclose">×</button></div><div class="dlg-bd">'+
      '<div class="sec"><h3>标准字段</h3>'+
      '<div class="edit-note">通关 / 分类 / 隐藏 是可点击入口（点格子切换）。修改会保存到人工层，每日同步后写入标准数据。</div>'+
      '<div class="kv">'+cells.map(function(c){
        return '<div class="cell'+(c[2]?' act':'')+'"'+(c[2]?' data-act="'+c[2]+'" title="点击切换"':'')+'>'+
          '<div class="k">'+c[0]+'</div><div class="v">'+esc(c[1])+'</div></div>'}).join('')+'</div>'+
      descHtml(g)+'</div>';
    // 详情页顺序（用户 2026-11-16 定）：标准字段 → 平台特有字段 → 日历 → 成就。
    // 逐次会话不展示（启动次数已在标准字段格里）。
    var ex=extraHtml(s);
    if(ex)h+='<div class="sec"><h3>平台特有字段（extra）</h3>'+ex+'</div>';
    if(hasCal(s))h+='<div class="sec"><h3>日历（字段存在才渲染）</h3>'+calHtml(s,g.id)+'</div>';
    if(hasAch(s))h+='<div class="sec"><h3>成就（字段存在才渲染）</h3>'+achHtml(s)+'</div>';
    h+='</div>';
    _id('dlg').innerHTML=h;
    _id('mask').classList.add('show');
    _id('dlgclose').onclick=closeDlg;
    // 简介展开/收起：只在本弹层内切换，不影响数据
    var dt=_id('desctoggle');
    if(dt)dt.onclick=function(){
      var txt=_id('desctxt'),folded=txt.classList.toggle('clamp');
      dt.textContent=folded?'展开全文 ▾':'收起 ▴';
    };
    [].forEach.call(_all('.proofs img'),function(im){
      im.onclick=function(){im.classList.toggle('zoom')};
    });
    // 三个标准字段入口：先改内存即时反馈，再写回人工层（fetch 失败不崩，离线 PoC 仍可切换）
    [].forEach.call(_all('.cell.act'),function(cell){
      cell.onclick=function(){
        var act=cell.getAttribute('data-act'),cur=ALL.filter(function(x){return x.id===g.id})[0];
        if(!cur)return;
        var patch={};
        if(act==='clearStatus'){
          cur.clearStatus=cur.clearStatus?null:'finished';
          patch.status=cur.clearStatus==='finished'?'finished':'';
        }else if(act==='category'){
          var order=[null,'game','app'],i=order.indexOf(cur.sources[0].category||null);
          var nv=order[(i+1)%order.length];
          cur.sources[0].category=nv;
          patch.category=nv||'';
        }else if(act==='hidden'){
          cur.sources[0].hidden=cur.sources[0].hidden!==true;
          patch.hidden=cur.sources[0].hidden===true;
        }
        openDlg(cur);render();   // 即时反馈：不依赖网络，离线也能切换
        fetch('/api/custom/mark',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({key:markKeyOf(cur),patch:patch})})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
          .then(function(){openDlg(cur);render()})   // 写盘成功后再与后端对齐一次
          .catch(function(e){console.warn('[标准预览] 写回人工层失败（离线可忽略）',e)});
      };
    });
    // 月历翻月：改的是 calMonth[key]，重画当前弹层。数据仍取标准 sources[].daily。
    [].forEach.call(_all('.cal-nav'),function(b){
      b.onclick=function(){
        var key=b.getAttribute('data-cal-key'),delta=Number(b.getAttribute('data-delta'));
        var g=ALL.filter(function(x){return x.id===key})[0];
        if(!g)return;calMonth[key]=shiftMonth(calMonth[key],delta);openDlg(g);
      };
    });
  }
  function closeDlg(){_id('mask').classList.remove('show')}
  _id('mask').onclick=function(e){if(e.target.id==='mask')closeDlg()};
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDlg()});

  function render(){renderHero();renderTabs();renderSubtabs();renderSortBar();var l=visible();renderStats(l);renderList(l)}
  return { render: render, mount: function(){ applyManual(); render(); } };
})();
