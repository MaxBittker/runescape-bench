import { html, useEffect } from '../html.js';
import { navigate, closeModal } from '../router.js';

export function SkillPicker({ model, data }) {
  const config = MODEL_CONFIG[model] || { displayName: model, color: '#999' };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return html`
    <div className="modal-backdrop skill-picker"
         onClick=${(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="skill-picker-inner">
        <div style=${{ padding: '16px 24px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style=${{ fontSize: '16px', fontWeight: 600, margin: 0 }}>${config.displayName}</h3>
          <button onClick=${closeModal} className="close-btn">\u00d7</button>
        </div>
        <div className="skill-picker-grid" style=${{ overflowY: 'auto', flex: 1 }}>
          ${SKILL_ORDER.map(skill => {
            const sd = data?.[model]?.[skill];
            const rate = sd?.peakXpRate || 0;
            const hasTraj = sd?.trajectory?.length > 0;
            const iconSrc = VIEWS_BASE + 'skill-icons/' + skill + '.png';
            return html`
              <div key=${skill}
                   className=${`skill-picker-item${hasTraj ? '' : ' no-traj'}`}
                   onClick=${hasTraj ? () => navigate('trajectory/' + model + '/' + skill) : undefined}>
                <img src=${iconSrc} onError=${(e) => { e.target.style.display = 'none'; }} />
                ${SKILL_DISPLAY[skill] || skill}
                <span className="skill-picker-xp">${rate > 0 ? formatRate(rate) : '-'}</span>
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}
