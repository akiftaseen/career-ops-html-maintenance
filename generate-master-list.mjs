#!/usr/bin/env node

/**
 * Generate a comprehensive ranked list of ALL jobs in the pipeline
 * Output: Single markdown file with all jobs ranked by priority (best first)
 * User can work through top-to-bottom continuously
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const PIPELINE_PATH = 'data/pipeline.md';
const OUT_MARKDOWN = 'batch/master-ranked-jobs.md';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanCompanyLabel(rawCompany) {
  let company = decodeBasicEntities(rawCompany)
    .replace(/\s+/g, ' ')
    .trim();

  // Common LinkedIn scraping wrappers.
  company = company
    .replace(/^(.+?)\s+hiring\s+.+?\s+in\s+hong\s*kong(?:,\s*hong\s*kong\s*sar)?\s*\/?$/i, '$1')
    .replace(/^(.+?)\s+in\s+hong\s*kong(?:,\s*hong\s*kong\s*sar)?\s*\/?$/i, '$1');

  // Remove trailing visual separators from some boards.
  company = company
    .replace(/\s*[\/|]\s*$/g, '')
    .replace(/^\((hk|hong\s*kong)\)$/i, '')
    .trim();

  // Guard against accidental URL capture in company field.
  if (/^https?:\/\//i.test(company)) {
    return '';
  }

  return company;
}

function humanizeSlug(text) {
  return text
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function deriveLinkedInMeta(url) {
  try {
    const u = new URL(url);
    if (!/linkedin\.com$/i.test(u.hostname) && !/linkedin\.com/i.test(u.hostname)) return null;
    const part = u.pathname.split('/jobs/view/')[1];
    if (!part) return null;

    const decoded = decodeURIComponent(part).replace(/\/$/, '');
    const noId = decoded.replace(/-\d+$/, '');
    const atIndex = noId.lastIndexOf('-at-');
    if (atIndex === -1) return null;

    const titleSlug = noId.slice(0, atIndex);
    const companySlug = noId.slice(atIndex + 4);

    const title = humanizeSlug(titleSlug);
    const company = humanizeSlug(companySlug);
    if (!title || !company) return null;

    return { title, company };
  } catch {
    return null;
  }
}

function inferCompanyFromTitleSuffix(title) {
  const parts = title.split(/\s+-\s+/);
  if (parts.length < 2) return null;

  const candidate = parts[parts.length - 1].trim();
  if (candidate.length < 3 || candidate.length > 96) return null;

  const looksLikeCompany =
    /\b(limited|ltd|inc|co\.?|company|group|holdings?|technology|technologies|solutions|university|college|school|bank|hospital)\b/i.test(candidate)
    || /^[A-Z][A-Za-z0-9&().,'/\-\s]{3,}$/.test(candidate);

  return looksLikeCompany ? candidate : null;
}

function parsePendingJobs(pipelineText) {
  const rows = [];
  const lines = pipelineText.split('\n');

  for (const line of lines) {
    const m = line.match(/^- \[ \] (https?:\/\/\S+)\s*\|\s*([^|]+)\|\s*(.+)$/);
    if (!m) continue;

    const url = m[1].trim();
    let company = m[2].trim();
    let title = m[3].trim();

    if (company === 'Extra Roles' || company === 'LinkedIn HK') {
      const linkedInMeta = deriveLinkedInMeta(url);
      if (linkedInMeta) {
        company = linkedInMeta.company;
        if (/ui\/ux, tutor, support|software engineering \(hk, english\)|role from/i.test(title)) {
          title = linkedInMeta.title;
        }
      }
    }

    rows.push({ url, company, title });
  }

  return rows;
}

function normalizeSourceFields(job) {
  let { url, company, title } = job;
  const lowerUrl = url.toLowerCase();

  company = cleanCompanyLabel(company);
  title = decodeBasicEntities(title).replace(/\s+/g, ' ').trim();

  const noisyCompany = /^(hk|jobsdb hk|linkedin hk|indeed hk|extra roles)$/i.test(company)
    || /(welcome|experience|must|looking|responsible|up to|our client|including|with|for)/i.test(company) && /^[a-z0-9\s().,'&/+-]{6,}$/i.test(company);

  if (lowerUrl.includes('hk.jobsdb.com/job/')) {
    title = title.replace(/\s+Job in\s+.+$/i, '').trim();
    if (/job in|district|hong kong sar/i.test(company) || /^(extra roles|undergraduate level)$/i.test(company) || noisyCompany) {
      company = 'JobsDB HK';
    }
  }

  if (lowerUrl.includes('linkedin.com/jobs/view/')) {
    const linkedInMeta = deriveLinkedInMeta(url);
    if (linkedInMeta && (/^sign up$/i.test(title) || /software engineering \(hk, english\)/i.test(title) || /^(hk|linkedin hk|jobsdb hk|extra roles)$/i.test(company))) {
      title = linkedInMeta.title || title;
      company = linkedInMeta.company || company;
    }

    const hiringMatch = title.match(/hiring\s+(.+?)\s+in\s+/i);
    if (hiringMatch?.[1]) {
      title = hiringMatch[1].trim();
    }

    // LinkedIn occasionally returns generic pages that pollute title fields.
    if (/^(sign up|join now|apply now)$/i.test(title) && linkedInMeta?.title) {
      title = linkedInMeta.title;
    }
  }

  // Trim obvious trailing boilerplate from titles.
  title = title
    .replace(/\s+\|\s+[^|]{0,60}$/i, '')
    .replace(/\s+\([^)]*ref[:\s]?\d+[^)]*\)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Some scraped company fields are actually requirement sentences or title fragments.
  const sentenceLikeCompany = /^[a-z][a-z0-9\s,.'()\-\/&+]{24,}$/i.test(company)
    && /(welcome|fresh grad|responsible|experience|salary|bonus|required|including|candidate|holder|with|must)/i.test(company);

  const lowSignalCompany = /^(fresh graduate welcome|undergraduate level|full time|part time|contract post|immediate start)$/i.test(company);
  const malformedLowercasePhrase = /^[a-z]/.test(company) && company.trim().split(/\s+/).length >= 5;
  const lowerStarts = /^[a-z]/.test(company);
  const genericLeadPhrase = lowerStarts && /^(a|an|the|you|your|our|other|different|global|directly|support|work|training|creative|marketing|curricula|grade-level|pastoral|quality|product|fit|immersive|talent|parents|teachers|stores|design|tester)\b/i.test(company);
  const hkWrappedPhrase = /hong\s*kong\s*sar\s*\/?$/i.test(company) || /\bhiring\b.+\bin\s+hong\s*kong\b/i.test(company);
  const obviousPlaceholder = /^(jobsdb hk|ctgoodjobs hk|indeed hk|efinancialcareers hk|talent\.gov\.hk)$/i.test(company);
  const explicitNoiseCompany = /^(patience and care|rapid growth|us!|english|an|work|support|design|stores|tester|parents|teachers)$/i.test(company);
  const tooShortCompany = company.length > 0 && company.length <= 2;
  const inferredCompany = inferCompanyFromTitleSuffix(title);

  if (sentenceLikeCompany || lowSignalCompany || malformedLowercasePhrase || genericLeadPhrase || hkWrappedPhrase || obviousPlaceholder || explicitNoiseCompany || tooShortCompany || !company) {
    if (inferredCompany) {
      company = cleanCompanyLabel(inferredCompany);
      title = title.replace(/\s+-\s+[^-]+$/, '').trim();
    } else if (lowerUrl.includes('jobs.ctgoodjobs.hk/job/')) {
      company = 'CTgoodjobs HK';
    } else if (lowerUrl.includes('efinancialcareers.hk/')) {
      company = 'eFinancialCareers HK';
    } else if (lowerUrl.includes('talent.gov.hk')) {
      company = 'Talent.gov.hk';
    } else 
    if (lowerUrl.includes('hk.jobsdb.com/job/')) {
      company = 'JobsDB HK';
    } else if (lowerUrl.includes('linkedin.com/jobs/view/')) {
      const linkedInMeta = deriveLinkedInMeta(url);
      company = cleanCompanyLabel(linkedInMeta?.company || 'LinkedIn HK');
    } else if (lowerUrl.includes('indeed.com')) {
      company = 'Indeed HK';
    }
  }

  // If title was polluted with company suffix after dash, strip duplicated company hints.
  if (company && title.toLowerCase().includes(company.toLowerCase())) {
    title = title.replace(new RegExp(`\\s*-\\s*${escapeRegex(company)}\\s*$`, 'i'), '').trim();
  }

  return { ...job, company, title };
}

function normalizeForKey(text) {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|inc|llc|co\.?|company|group|technology|technologies|international|holdings?)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(hong\s*kong|hk|remote|onsite|hybrid|full\s*time|part\s*time)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticTitleKey(title) {
  return normalizeForKey(title)
    .replace(/\b(senior|jr|junior|associate|lead|principal|staff)\b/g, ' ')
    .replace(/\b(new\s*grad|graduate|entry\s*level|fresh)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourcePriority(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('hk.jobsdb.com/job/')) return 6;
  if (u.includes('linkedin.com/jobs/view/')) return 5;
  if (u.includes('jobs.ctgoodjobs.hk/job/')) return 4;
  if (u.includes('talent.gov.hk')) return 3;
  if (u.includes('indeed.com/viewjob')) return 2;
  return 1;
}

function buildSemanticKey(job) {
  const c = normalizeForKey(job.company);
  const t = semanticTitleKey(job.title);
  if (!t) return `${c}::${normalizeForKey(job.url)}`;
  return `${c}::${t}`;
}

function scoreJob(job) {
  const hay = `${job.company} ${job.title} ${job.url}`.toLowerCase();
  let score = 0;

  // Fast-hire tracks for immediate income.
  if (/(tutor|teaching assistant|teacher|instructor|learning support)/.test(hay)) score += 38;
  if (/(it support|helpdesk|service desk|technical support|operations assistant|admin assistant|customer support)/.test(hay)) score += 32;
  if (/(ui\/ux|ux designer|user experience|ui designer|product designer|graphic designer|web designer)/.test(hay)) score += 26;
  if (/(software engineer|developer|full[ -]?stack|frontend|front[ -]?end|backend|back[ -]?end|analyst programmer)/.test(hay)) score += 22;

  // CV stack signal.
  if (/(react|typescript|node|python|c\+\+|embedded)/.test(hay)) score += 16;

  // Highly prefer realistic junior/fresh grad roles.
  if (/(graduate|junior|entry level|associate|trainee|fresh|0-2 years|1-2 years)/.test(hay)) score += 35;

  // Quick-start and flexible roles are useful for urgent income.
  if (/(contract|part[ -]?time|temporary|temp|immediate|urgent)/.test(hay)) score += 14;

  // Geography and work mode alignment.
  if (hasHongKongSignal(hay)) score += 24;
  if (hasRemoteSignal(hay)) score += 10;

  // English-only preference: down-rank explicit language requirements
  if (/(german|french|spanish|italian|arabic|mandarin|cantonese|japanese|korean|chinese speaking|native chinese)/.test(hay)) score -= 100;

  // Heavy penalty for senior roles (very low chance for a fresh grad)
  if (/(senior|lead|principal|staff|director|manager|vp|vice president|head of)/.test(hay)) score -= 70;

  // Hard-to-land specialist roles are deprioritized for immediate employment.
  if (/(quant|hpc|principal engineer|architect|phd|postdoc|research scientist|10\+ years)/.test(hay)) score -= 25;

  // Avoid internship-only postings
  if (/(intern|internship|summer internship)/.test(hay)) score -= 35;

  // Penalize placeholder metadata when title was not scraped yet.
  if (/(role from linkedin|role from indeed|role from jobsdb|software engineering \(hk, english\)|ui\/ux, tutor, support)/.test(hay)) score -= 18;

  // Prefer direct job detail pages over broad pages.
  if (/(\/job\/\d+|\/jobs\/view\/|\/viewjob\?jk=|\/jobdetail\/|gh_jid=|\/jobs-)/.test(job.url.toLowerCase())) {
    score += 6;
  } else if (/(\/jobs\/?$|\/search\/?$|\/careers\/?$)/.test(job.url.toLowerCase())) {
    score -= 12;
  }

  return score;
}

function hasLanguageMismatch(hay) {
  return /(german|french|spanish|italian|arabic|mandarin|cantonese|japanese|korean|chinese speaking|native chinese|bilingual chinese|spoken chinese)/.test(hay);
}

function hasHongKongSignal(hay, url) {
  const lowerUrl = (url || '').toLowerCase();

  if (/(hk\.jobsdb\.com|hk\.indeed\.com|hk\.linkedin\.com|ctgoodjobs\.hk|talent\.gov\.hk|apply\.careers\.hsbc\.com|jpmc\.fa\.oraclecloud\.com)/.test(lowerUrl)) {
    return true;
  }

  // eFinancialCareers HK host includes many global jobs; only accept explicit HK location slugs.
  if (/efinancialcareers\.hk/.test(lowerUrl)) {
    return /jobs-hong_kong(?:_sar)?-/i.test(lowerUrl);
  }

  return /(hong[ _-]?kong|kowloon|tsuen wan|kwun tong|science park|sheung wan|wan chai|central|new territories)/.test(hay);
}

function hasRemoteSignal(hay) {
  return /(remote|work from home|wfh|anywhere|distributed)/.test(hay);
}

function linkedInTitleFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/linkedin\.com/i.test(u.hostname)) return '';
    const part = u.pathname.split('/jobs/view/')[1];
    if (!part) return '';
    const decoded = decodeURIComponent(part).replace(/\/$/, '').toLowerCase();
    const noId = decoded.replace(/-\d+$/, '');
    const atIndex = noId.lastIndexOf('-at-');
    if (atIndex === -1) return noId;
    return noId.slice(0, atIndex);
  } catch {
    return '';
  }
}

function hasStrongNonHkSignal(hay, url) {
  const lowerUrl = (url || '').toLowerCase();
  const hardForeignCity = /(shenzhen|beijing|guangzhou|bangkok|dubai|abu[ _-]?dhabi|riyadh|doha)/;
  const locationCue = /(singapore|tokyo|new[ _-]?york|san[ _-]?francisco|london|sydney|toronto|berlin|paris|munich|zurich|stockholm|vancouver|bengaluru|bangalore|india|united[ _-]?states|usa|uk|united[ _-]?kingdom|united[ _-]?arab[ _-]?emirates|australia|canada|france|germany|japan|china)/;

  // eFinancialCareers location is encoded in URL path; treat non-HK slugs as non-HK unless remote.
  if (/efinancialcareers\.hk\/jobs-/i.test(lowerUrl) && !/jobs-hong_kong(?:_sar)?-/i.test(lowerUrl)) {
    return true;
  }

  if (hardForeignCity.test(hay)) {
    return true;
  }

  const liTitle = linkedInTitleFromUrl(url);
  if (liTitle && !/hong[ _-]?kong/.test(liTitle) && /(?:^|[-_])(shenzhen|beijing|guangzhou|bangkok|singapore|tokyo|new[ _-]?york|london|sydney|toronto|dubai|abu[ _-]?dhabi|riyadh|doha|berlin|paris|munich|zurich|stockholm|vancouver|bengaluru|bangalore)(?:[-_]|$)/.test(liTitle)) {
    return true;
  }

  // Strong location phrases only (avoid false positives from company names like "Bank of China (Hong Kong)").
  if (/hong[ _-]?kong/.test(hay)) return false;

  return /\b(based in|location:?|located in|onsite in|in)\b[^\n]{0,40}\b(singapore|tokyo|new[ _-]?york|san[ _-]?francisco|london|sydney|toronto|berlin|paris|munich|zurich|stockholm|vancouver|bengaluru|bangalore|india|united[ _-]?states|usa|uk|united[ _-]?kingdom|australia|canada|france|germany|japan|china)\b/.test(hay)
    || /\b(shenzhen|beijing|guangzhou|bangkok|tokyo|new[ _-]?york|london|dubai|abu[ _-]?dhabi|sydney|toronto)\s*[-/]?\s*based\b/.test(hay)
    || /\([^)]*\b/.test(hay) && locationCue.test(hay) && !/hong[ _-]?kong/.test(hay)
    || /\/\s*(singapore|tokyo|new[ _-]?york|london|sydney|toronto|bangkok|shenzhen)\s*\//.test(hay);
}

function bucketJob(job) {
  const hay = `${job.company} ${job.title} ${job.url}`.toLowerCase();

  if (hasLanguageMismatch(hay)) {
    return 'ineligible';
  }

  const hk = hasHongKongSignal(hay, job.url);
  const remote = hasRemoteSignal(hay);
  const explicitNonHk = hasStrongNonHkSignal(hay, job.url);

  if (explicitNonHk && !remote) {
    return 'ineligible';
  }

  if (hk || remote) {
    return 'primary';
  }

  if (!explicitNonHk) {
    return 'secondary';
  }

  return 'ineligible';
}

function inferTrack(job) {
  const hay = `${job.company} ${job.title} ${job.url}`.toLowerCase();

  if (/(tutor|teaching assistant|teacher|instructor|learning support)/.test(hay)) return 'Teaching/Tutoring';
  if (/(it support|helpdesk|service desk|technical support|operations assistant|admin assistant|customer support)/.test(hay)) return 'IT Support/Operations';
  if (/(ui\/ux|ux designer|ui designer|product designer|graphic designer|web designer)/.test(hay)) return 'UI/UX Design';
  if (/(software engineer|developer|full[ -]?stack|frontend|back[ -]?end|backend|analyst programmer)/.test(hay)) return 'Software Engineering';
  return 'General';
}

function dedupeByUrl(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    out.push(row);
  }
  return out;
}

function dedupeSemantically(rows) {
  const byKey = new Map();
  const duplicateDetails = [];

  for (const row of rows) {
    const key = buildSemanticKey(row);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    const currentScore = scoreJob(row);
    const existingScore = scoreJob(existing);
    const currentSource = sourcePriority(row.url);
    const existingSource = sourcePriority(existing.url);

    const shouldReplace =
      currentScore > existingScore
      || (currentScore === existingScore && currentSource > existingSource)
      || (currentScore === existingScore && currentSource === existingSource && row.title.length > existing.title.length);

    if (shouldReplace) {
      duplicateDetails.push({ kept: row, dropped: existing, key });
      byKey.set(key, row);
    } else {
      duplicateDetails.push({ kept: existing, dropped: row, key });
    }
  }

  return {
    rows: Array.from(byKey.values()),
    removed: duplicateDetails,
  };
}

function main() {
  if (!existsSync(PIPELINE_PATH)) {
    console.error(`Missing ${PIPELINE_PATH}.`);
    process.exit(1);
  }

  const pipelineText = readFileSync(PIPELINE_PATH, 'utf-8');
  const parsed = parsePendingJobs(pipelineText).map(normalizeSourceFields);
  const uniqueByUrl = dedupeByUrl(parsed);
  const semantic = dedupeSemantically(uniqueByUrl);
  const unique = semantic.rows;

  const scored = unique.map((job) => ({
    ...job,
    priorityScore: scoreJob(job),
    bucket: bucketJob(job),
    track: inferTrack(job),
  }));

  // Filter out ineligible and strictly require Primary tier (HK or Remote)
  const eligible = scored
    .filter((job) => job.bucket === 'primary')
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const trackCounts = eligible.reduce((acc, job) => {
    acc[job.track] = (acc[job.track] || 0) + 1;
    return acc;
  }, {});

  // Generate markdown
  const lines = [
    '# Master Job Application List (HK & Remote Only)',
    '## Ranked by CV Match (High Probability First)',
    '',
    `**Total Eligible Jobs:** ${eligible.length}`,
    '',
    '*This list strictly contains Hong Kong and Remote roles, heavily weighted towards Junior/Graduate positions and your tech stack (React/TS/Node/Python/C++).*',
    '',
    '---',
    '',
  ];

  eligible.forEach((job, idx) => {
    const num = idx + 1;
    const scoreLabel = `[Score: ${job.priorityScore}]`;
    lines.push(`### ${num}. ${job.company} — ${job.title}`);
    lines.push(`**Track:** ${job.track}`);
    lines.push(`**Match:** ${scoreLabel}`);
    lines.push(`**Apply:** [Open Job Link](${job.url})`);
    lines.push('');
  });

  const markdown = lines.join('\n');
  writeFileSync(OUT_MARKDOWN, markdown, 'utf-8');

  const OUT_HTML = 'batch/master-ranked-jobs.html';
  
  // Generate HTML
  const eligibleWithRank = eligible.map((job, idx) => ({ ...job, rank: idx + 1 }));
  const dataScript = `window.jobData = ${JSON.stringify(eligibleWithRank).replace(/<\//g, '<\\/')};`;
  const trackOptions = ['All Tracks', ...Object.keys(trackCounts).sort()]
    .map((track) => `<option value="${escapeHtml(track)}">${escapeHtml(track)}</option>`)
    .join('');

  const htmlLines = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Master Job Application List</title>',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">',
    '  <style>',
    '    :root {',
    '      --bg: #f4f6f8;',
    '      --surface: #ffffff;',
    '      --surface-hover: #f8fafc;',
    '      --ink: #1f2933;',
    '      --muted: #52606d;',
    '      --line: #d9e2ec;',
    '      --accent: #1e3a8a;',
    '      --accent-2: #1d4ed8;',
    '      --chip: #dbeafe;',
    '      --ok: #2d9d78;',
    '    }',
    '    body[data-theme="dark"] {',
    '      --bg: #0b1220;',
    '      --surface: #111827;',
    '      --surface-hover: #162033;',
    '      --ink: #e5e7eb;',
    '      --muted: #94a3b8;',
    '      --line: #243247;',
    '      --accent: #1d4ed8;',
    '      --accent-2: #3b82f6;',
    '      --chip: #0f2748;',
    '      --ok: #2fb184;',
    '    }',
    '    * { box-sizing: border-box; }',
    '    html, body { margin: 0; padding: 0; }',
    '    body {',
    '      font-family: "Manrope", "Segoe UI", sans-serif;',
    '      color: var(--ink);',
    '      background: var(--bg);',
    '      min-height: 100vh;',
    '      padding: 28px 16px 48px;',
    '    }',
    '    .container { width: min(1200px, 100%); margin: 0 auto; }',
    '    .hero {',
    '      border: 1px solid var(--line);',
    '      border-radius: 14px;',
    '      background: var(--surface);',
    '      padding: 26px clamp(18px, 3vw, 34px);',
    '      margin-bottom: 18px;',
    '    }',
    '    h1 {',
    '      margin: 0 0 6px 0;',
    '      font-family: "Space Grotesk", sans-serif;',
    '      font-size: clamp(1.65rem, 3vw, 2.35rem);',
    '      letter-spacing: -0.03em;',
    '      line-height: 1.05;',
    '      max-width: 18ch;',
    '    }',
    '    .hero-top { display: flex; align-items: start; justify-content: space-between; gap: 10px; }',
    '    .theme-toggle {',
    '      border: 1px solid var(--line);',
    '      border-radius: 8px;',
    '      background: var(--surface);',
    '      color: var(--muted);',
    '      font-weight: 700;',
    '      font-size: 0.8rem;',
    '      padding: 8px 10px;',
    '      cursor: pointer;',
    '      white-space: nowrap;',
    '    }',
    '    .theme-toggle:hover { background: var(--surface-hover); }',
    '    .subtitle { margin: 0; color: var(--muted); font-weight: 500; max-width: 72ch; }',
    '    .stats {',
    '      display: grid;',
    '      gap: 10px;',
    '      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));',
    '      margin-top: 16px;',
    '    }',
    '    .stat {',
    '      border: 1px solid var(--line);',
    '      border-radius: 12px;',
    '      padding: 10px 12px;',
    '      background: var(--surface);',
    '    }',
    '    .stat .label { display: block; color: var(--muted); font-size: 0.73rem; letter-spacing: 0.04em; text-transform: uppercase; }',
    '    .stat .value { font-family: "Space Grotesk", sans-serif; font-size: 1.2rem; font-weight: 700; margin-top: 2px; }',
    '    .controls {',
    '      position: sticky;',
    '      top: 8px;',
    '      z-index: 4;',
    '      border: 1px solid var(--line);',
    '      border-radius: 12px;',
    '      background: var(--surface);',
    '      padding: 12px;',
    '      margin-bottom: 16px;',
    '    }',
    '    .controls-grid {',
    '      display: grid;',
    '      grid-template-columns: 1.8fr 1fr 1fr 1fr 1fr;',
    '      gap: 10px;',
    '    }',
    '    .control { display: flex; flex-direction: column; gap: 5px; }',
    '    .control label { font-size: 0.73rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }',
    '    .control input, .control select {',
    '      border: 1px solid var(--line);',
    '      border-radius: 8px;',
    '      background: var(--surface);',
    '      color: var(--ink);',
    '      min-height: 40px;',
    '      padding: 8px 11px;',
    '      font: inherit;',
    '    }',
    '    .control input:focus, .control select:focus {',
    '      outline: 2px solid #bcd4fb;',
    '      border-color: var(--accent);',
    '    }',
    '    .control-inline { display: flex; align-items: center; gap: 8px; min-height: 40px; }',
    '    .control-inline input { width: auto; min-height: auto; }',
    '    .score-pill { font-family: "Space Grotesk", sans-serif; font-weight: 700; color: var(--accent-2); }',
    '    .result-meta {',
    '      margin: 9px 2px 2px;',
    '      color: var(--muted);',
    '      font-size: 0.95rem;',
    '      display: flex;',
    '      justify-content: space-between;',
    '      gap: 10px;',
    '      flex-wrap: wrap;',
    '    }',
    '    .job-grid {',
    '      display: grid;',
    '      gap: 12px;',
    '      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));',
    '    }',
    '    .job-card {',
    '      position: relative;',
    '      border-radius: 12px;',
    '      border: 1px solid var(--line);',
    '      background: var(--surface);',
    '      padding: 14px;',
    '      display: flex;',
    '      flex-direction: column;',
    '      gap: 11px;',
    '      transition: border-color .18s ease, background-color .18s ease;',
    '    }',
    '    .job-card:hover { border-color: #bcccdc; background: var(--surface-hover); }',
    '    .job-card.applied { border-color: #9fdcc8; background: #f3fbf8; }',
    '    body[data-theme="dark"] .job-card.applied { background: #10251f; border-color: #246d56; }',
    '    .card-head { display: flex; justify-content: space-between; align-items: start; gap: 8px; }',
    '    .rank-chip {',
    '      font-family: "Space Grotesk", sans-serif;',
    '      background: var(--ink);',
    '      color: #fff;',
    '      border-radius: 999px;',
    '      padding: 4px 9px;',
    '      font-size: .75rem;',
    '      white-space: nowrap;',
    '    }',
    '    .track-chip {',
    '      border: 1px solid #bfdbfe;',
    '      color: var(--accent);',
    '      background: var(--chip);',
    '      border-radius: 999px;',
    '      padding: 2px 9px;',
    '      font-size: .73rem;',
    '      font-weight: 700;',
    '      text-transform: uppercase;',
    '      letter-spacing: .02em;',
    '    }',
    '    .job-company { font-size: 0.84rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }',
    '    .job-title { margin: 0; font-size: 1.02rem; line-height: 1.35; }',
    '    .job-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; }',
    '    .job-score {',
    '      font-family: "Space Grotesk", sans-serif;',
    '      border: 1px solid #c5d9f8;',
    '      border-radius: 999px;',
    '      color: var(--accent);',
    '      background: #edf4fe;',
    '      padding: 3px 9px;',
    '      font-size: 0.78rem;',
    '      font-weight: 700;',
    '    }',
    '    body[data-theme="dark"] .job-score { background: #132744; border-color: #27466f; }',
    '    .actions { display: flex; align-items: center; gap: 8px; }',
    '    .apply-btn {',
    '      border: 1px solid var(--accent);',
    '      border-radius: 8px;',
    '      text-decoration: none;',
    '      background: var(--accent);',
    '      color: #fff;',
    '      font-weight: 700;',
    '      font-size: .82rem;',
    '      padding: 8px 11px;',
    '      transition: background-color .18s ease;',
    '    }',
    '    .apply-btn:hover { background: var(--accent-2); }',
    '    .apply-mark {',
    '      border: 1px solid var(--line);',
    '      border-radius: 8px;',
    '      background: var(--surface);',
    '      color: var(--muted);',
    '      font-weight: 700;',
    '      font-size: .78rem;',
    '      padding: 8px 10px;',
    '      cursor: pointer;',
    '    }',
    '    .empty-state {',
    '      display: none;',
    '      border: 1px dashed #aacace;',
    '      border-radius: 16px;',
    '      background: rgba(255, 255, 255, 0.8);',
    '      padding: 26px;',
    '      text-align: center;',
    '      color: #31545e;',
    '      margin-top: 8px;',
    '    }',
    '    .load-more-wrap { display: flex; justify-content: center; margin-top: 14px; }',
    '    .load-more-btn {',
    '      border: 1px solid var(--line);',
    '      border-radius: 999px;',
    '      background: var(--surface);',
    '      color: var(--muted);',
    '      font-family: "Space Grotesk", sans-serif;',
    '      font-weight: 700;',
    '      font-size: .84rem;',
    '      padding: 9px 16px;',
    '      cursor: pointer;',
    '    }',
    '    .load-more-btn:hover { background: var(--surface-hover); }',
    '    @media (max-width: 1100px) { .controls-grid { grid-template-columns: 1fr 1fr 1fr; } }',
    '    @media (max-width: 980px) { .controls-grid { grid-template-columns: 1fr 1fr; } }',
    '    @media (max-width: 720px) {',
    '      body { padding: 16px 10px 36px; }',
    '      .hero { border-radius: 12px; padding: 16px; }',
    '      .controls { top: 4px; border-radius: 10px; padding: 10px; }',
    '      .controls-grid { grid-template-columns: 1fr; }',
    '      .job-grid { grid-template-columns: 1fr; }',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="container">',
    '    <section class="hero">',
    '      <div class="hero-top">',
    '        <h1>HK + Remote Job Command Center</h1>',
    '        <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle dark mode">Dark Mode</button>',
    '      </div>',
    '      <p class="subtitle">Ranked for practical apply impact. Use filters to sprint through high-match roles and mark what you have already submitted.</p>',
    '      <div class="stats">',
    `        <div class="stat"><span class="label">Eligible Roles</span><span class="value">${eligible.length}</span></div>`,
    `        <div class="stat"><span class="label">Semantic Duplicates Removed</span><span class="value">${semantic.removed.length}</span></div>`,
    `        <div class="stat"><span class="label">Tracks Covered</span><span class="value">${Object.keys(trackCounts).length}</span></div>`,
    `        <div class="stat"><span class="label">Top Score</span><span class="value">${eligible[0]?.priorityScore ?? 0}</span></div>`,
    '      </div>',
    '    </section>',
    '    <section class="controls">',
    '      <div class="controls-grid">',
    '        <div class="control">',
    '          <label for="searchInput">Search Company / Title</label>',
    '          <input id="searchInput" type="search" placeholder="e.g. junior react, support, tutor">',
    '        </div>',
    '        <div class="control">',
    '          <label for="trackSelect">Track</label>',
    `          <select id="trackSelect">${trackOptions}</select>`,
    '        </div>',
    '        <div class="control">',
    '          <label for="minScore">Min Score <span id="minScoreValue" class="score-pill">0</span></label>',
    '          <input id="minScore" type="range" min="0" max="120" value="0" step="1">',
    '        </div>',
    '        <div class="control">',
    '          <label for="pageSizeSelect">Cards Per Step</label>',
    '          <select id="pageSizeSelect">',
    '            <option value="60">60</option>',
    '            <option value="120" selected>120</option>',
    '            <option value="240">240</option>',
    '            <option value="99999">All</option>',
    '          </select>',
    '        </div>',
    '        <div class="control">',
    '          <label for="sortSelect">Sort</label>',
    '          <select id="sortSelect">',
    '            <option value="rank">Rank (Best first)</option>',
    '            <option value="score">Score (High to low)</option>',
    '            <option value="company">Company (A-Z)</option>',
    '          </select>',
    '        </div>',
    '      </div>',
    '      <div class="result-meta">',
    '        <span id="resultCount"></span>',
    '        <span id="appliedCount"></span>',
    '      </div>',
    '    </section>',
    '    <section id="jobGrid" class="job-grid" aria-live="polite"></section>',
    '    <section id="emptyState" class="empty-state">No jobs match this filter set. Try widening search or lowering minimum score.</section>',
    '    <div class="load-more-wrap"><button id="loadMoreBtn" class="load-more-btn" type="button">Load More</button></div>',
    '  </div>',
    `  <script>${dataScript}</script>`,
    '  <script>',
    '    const jobData = window.jobData || [];',
    '    const storageKey = "career_ops_applied_urls_v1";',
    '    const applied = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));',
    '    const state = {',
    '      q: "",',
    '      track: "All Tracks",',
    '      minScore: 0,',
    '      sort: "rank",',
    '      pageSize: 120,',
    '      page: 1,',
    '    };',
    '    const searchInput = document.getElementById("searchInput");',
    '    const trackSelect = document.getElementById("trackSelect");',
    '    const minScore = document.getElementById("minScore");',
    '    const minScoreValue = document.getElementById("minScoreValue");',
    '    const pageSizeSelect = document.getElementById("pageSizeSelect");',
    '    const sortSelect = document.getElementById("sortSelect");',
    '    const themeToggle = document.getElementById("themeToggle");',
    '    const loadMoreBtn = document.getElementById("loadMoreBtn");',
    '    const jobGrid = document.getElementById("jobGrid");',
    '    const emptyState = document.getElementById("emptyState");',
    '    const resultCount = document.getElementById("resultCount");',
    '    const appliedCount = document.getElementById("appliedCount");',
    '    const themeStorageKey = "career_ops_theme_v1";',
    '',
    '    function escapeHtml(value) {',
    '      return String(value)',
    '        .replace(/&/g, "&amp;")',
    '        .replace(/</g, "&lt;")',
    '        .replace(/>/g, "&gt;")',
    '        .replace(/\"/g, "&quot;")',
    '        .replace(/\'/g, "&#39;");',
    '    }',
    '',
    '    function saveApplied() {',
    '      localStorage.setItem(storageKey, JSON.stringify(Array.from(applied)));',
    '    }',
    '',
    '    function applyTheme(theme) {',
    '      document.body.setAttribute("data-theme", theme);',
    '      themeToggle.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";',
    '    }',
    '',
    '    function formatCard(job) {',
    '      const isApplied = applied.has(job.url);',
    '      const safeCompany = escapeHtml(job.company);',
    '      const safeTitle = escapeHtml(job.title);',
    '      const safeTrack = escapeHtml(job.track);',
    '      const safeUrl = encodeURI(job.url);',
    '      const card = document.createElement("article");',
    '      card.className = `job-card${isApplied ? " applied" : ""}`;',
    '      card.innerHTML = `',
    '        <div class="card-head">',
    '          <span class="rank-chip">#${job.rank}</span>',
    '          <span class="track-chip">${safeTrack}</span>',
    '        </div>',
    '        <div class="job-company">${safeCompany}</div>',
    '        <h3 class="job-title">${safeTitle}</h3>',
    '        <div class="job-footer">',
    '          <span class="job-score">Score ${job.priorityScore}</span>',
    '          <div class="actions">',
    '            <button class="apply-mark" type="button">${isApplied ? "Applied" : "Mark Applied"}</button>',
    '            <a class="apply-btn" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open</a>',
    '          </div>',
    '        </div>',
    '      `;',
    '',
    '      const markBtn = card.querySelector(".apply-mark");',
    '      markBtn.addEventListener("click", () => {',
    '        if (applied.has(job.url)) {',
    '          applied.delete(job.url);',
    '        } else {',
    '          applied.add(job.url);',
    '        }',
    '        saveApplied();',
    '        render();',
    '      });',
    '',
    '      return card;',
    '    }',
    '',
    '    function filteredJobs() {',
    '      const q = state.q.toLowerCase();',
    '      let items = jobData.filter((job) => {',
    '        const inTrack = state.track === "All Tracks" || job.track === state.track;',
    '        const inScore = job.priorityScore >= state.minScore;',
    '        const inQuery = !q || `${job.company} ${job.title}`.toLowerCase().includes(q);',
    '        return inTrack && inScore && inQuery;',
    '      });',
    '',
    '      if (state.sort === "company") {',
    '        items.sort((a, b) => a.company.localeCompare(b.company));',
    '      } else if (state.sort === "score") {',
    '        items.sort((a, b) => b.priorityScore - a.priorityScore || a.rank - b.rank);',
    '      } else {',
    '        items.sort((a, b) => a.rank - b.rank);',
    '      }',
    '',
    '      return items;',
    '    }',
    '',
    '    function render() {',
    '      const filtered = filteredJobs();',
    '      const cutoff = state.pageSize >= 99999 ? filtered.length : state.page * state.pageSize;',
    '      const items = filtered.slice(0, cutoff);',
    '      jobGrid.innerHTML = "";',
    '      items.forEach((job) => jobGrid.appendChild(formatCard(job)));',
    '      const appliedVisible = items.filter((j) => applied.has(j.url)).length;',
    '      resultCount.textContent = `${items.length} shown of ${filtered.length} matching (${jobData.length} total)`;',
    '      appliedCount.textContent = `${appliedVisible} applied in current view`;',
    '      emptyState.style.display = filtered.length ? "none" : "block";',
    '      const hasMore = filtered.length > items.length;',
    '      loadMoreBtn.style.display = hasMore ? "inline-flex" : "none";',
    '      if (hasMore) {',
    '        const next = Math.min(filtered.length - items.length, state.pageSize);',
    '        loadMoreBtn.textContent = `Load ${next} more`; ',
    '      }',
    '      minScoreValue.textContent = String(state.minScore);',
    '    }',
    '',
    '    function resetPageAndRender() {',
    '      state.page = 1;',
    '      render();',
    '    }',
    '',
    '    searchInput.addEventListener("input", (e) => { state.q = e.target.value || ""; resetPageAndRender(); });',
    '    trackSelect.addEventListener("change", (e) => { state.track = e.target.value; resetPageAndRender(); });',
    '    minScore.addEventListener("input", (e) => { state.minScore = Number(e.target.value || 0); resetPageAndRender(); });',
    '    sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; resetPageAndRender(); });',
    '    pageSizeSelect.addEventListener("change", (e) => { state.pageSize = Number(e.target.value || 120); resetPageAndRender(); });',
    '    loadMoreBtn.addEventListener("click", () => { state.page += 1; render(); });',
    '    themeToggle.addEventListener("click", () => {',
    '      const next = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";',
    '      applyTheme(next);',
    '      localStorage.setItem(themeStorageKey, next);',
    '    });',
    '',
    '    const preferredDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;',
    '    const savedTheme = localStorage.getItem(themeStorageKey) || (preferredDark ? "dark" : "light");',
    '    applyTheme(savedTheme);',
    '',
    '    render();',
    '  </script>',
    '</body>',
    '</html>'
  ];

  writeFileSync(OUT_HTML, htmlLines.join('\n'), 'utf-8');

  console.log(`✅ Master list generated: ${OUT_MARKDOWN}`);
  console.log(`✅ HTML Dashboard generated: ${OUT_HTML}`);
  console.log(`Semantic duplicates removed: ${semantic.removed.length}`);
  console.log(`URL duplicates removed: ${parsed.length - uniqueByUrl.length}`);
  console.log(`Total eligible jobs: ${eligible.length}`);
  console.log(`Primary tier: ${scored.filter((j) => j.bucket === 'primary').length}`);
  console.log(`Secondary tier: ${scored.filter((j) => j.bucket === 'secondary').length}`);
  console.log(`Ineligible: ${scored.filter((j) => j.bucket === 'ineligible').length}`);
  console.log('');
  console.log('Top 10 jobs to start with:');
  eligible.slice(0, 10).forEach((job, i) => {
    console.log(`${i + 1}. [${job.priorityScore}] ${job.company.substring(0, 30)} — ${job.title.substring(0, 50)}`);
  });
}

main();
