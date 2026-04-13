import sys

with open('batch/master-ranked-jobs.html', 'r') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if '<style>' in line:
        start_idx = i
    if '</style>' in line:
        end_idx = i
        break

m3_css = """  <style>
    :root {
      /* M3 Light Theme */
      --md-bg: #F8F9FA;
      --md-on-bg: #1A1C1E;
      --md-surface: #FDFBFF;
      --md-surface-container: #F1F4FA;
      --md-surface-container-high: #E1E7F0;
      --md-on-surface: #1A1C1E;
      --md-on-surface-variant: #43474E;
      --md-outline: #73777F;
      --md-outline-variant: #C3C7CF;
      
      --md-primary: #0061A4;
      --md-on-primary: #FFFFFF;
      --md-primary-container: #D1E4FF;
      --md-on-primary-container: #001D36;
      
      --md-secondary-container: #D7E3F7;
      --md-on-secondary-container: #101C2B;
      
      --md-tertiary-container: #EBDDFF;
      --md-on-tertiary-container: #250A54;
      
      --md-success: #2d9d78;
      --md-success-container: #c6f1de;
      
      /* Radii */
      --radius-s: 8px;
      --radius-m: 12px;
      --radius-l: 16px;
      --radius-xl: 24px;
      --radius-full: 9999px;
    }
    body[data-theme="dark"] {
      /* M3 Dark Theme (Deep Blue focus) */
      --md-bg: #090E17;
      --md-on-bg: #E2E2E6;
      --md-surface: #101828;
      --md-surface-container: #172136;
      --md-surface-container-high: #1E293B;
      --md-on-surface: #E2E2E6;
      --md-on-surface-variant: #C3C7CF;
      --md-outline: #8D9199;
      --md-outline-variant: #334155;
      
      --md-primary: #9ECAEB;
      --md-on-primary: #003258;
      --md-primary-container: #00497D;
      --md-on-primary-container: #D1E4FF;
      
      --md-secondary-container: #37475A;
      --md-on-secondary-container: #D7E3F7;
      
      --md-tertiary-container: #4F378B;
      --md-on-tertiary-container: #EADDFF;
      
      --md-success: #34d399;
      --md-success-container: #0a251a;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Manrope", "Segoe UI", sans-serif;
      color: var(--md-on-bg);
      background: var(--md-bg);
      min-height: 100vh;
      padding: 24px 16px 48px;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .container { width: min(1200px, 100%); margin: 0 auto; }
    .hero {
      border: 1px solid var(--md-outline-variant);
      border-radius: var(--radius-xl);
      background: var(--md-surface);
      padding: 32px clamp(20px, 3vw, 40px);
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }
    body[data-theme="dark"] .hero { box-shadow: none; border-color: transparent; background: var(--md-surface-container); }
    h1 {
      margin: 0 0 8px 0;
      font-family: "Space Grotesk", sans-serif;
      font-size: clamp(1.8rem, 3vw, 2.5rem);
      letter-spacing: -0.02em;
      line-height: 1.1;
      max-width: 18ch;
      color: var(--md-on-surface);
    }
    .hero-top { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    
    /* M3 Tonal Button */
    .theme-toggle {
      border: none;
      border-radius: var(--radius-full);
      background: var(--md-surface-container-high);
      color: var(--md-on-surface);
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 16px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.2s ease;
    }
    .theme-toggle:hover { background: var(--md-outline-variant); }
    body[data-theme="dark"] .theme-toggle:hover { background: var(--md-outline-variant); }
    
    .subtitle { margin: 0; color: var(--md-on-surface-variant); font-weight: 500; max-width: 72ch; line-height: 1.5; }
    .stats {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      margin-top: 24px;
    }
    .stat {
      border-radius: var(--radius-l);
      padding: 12px 16px;
      background: var(--md-surface);
      border: 1px solid var(--md-outline-variant);
    }
    body[data-theme="dark"] .stat { border-color: transparent; background: var(--md-surface-container-high); }
    .stat .label { display: block; color: var(--md-on-surface-variant); font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 600; }
    .stat .value { font-family: "Space Grotesk", sans-serif; font-size: 1.4rem; font-weight: 700; margin-top: 4px; color: var(--md-primary); }
    
    .controls {
      position: sticky;
      top: 12px;
      z-index: 4;
      border-radius: var(--radius-xl);
      background: var(--md-surface-container);
      padding: 16px;
      margin-bottom: 24px;
      border: 1px solid var(--md-outline-variant);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }
    body[data-theme="dark"] .controls { border-color: transparent; box-shadow: 0 8px 16px rgba(0,0,0,0.4); background: var(--md-surface-container); }
    
    .controls-grid {
      display: grid;
      grid-template-columns: 1.8fr 1fr 1fr 1fr 1fr;
      gap: 12px;
    }
    .control { display: flex; flex-direction: column; gap: 6px; }
    .control label { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.03em; color: var(--md-on-surface-variant); }
    
    /* M3 Outlined Text Field */
    .control input, .control select {
      border: 1px solid var(--md-outline);
      border-radius: var(--radius-s);
      background: var(--md-surface);
      color: var(--md-on-surface);
      min-height: 48px;
      padding: 0 16px;
      font: inherit;
      font-size: 0.95rem;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
    }
    .control input:focus, .control select:focus {
      outline: none;
      border-color: var(--md-primary);
      box-shadow: 0 0 0 1px var(--md-primary);
    }
    .control-inline { display: flex; align-items: center; gap: 8px; min-height: 48px; }
    .control-inline input { width: auto; min-height: auto; }
    .score-pill { font-family: "Space Grotesk", sans-serif; font-weight: 700; color: var(--md-on-primary-container); background: var(--md-primary-container); border-radius: var(--radius-full); padding: 2px 8px; margin-left: 4px; display: inline-block; }
    
    .result-meta {
      margin: 12px 4px 0;
      color: var(--md-on-surface-variant);
      font-weight: 500;
      font-size: 0.95rem;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .job-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
    
    /* M3 Outlined/Elevated Card */
    .job-card {
      position: relative;
      border-radius: var(--radius-l);
      border: 1px solid var(--md-outline-variant);
      background: var(--md-surface);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .job-card:hover { 
      background: var(--md-surface-container);
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    body[data-theme="dark"] .job-card { background: var(--md-surface-container); border-color: transparent; }
    body[data-theme="dark"] .job-card:hover { background: var(--md-surface-container-high); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
    
    .job-card.applied { border-color: var(--md-success); background: var(--md-success-container); }
    body[data-theme="dark"] .job-card.applied { background: var(--md-success-container); border-color: var(--md-success); }
    
    .card-head { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
    
    /* M3 Badge / Chips */
    .rank-chip {
      font-family: "Space Grotesk", sans-serif;
      background: var(--md-tertiary-container);
      color: var(--md-on-tertiary-container);
      border-radius: var(--radius-full);
      padding: 6px 12px;
      font-size: .8rem;
      font-weight: 700;
      white-space: nowrap;
    }
    
    .track-chip {
      background: var(--md-secondary-container);
      color: var(--md-on-secondary-container);
      border-radius: var(--radius-s);
      padding: 4px 8px;
      font-size: .75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .03em;
    }
    
    .job-company { font-size: 0.85rem; color: var(--md-on-surface-variant); text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
    .job-title { margin: 0; font-size: 1.1rem; line-height: 1.4; color: var(--md-on-surface); font-weight: 700; }
    .job-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
    
    .job-score {
      font-family: "Space Grotesk", sans-serif;
      background: var(--md-primary-container);
      color: var(--md-on-primary-container);
      border-radius: var(--radius-full);
      padding: 4px 10px;
      font-size: 0.8rem;
      font-weight: 700;
    }
    
    .actions { display: flex; align-items: center; gap: 8px; }
    
    /* M3 Filled Button */
    .apply-btn {
      border: none;
      border-radius: var(--radius-full);
      text-decoration: none;
      background: var(--md-primary);
      color: var(--md-on-primary);
      font-weight: 600;
      font-size: .85rem;
      padding: 10px 18px;
      transition: filter 0.2s ease, box-shadow 0.2s ease;
    }
    .apply-btn:hover { filter: brightness(1.1); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    
    /* M3 Outlined Button */
    .apply-mark {
      border: 1px solid var(--md-outline);
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--md-on-surface);
      font-weight: 600;
      font-size: .85rem;
      padding: 10px 18px;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    .apply-mark:hover { background: var(--md-surface-container-high); }
    
    .empty-state {
      display: none;
      border: 2px dashed var(--md-outline-variant);
      border-radius: var(--radius-xl);
      background: var(--md-surface);
      padding: 40px 20px;
      text-align: center;
      color: var(--md-on-surface-variant);
      margin-top: 16px;
      font-weight: 500;
    }
    body[data-theme="dark"] .empty-state { border-color: var(--md-outline-variant); background: var(--md-surface-container); }
    
    .load-more-wrap { display: flex; justify-content: center; margin-top: 24px; }
    
    /* M3 Tonal Button */
    .load-more-btn {
      border: none;
      border-radius: var(--radius-full);
      background: var(--md-secondary-container);
      color: var(--md-on-secondary-container);
      font-family: "Space Grotesk", sans-serif;
      font-weight: 700;
      font-size: .95rem;
      padding: 12px 24px;
      cursor: pointer;
      transition: filter 0.2s ease;
    }
    .load-more-btn:hover { filter: brightness(0.95); }
    body[data-theme="dark"] .load-more-btn:hover { filter: brightness(1.15); }
    
    @media (max-width: 1100px) { .controls-grid { grid-template-columns: 1fr 1fr 1fr; } }
    @media (max-width: 980px) { .controls-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 720px) {
      body { padding: 16px 12px 36px; }
      .hero { border-radius: var(--radius-l); padding: 20px; }
      .controls { top: 8px; border-radius: var(--radius-l); padding: 16px; }
      .controls-grid { grid-template-columns: 1fr; }
      .job-grid { grid-template-columns: 1fr; }
    }
  </style>
"""

new_lines = lines[:start_idx] + [m3_css] + lines[end_idx+1:]
with open('batch/master-ranked-jobs.html', 'w') as f:
    f.writelines(new_lines)
