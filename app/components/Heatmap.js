import { html, useMemo } from '../html.js';
import { navigate } from '../router.js';

// Normalize XP/hr → display units (÷60 for per-minute, ÷25, ÷8)
function normRate(xpPerHr) {
  return xpPerHr / 12000;
}

function formatNorm(v, pad) {
  return String(Math.round(v)).padStart(pad || 1, '\u2007');
}

const TIERS = {
  zero: { bg: '#e8e8e8', color: '#aaa' },
  low:  { bg: '#c8e6c9', color: '#2e5e3e' },
  mid:  { bg: '#81c784', color: '#1a3d1f' },
  high: { bg: '#43a047', color: '#fff' },
};

function cellTier(rate, maxRate) {
  if (rate <= 0 || maxRate <= 0) return TIERS.zero;
  const t = rate / maxRate;
  if (t >= 0.9) return TIERS.high;
  if (t >= 0.5) return TIERS.mid;
  return TIERS.low;
}

function peakRateAtHorizon(skillData, skill) {
  if (!skillData) return 0;
  return skillData.peakXpRate || 0;
}

export function Heatmap({ data }) {
  const { models, skillOrder, skillMax, skillPad } = useMemo(() => {
    if (!data) return { models: [], skillOrder: [], skillMax: {} };

    const models = Object.keys(data).map(key => {
      const skills = {};
      let sum = 0;
      let count = 0;
      for (const skill of SKILL_ORDER) {
        const rate = peakRateAtHorizon(data[key]?.[skill], skill);
        skills[skill] = rate;
        sum += rate;
        count++;
      }
      return { key, avgRate: sum / count, skills };
    });

    models.sort((a, b) => b.avgRate - a.avgRate);

    const skillOrder = SKILL_ORDER.slice().sort((a, b) => {
      const avgA = models.reduce((s, m) => s + m.skills[a], 0) / models.length;
      const avgB = models.reduce((s, m) => s + m.skills[b], 0) / models.length;
      return avgB - avgA;
    });

    const skillMax = {};
    const skillPad = {};
    for (const skill of skillOrder) {
      skillMax[skill] = Math.max(...models.map(m => m.skills[skill]));
      const maxDigits = Math.max(...models.map(m => String(Math.round(normRate(m.skills[skill]))).length));
      skillPad[skill] = maxDigits;
    }

    return { models, skillOrder, skillMax, skillPad };
  }, [data]);

  if (!data || models.length === 0) return null;

  function handleCellClick(modelKey, skill) {
    const sd = data[modelKey]?.[skill];
    if (sd?.trajectory?.length > 0) {
      navigate('trajectory/' + modelKey + '/' + skill);
    } else {
      navigate('model/' + modelKey);
    }
  }

  return html`
    <section className="section">
      <div className="container is-max-widescreen">
        <div className="columns is-centered has-text-centered">
          <div className="column">
            <h2 className="title is-3">Per-Skill Breakdown</h2>
            <p className="subtitle is-6" style=${{ color: '#888' }}>
              Normalized peak XP rate per skill per model. Best of 1. Color = relative ranking within each column.
            </p>
          </div>
        </div>
        <div className="heatmap-scroll">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th style=${{ textAlign: 'left' }}>Model</th>
                ${skillOrder.map(skill => html`
                  <th key=${skill} title=${SKILL_DISPLAY[skill]}>
                    <img src=${VIEWS_BASE + 'skill-icons/' + skill + '.png'}
                         alt=${SKILL_DISPLAY[skill]} width="16" height="16" />
                  </th>
                `)}
                <th style=${{ fontWeight: 700 }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              ${models.map(m => {
                const cfg = MODEL_CONFIG[m.key];
                if (!cfg) return null;
                return html`
                  <tr key=${m.key}>
                    <td className="heatmap-model"
                        onClick=${() => navigate('model/' + m.key)}
                        style=${{ cursor: 'pointer' }}>
                      <img src=${cfg.icon} alt="" />
                      <span>${cfg.shortName}</span>
                    </td>
                    ${skillOrder.map(skill => {
                      const rate = m.skills[skill];
                      const s = cellTier(rate, skillMax[skill]);
                      return html`
                        <td key=${skill}
                            style=${{ background: s.bg, color: s.color, fontVariantNumeric: 'tabular-nums', cursor: 'pointer', fontSize: '11px' }}
                            onClick=${() => handleCellClick(m.key, skill)}>
                          ${formatNorm(normRate(rate), skillPad[skill])}
                        </td>
                      `;
                    })}
                    <td className="heatmap-total">${formatNorm(normRate(m.avgRate))}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}
