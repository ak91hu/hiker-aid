const HikerElevation = (() => {
  let chart = null;
  let profileData = [];
  let onHoverCallback = null;

  function gradientColor(pct) {
    if (pct < -15) return '#0077B6';
    if (pct < -8)  return '#00B4D8';
    if (pct < -2)  return '#90E0EF';
    if (pct <  2)  return '#74C69D';
    if (pct <  8)  return '#B7E4C7';
    if (pct < 15)  return '#F9C74F';
    if (pct < 25)  return '#F4A261';
    return '#E76F51';
  }

  function build(profile) {
    if (!profile || profile.length === 0) return;
    profileData = profile;

    const canvas = document.getElementById('elevation-chart');
    const ctx = canvas.getContext('2d');

    if (chart) { chart.destroy(); chart = null; }

    const gradData = profile.map(p => p.gradientPct);
    const xyData   = profile.map(p => ({ x: p.distanceKm, y: p.elevationM }));

    const fillGradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 120);
    fillGradient.addColorStop(0,   'rgba(64,145,108,0.4)');
    fillGradient.addColorStop(1,   'rgba(13,31,13,0.0)');

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          data: xyData,
          fill: true,
          backgroundColor: fillGradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#74C69D',
          tension: 0.3,
          segment: {
            borderColor: ctx => gradientColor(gradData[ctx.p0DataIndex] || 0)
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(21,32,21,0.95)',
            borderColor: 'rgba(116,198,157,0.3)',
            borderWidth: 1,
            titleColor: '#74C69D',
            bodyColor: '#e8f5e9',
            padding: 8,
            callbacks: {
              title: items => `${items[0].parsed.x} km`,
              label: item => {
                const idx = item.dataIndex;
                const g = gradData[idx];
                const dir = g > 0 ? '▲' : g < 0 ? '▼' : '→';
                return [`${Math.round(item.parsed.y)} m  ${dir} ${Math.abs(g).toFixed(1)}%`];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              color: '#8aab8a',
              font: { size: 10 },
              maxTicksLimit: 6,
              callback: v => `${v} km`
            },
            grid: { color: 'rgba(116,198,157,0.08)' },
            border: { color: 'rgba(116,198,157,0.15)' }
          },
          y: {
            ticks: {
              color: '#8aab8a',
              font: { size: 10 },
              maxTicksLimit: 4,
              callback: v => `${v}m`
            },
            grid: { color: 'rgba(116,198,157,0.08)' },
            border: { color: 'rgba(116,198,157,0.15)' }
          }
        },
        onHover: (event, elements) => {
          if (elements.length > 0 && onHoverCallback) {
            const idx = elements[0].index;
            onHoverCallback(idx, profileData[idx]);
          }
        }
      }
    });
  }

  function setHoverCallback(fn) { onHoverCallback = fn; }

  function showHoverInfo(profilePoint) {
    const el = document.getElementById('hover-info');
    if (!profilePoint || !el) return;
    const g = profilePoint.gradientPct;
    const dir = g > 0.5 ? '▲' : g < -0.5 ? '▼' : '→';
    el.textContent = `${profilePoint.distanceKm} km · ${Math.round(profilePoint.elevationM)} m · ${dir}${Math.abs(g).toFixed(1)}%`;
  }

  function clearHoverInfo() {
    const el = document.getElementById('hover-info');
    if (el) el.textContent = '';
  }

  function highlightIndex(idx) {
    if (!chart || idx < 0 || idx >= profileData.length) return;
    chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
    chart.update('none');
  }

  function clearHighlight() {
    if (!chart) return;
    chart.setActiveElements([]);
    chart.update('none');
  }

  function getProfileLength() { return profileData.length; }

  return { build, setHoverCallback, showHoverInfo, clearHoverInfo, highlightIndex, clearHighlight, getProfileLength };
})();
