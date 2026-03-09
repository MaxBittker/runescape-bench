import { html, useEffect, useRef, useState } from '../html.js';
import { navigate } from '../router.js';

export function CumulativeChart({ data }) {
  const chartRef = useRef(null);
  const legendRef = useRef(null);
  const [pinnedSkill, setPinnedSkill] = useState(null);
  const [hoveredSkill, setHoveredSkill] = useState(null);

  const activeSkill = (hoveredSkill && hoveredSkill !== '__total__') ? hoveredSkill : pinnedSkill;
  const activeLabel = activeSkill ? `${SKILL_DISPLAY[activeSkill] || activeSkill} Peak Rate` : 'Total Peak Rate';

  useEffect(() => {
    if (!data || !chartRef.current || !legendRef.current) return;
    if (!window.renderCumulativeChart) return;

    chartRef.current.innerHTML = '';
    legendRef.current.innerHTML = '';

    renderCumulativeChart({
      canvasContainer: chartRef.current,
      legendContainer: legendRef.current,
      data,
      horizonMinutes: 30,
      activeSkill,
      onClick: function(modelKey) {
        if (activeSkill) navigate('trajectory/' + modelKey + '/' + activeSkill);
        else navigate('model/' + modelKey);
      },
    });
  }, [data, activeSkill]);

  if (!data) return null;

  return html`
    <section className="section">
      <div className="container is-max-widescreen">
        <div className="columns is-centered has-text-centered">
          <div className="column">
            <h2 className="title is-3">Peak XP Rate \u2014 30 min wall clock</h2>
            <p className="subtitle is-6" style=${{ color: '#888' }}>
              Peak training rate (XP/hr) across 16 skills in 30 minutes wall clock (8x game speed). Best of 1.${' '}
              <a href="views/graph-skills.html?horizon=30m">Full interactive view \u2192</a>
            </p>
          </div>
        </div>
        <div className="benchmark-chart-wrap benchmark-chart-layout">
          <aside className="skill-rail" aria-label="Skill chart filter">
            <button
              type="button"
              className=${`skill-rail-reset${!pinnedSkill ? ' active' : ''}${hoveredSkill === '__total__' ? ' hovered' : ''}`}
              onClick=${() => { setPinnedSkill(null); setHoveredSkill(null); }}
              onMouseEnter=${() => { if (pinnedSkill) setHoveredSkill('__total__'); }}
              onMouseLeave=${() => { if (hoveredSkill === '__total__') setHoveredSkill(null); }}
            >
              Total
            </button>
            <div
              className="skill-rail-grid"
              onMouseLeave=${() => setHoveredSkill(null)}
            >
              ${SKILL_ORDER.map((skill) => {
                const label = SKILL_DISPLAY[skill] || skill;
                const iconSrc = VIEWS_BASE + 'skill-icons/' + skill + '.png';
                const isPinned = pinnedSkill === skill;
                const isHovered = hoveredSkill === skill;
                const className = [
                  'skill-rail-item',
                  isPinned ? ' active-hard' : '',
                  isHovered ? ' active-soft' : '',
                ].filter(Boolean).join(' ');
                return html`
                  <button
                    key=${skill}
                    type="button"
                    className=${className}
                    title=${label}
                    aria-label=${label}
                    onMouseEnter=${() => setHoveredSkill(skill)}
                    onFocus=${() => setHoveredSkill(skill)}
                    onClick=${() => {
                      setPinnedSkill((current) => current === skill ? null : skill);
                      setHoveredSkill(null);
                    }}
                  >
                    <img src=${iconSrc} alt=${label} />
                  </button>
                `;
              })}
            </div>
          </aside>
          <div className="benchmark-chart-main">
            <div className="benchmark-chart-label">${activeLabel}</div>
            <div ref=${chartRef}></div>
          </div>
        </div>
        <div className="bottom-legend" ref=${legendRef}></div>
      </div>
    </section>
  `;
}
