(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // ---- Mermaid init ----
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'base', securityLevel: 'loose',
      themeVariables: {
        primaryColor: '#ffffff', primaryTextColor: ink, primaryBorderColor: accent,
        lineColor: accent, secondaryColor: bg2, tertiaryColor: bg2, fontSize: '14px'
      }
    });
  }

  // ---- Chart 1: Dev-log issue distribution (horizontal bar) ----
  var el1 = document.getElementById('chart-issues');
  if (el1 && window.echarts) {
    var c1 = echarts.init(el1, null, { renderer: 'svg' });
    var cats = ['内存与资源管理', '渲染稳定性（空白/裂图）', 'UI/UX 体验', '智能排版引擎', '工程化与构建'];
    var vals = [8, 9, 5, 4, 4];
    var colors = [accent2, accent, '#b45309', '#15803d', muted];
    c1.setOption({
      animation: false,
      grid: { left: 130, right: 50, top: 24, bottom: 28, containLabel: false },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, appendToBody: true,
        formatter: function (p) { return p[0].name + '：' + p[0].value + ' 轮修复'; } },
      xAxis: { type: 'value', max: 10, splitLine: { lineStyle: { color: rule } },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 11 } },
      yAxis: { type: 'category', data: cats, inverse: true,
        axisLine: { lineStyle: { color: rule } }, axisTick: { show: false },
        axisLabel: { color: ink, fontSize: 12, fontWeight: 600 } },
      series: [{
        type: 'bar', data: vals.map(function (v, i) { return { value: v, itemStyle: { color: colors[i], borderRadius: [0, 6, 6, 0] } }; }),
        barWidth: 22,
        label: { show: true, position: 'right', color: ink, fontWeight: 700, formatter: '{c} 轮' }
      }]
    });
    window.addEventListener('resize', function () { c1.resize(); });
  }

  // ---- Chart 2: Priority matrix (scatter, effort x impact) ----
  var el2 = document.getElementById('chart-priority');
  if (el2 && window.echarts) {
    var c2 = echarts.init(el2, null, { renderer: 'svg' });

    // [effort, impact, name, group]
    var items = [
      [2.0, 4.3, '端到端集成测试', 'win'],
      [1.6, 3.2, '死代码治理 CI', 'win'],
      [2.2, 3.0, 'AI 评分可视化', 'win'],
      [2.5, 4.0, 'Freemium 分层', 'win'],
      [4.8, 4.8, '缓存架构重构', 'strat'],
      [4.5, 4.9, '印刷履约闭环', 'strat'],
      [4.0, 4.1, '云同步备份', 'strat'],
      [3.8, 4.0, '生成式 AI 配文', 'strat'],
      [3.6, 3.3, '智能美化/抠图', 'mid'],
      [3.5, 3.4, '视频相册导出', 'mid'],
      [2.6, 2.9, '图文记录', 'mid'],
      [2.2, 2.6, 'macOS 完善', 'mid'],
      [4.0, 2.9, 'Web 轻版', 'hold'],
      [4.8, 2.8, '移动端原生', 'hold'],
      [4.0, 2.7, '模板素材市场', 'hold'],
      [4.2, 2.6, '影楼 B 端', 'hold']
    ];
    var grpColor = { win: '#15803d', strat: accent, mid: muted, hold: '#b91c1c' };
    var grpName = { win: '速赢（先做）', strat: '战略投入', mid: '常规推进', hold: '暂缓/评估' };
    var groups = ['win', 'strat', 'mid', 'hold'];
    var series = groups.map(function (g) {
      return {
        name: grpName[g], type: 'scatter',
        data: items.filter(function (it) { return it[3] === g; }).map(function (it) { return [it[0], it[1], it[2]]; }),
        symbolSize: 22,
        itemStyle: { color: grpColor[g], opacity: 0.88, borderColor: '#fff', borderWidth: 2, shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.12)' },
        label: { show: true, position: 'top', color: ink, fontSize: 11, fontWeight: 600, formatter: function (p) { return p.data[2]; } }
      };
    });

    c2.setOption({
      animation: false,
      legend: { top: 4, right: 10, textStyle: { color: muted, fontSize: 11 }, itemWidth: 12, itemHeight: 12 },
      grid: { left: 56, right: 30, top: 50, bottom: 50, containLabel: true },
      tooltip: { trigger: 'item', appendToBody: true,
        formatter: function (p) { return '<b>' + p.data[2] + '</b><br/>投入：' + p.data[0] + ' / 5<br/>影响：' + p.data[1] + ' / 5'; } },
      xAxis: { name: '投入（1 低 → 5 高）', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: muted, fontSize: 12 },
        min: 1, max: 5, interval: 1, type: 'value', scale: true,
        splitLine: { lineStyle: { color: rule, type: 'dashed' } },
        axisLine: { lineStyle: { color: rule } }, axisLabel: { color: muted } },
      yAxis: { name: '影响（1 低 → 5 高）', nameLocation: 'middle', nameGap: 38, nameTextStyle: { color: muted, fontSize: 12 },
        min: 2, max: 5, interval: 1, type: 'value', scale: true,
        splitLine: { lineStyle: { color: rule, type: 'dashed' } },
        axisLine: { lineStyle: { color: rule } }, axisLabel: { color: muted } },
      series: series,
      // quadrant guides
      markLine: {
        symbol: 'none', silent: true, animation: false,
        data: [{ xAxis: 3, lineStyle: { color: accent, type: 'dashed', opacity: 0.4 } },
        { yAxis: 3, lineStyle: { color: accent, type: 'dashed', opacity: 0.4 } }]
      }
    });
    // attach markLine to first series properly
    c2.setOption({ series: [{ markLine: { symbol: 'none', silent: true, animation: false, data: [{ xAxis: 3, lineStyle: { color: accent, type: 'dashed', opacity: 0.45, width: 1.5 } }, { yAxis: 3, lineStyle: { color: accent, type: 'dashed', opacity: 0.45, width: 1.5 } }] } }] });
    window.addEventListener('resize', function () { c2.resize(); });
  }
})();
