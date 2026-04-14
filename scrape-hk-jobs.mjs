#!/usr/bin/env node

/**
 * State-of-the-art multi-source job scraper for Hong Kong + remote roles.
 *
 * Focus:
 * - Entry-level / graduate-friendly roles
 * - Software, UI/UX, IT support, tutoring/teaching
 * - English-friendly roles
 * - Salary signal targeting >= HKD 20,000 / month when available
 *
 * Output:
 * - data/scraped-jobs.json
 * - data/scrape-report.md
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';

const PIPELINE_PATH = 'data/pipeline.md';
const OUT_JSON_PATH = 'data/scraped-jobs.json';
const OUT_REPORT_PATH = 'data/scrape-report.md';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
};

const KEYWORD_QUERIES = [
  'software engineer',
  'junior software engineer',
  'graduate engineer',
  'software developer',
  'junior developer',
  'frontend developer',
  'full stack developer',
  'backend developer',
  'qa engineer',
  'automation test engineer',
  'embedded engineer',
  'ui ux designer',
  'ui designer',
  'ux designer',
  'product designer',
  'graphic designer',
  'web designer',
  'it support',
  'helpdesk',
  'technical support',
  'service desk',
];

const ROLE_RELEVANCE_RE = /(software|developer|engineer|programmer|frontend|front[ -]?end|backend|back[ -]?end|full[ -]?stack|web|react|typescript|javascript|node|python|java|c\+\+|embedded|firmware|qa|quality assurance|test automation|sre|devops|cloud|data engineer|ui\/?ux|ux\/?ui|ux designer|ui designer|product designer|graphic designer|web designer|it support|helpdesk|technical support|service desk|cybersecurity|information security)/i;
const ENTRY_FRIENDLY_RE = /(graduate|junior|entry|associate|assistant|trainee|fresh grad|new grad|0-2 years|1-2 years|early career)/i;
const SENIORITY_EXCLUDE_RE = /(senior|lead|principal|staff|director|head of|vp|vice president|manager)(?!\s*assistant)/i;
const MANDARIN_CANTONESE_RE = /(mandarin|cantonese|spoken chinese|written chinese|native chinese|chinese speaking|fluent chinese|putonghua)/i;
const REMOTE_RE = /(remote|work from home|wfh|anywhere|distributed)/i;
const HK_LOCATION_RE = /(hong\s*kong|hong kong sar|kowloon|new territories|tsuen wan|kwun tong|wan chai|central|science park|sheung wan|causeway bay|shatin|sha tin|tsim sha tsui|admiralty|quarry bay|ngau tau kok)/i;
const NON_HK_LOCATION_RE = /(berlin|munich|france|paris|new\s*york|san\s*francisco|london|tokyo|singapore|sydney|toronto|india|bengaluru|bangalore|seoul|madrid|amsterdam|sweden|canada|united\s*states|usa|united\s*kingdom|\buk\b|germany|mexico|brazil|warsaw|zurich|luxembourg)/i;
const INTERNSHIP_VOLUNTEER_RE = /(intern|internship|working student|volunteer)/i;
const RESTRICTIVE_REMOTE_RE = /(us\s*only|u\.s\.\s*only|canada\s*only|europe\s*only|uk\s*only|eu\s*only|remote\s*\(us\)|remote\s*-\s*us)/i;
const NON_ENGLISH_HINT_RE = /(m\/w\/d|\boder\b|\bund\b|steuer|entwickler|ingenieur|werkstudent|vollzeit|teilzeit|french speaking|german speaking|spanish speaking|arabic speaking|italian speaking)/i;
const FULL_TIME_TEACHING_RE = /(teacher|tutor|teaching assistant|teaching associate|instructor|lecturer|education consultant|subject tutor|private tutor)/i;

const CURATED_GREENHOUSE_BOARDS = [
  'airtable',
  'vercel',
  'intercom',
  'contentful',
  'runpod',
  'anthropic',
  'hightouch',
  'planetscale',
  'isomorphiclabs',
  'gleanwork',
];

const CURATED_LEVER_COMPANIES = [
  'spotify',
  'palantir',
  'mistral',
  'pigment',
];

const CURATED_ASHBY_ORGS = [
  'elevenlabs',
  'deepgram',
  'cohere',
  'langchain',
  'supabase',
  'perplexity',
  'workos',
  'claylabs',
  'lindy',
  'decagon',
  'sierra',
];

const SOURCE_COUNTERS = {
  linkedin: 0,
  greenhouse: 0,
  lever: 0,
  ashby: 0,
  remotive: 0,
  arbeitnow: 0,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]*>/g, ' '));
}

function extractReadableTextFromHtml(html) {
  return stripTags(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' '),
  );
}

function toTitleCaseFromSlug(slug) {
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function compactUrl(url) {
  try {
    const u = new URL(url);
    if (/linkedin\.com/i.test(u.hostname)) {
      u.search = '';
    }
    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

function parseAmount(token) {
  const cleaned = token.toLowerCase().replace(/[,\s]/g, '');
  const k = cleaned.match(/^(\d+(?:\.\d+)?)k$/i);
  if (k) return Math.round(Number(k[1]) * 1000);
  const plain = cleaned.match(/^(\d{2,7})$/);
  if (plain) return Number(plain[1]);
  return null;
}

function extractSalaryMinHkd(hay) {
  const text = String(hay || '').toLowerCase();
  const matches = [];
  const re = /(hkd|hk\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?k?)/gi;

  let m;
  while ((m = re.exec(text)) !== null) {
    const amount = parseAmount(String(m[2]).replace(/,/g, ''));
    if (amount) matches.push(amount);
  }

  if (!matches.length) {
    const rangeRe = /([0-9]{2,3}(?:\.[0-9]+)?k)\s*[-~to]+\s*([0-9]{2,3}(?:\.[0-9]+)?k)/gi;
    while ((m = rangeRe.exec(text)) !== null) {
      const a = parseAmount(m[1]);
      const b = parseAmount(m[2]);
      if (a) matches.push(a);
      if (b) matches.push(b);
    }
  }

  if (!matches.length) return null;
  return Math.min(...matches);
}

function hasHongKongOrRemote(location, title, description, url) {
  const loc = `${location || ''}`;
  const topLine = `${title || ''} ${url || ''}`;

  if (HK_LOCATION_RE.test(`${loc} ${topLine}`)) {
    return true;
  }

  // For remote eligibility, only trust explicit remote signal in location/title/url,
  // not deep description text that often references unrelated geographies.
  if (REMOTE_RE.test(`${loc} ${topLine}`)) {
    return true;
  }

  return false;
}

function isEntryFriendly(title, description) {
  const hay = `${title || ''} ${description || ''}`;
  if (ENTRY_FRIENDLY_RE.test(hay)) return true;
  return !SENIORITY_EXCLUDE_RE.test(hay);
}

function isRelevantRole(title, description) {
  // Keep relevance strict to title text to avoid noisy description-only matches.
  return ROLE_RELEVANCE_RE.test(`${title || ''}`);
}

function isFullTimeTeachingRole(title, description) {
  const top = `${title || ''}`;
  const hay = `${title || ''} ${description || ''}`;
  if (!FULL_TIME_TEACHING_RE.test(hay)) return false;

  // If the title itself is teaching/tutoring, exclude it directly.
  if (FULL_TIME_TEACHING_RE.test(top)) return true;

  // Catch listing text that frames a role as school/classroom teaching.
  return /(full[ -]?time|permanent|school|academy|classroom|curriculum|lesson plan|secondary|primary)/i.test(hay);
}

function isEnglishFriendly(title, description, location) {
  const hay = `${title || ''} ${description || ''} ${location || ''}`;
  return !MANDARIN_CANTONESE_RE.test(hay);
}

function hasExplicitCantoneseRequirement(text) {
  const hay = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/\bcantonese\b/.test(hay)) return false;

  // Allow explicit opt-out phrasing such as "Cantonese not required".
  if (/\bcantonese\s+(?:not\s+required|optional|not\s+necessary)\b/.test(hay)) return false;
  if (/\b(?:no|not|without)\b[^.]{0,40}\bcantonese\b[^.]{0,20}\b(?:required|necessary|needed)\b/.test(hay)) return false;

  const strongRequirementPatterns = [
    /\bcantonese\s+(?:is\s+)?(?:a\s+)?(?:must|required|requirement|mandatory|essential)\b/,
    /\b(?:must|required|requires?|need|needed)\b[^.]{0,100}\bcantonese\b/,
    /\b(?:fluent|proficien(?:t|cy)|good\s+command|excellent\s+command)\b[^.]{0,100}\bcantonese\b/,
    /\b(?:spoken|written|speak|write)\b[^.]{0,100}\bcantonese\b/,
    /\bcantonese\s+(?:speaking|speaker)\b/,
    /\benglish\s+and\s+cantonese\b/,
  ];

  if (strongRequirementPatterns.some((re) => re.test(hay))) {
    return true;
  }

  // Fallback: if Cantonese appears in the same clause with requirement wording.
  const clauses = hay.split(/[.;\n]/);
  for (const clause of clauses) {
    if (!clause.includes('cantonese')) continue;
    if (/\b(require|must|need|preferred|advantage|proficien|fluent|spoken|written|command)\b/.test(clause)) {
      return true;
    }
  }

  return false;
}

function shouldKeepJob(job) {
  const title = job.title || '';
  const location = job.location || '';
  const description = job.description || '';
  const geoHay = `${location} ${title} ${job.url || ''}`;
  const salaryMin = extractSalaryMinHkd(`${title} ${description}`);

  if (!job.url || !job.company || !title) return false;
  if (NON_ENGLISH_HINT_RE.test(`${title} ${description}`)) return false;
  if (INTERNSHIP_VOLUNTEER_RE.test(`${title} ${description}`)) return false;
  if (isFullTimeTeachingRole(title, description)) return false;
  if (!isRelevantRole(title, description)) return false;
  if (!hasHongKongOrRemote(location, title, description, job.url)) return false;
  if (!HK_LOCATION_RE.test(geoHay) && NON_HK_LOCATION_RE.test(geoHay)) return false;
  if (RESTRICTIVE_REMOTE_RE.test(`${location} ${description}`)) return false;
  if (!isEntryFriendly(title, description)) return false;
  if (!isEnglishFriendly(title, description, location)) return false;
  if (salaryMin !== null && salaryMin < 20000) return false;

  return true;
}

async function screenJobsByDetailLanguage(jobs) {
  const stats = {
    listingCantoneseRejected: 0,
    detailPagesAttempted: 0,
    detailPagesFetched: 0,
    detailPagesFailed: 0,
    detailCantoneseRejected: 0,
    unverifiedLanguageRejected: 0,
  };

  const screened = await mapLimit(jobs, 6, async (job) => {
    const listingText = `${job.title || ''} ${job.location || ''} ${job.description || ''}`;
    if (hasExplicitCantoneseRequirement(listingText)) {
      stats.listingCantoneseRejected += 1;
      return {
        ...job,
        languageScreen: {
          cantoneseRequired: true,
          source: 'listing',
        },
      };
    }

    stats.detailPagesAttempted += 1;

    try {
      const html = await fetchText(job.url, {}, 1);
      stats.detailPagesFetched += 1;

      const pageText = extractReadableTextFromHtml(html);
      const combinedText = `${listingText} ${pageText}`;
      const cantoneseRequired = hasExplicitCantoneseRequirement(combinedText);

      if (cantoneseRequired) {
        stats.detailCantoneseRejected += 1;
      }

      return {
        ...job,
        languageScreen: {
          cantoneseRequired,
          source: cantoneseRequired ? 'detail' : 'none',
        },
      };
    } catch {
      stats.detailPagesFailed += 1;

      const hasRichListingText = String(job.description || '').trim().length >= 140;
      const unverifiedLanguageCheck = !hasRichListingText;
      if (unverifiedLanguageCheck) {
        stats.unverifiedLanguageRejected += 1;
      }

      return {
        ...job,
        languageScreen: {
          cantoneseRequired: false,
          source: 'none',
          unverifiedLanguageCheck,
        },
      };
    }
  });

  return {
    jobs: screened,
    stats,
  };
}

async function fetchWithRetry(url, options = {}, retry = 2) {
  let lastError;
  for (let i = 0; i <= retry; i += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...REQUEST_HEADERS,
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (i < retry) {
        await sleep(300 * (i + 1));
      }
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}, retry = 2) {
  const res = await fetchWithRetry(url, options, retry);
  return res.json();
}

async function fetchText(url, options = {}, retry = 2) {
  const res = await fetchWithRetry(url, options, retry);
  return res.text();
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;

  async function runOne() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(runners);
  return out;
}

function parsePipelineSeedUrls() {
  if (!existsSync(PIPELINE_PATH)) return [];
  const text = readFileSync(PIPELINE_PATH, 'utf-8');
  const urls = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^- \[ \] (https?:\/\/\S+)\s*\|/);
    if (m) urls.push(m[1]);
  }
  return urls;
}

function deriveBoardSeeds(urls) {
  const greenhouseBoards = new Set(CURATED_GREENHOUSE_BOARDS);
  const leverCompanies = new Set(CURATED_LEVER_COMPANIES);
  const ashbyOrgs = new Set(CURATED_ASHBY_ORGS);

  for (const rawUrl of urls) {
    const url = String(rawUrl || '').trim();

    const gh = url.match(/https?:\/\/job-boards(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\//i);
    if (gh?.[1]) greenhouseBoards.add(gh[1].toLowerCase());

    const lever = url.match(/https?:\/\/jobs\.lever\.co\/([^/]+)\//i);
    if (lever?.[1]) leverCompanies.add(lever[1].toLowerCase());

    const ashby = url.match(/https?:\/\/jobs\.ashbyhq\.com\/([^/]+)\//i);
    if (ashby?.[1]) ashbyOrgs.add(ashby[1].toLowerCase());
  }

  return {
    greenhouseBoards: Array.from(greenhouseBoards),
    leverCompanies: Array.from(leverCompanies),
    ashbyOrgs: Array.from(ashbyOrgs),
  };
}

function parseLinkedInCards(html) {
  const cards = html.match(/<li>[\s\S]*?<\/li>/gi) || [];
  const jobs = [];

  for (const card of cards) {
    const href = card.match(/<a[^>]+class="[^"]*base-card__full-link[^"]*"[^>]+href="([^"]+)"/i)?.[1];
    const title = stripTags(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const company = stripTags(card.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || '');
    const location = stripTags(card.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');

    if (!href || !title || !company) continue;
    jobs.push({
      url: compactUrl(href),
      company,
      title,
      location,
      description: '',
      source: 'linkedin-guest',
    });
  }

  return jobs;
}

async function scrapeLinkedIn() {
  const locations = ['Hong Kong', 'Hong Kong SAR', 'Remote'];
  const starts = [0, 25, 50, 75];
  const tasks = [];

  for (const keyword of KEYWORD_QUERIES) {
    for (const location of locations) {
      for (const start of starts) {
        tasks.push({ keyword, location, start });
      }
    }
  }

  const pages = await mapLimit(tasks, 8, async ({ keyword, location, start }) => {
    const q = encodeURIComponent(keyword);
    const l = encodeURIComponent(location);
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${q}&location=${l}&start=${start}`;
    try {
      const html = await fetchText(url);
      return parseLinkedInCards(html);
    } catch {
      return [];
    }
  });

  const jobs = pages.flat();
  SOURCE_COUNTERS.linkedin += jobs.length;
  return jobs;
}

async function scrapeGreenhouseBoard(board) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
  const data = await fetchJson(url);
  const jobs = (data.jobs || []).map((j) => ({
    url: compactUrl(j.absolute_url || ''),
    company: toTitleCaseFromSlug(board),
    title: decodeHtmlEntities(j.title || ''),
    location: decodeHtmlEntities(j.location?.name || ''),
    description: stripTags(j.content || ''),
    source: `greenhouse:${board}`,
  }));
  return jobs;
}

async function scrapeGreenhouse(boards) {
  const batches = await mapLimit(boards, 6, async (board) => {
    try {
      return await scrapeGreenhouseBoard(board);
    } catch {
      return [];
    }
  });
  const jobs = batches.flat();
  SOURCE_COUNTERS.greenhouse += jobs.length;
  return jobs;
}

async function scrapeLeverCompany(company) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const data = await fetchJson(url);
  return (data || []).map((j) => ({
    url: compactUrl(j.hostedUrl || ''),
    company: toTitleCaseFromSlug(company),
    title: decodeHtmlEntities(j.text || ''),
    location: decodeHtmlEntities(j.categories?.location || ''),
    description: stripTags(j.descriptionPlain || j.description || ''),
    source: `lever:${company}`,
  }));
}

async function scrapeLever(companies) {
  const batches = await mapLimit(companies, 6, async (company) => {
    try {
      return await scrapeLeverCompany(company);
    } catch {
      return [];
    }
  });
  const jobs = batches.flat();
  SOURCE_COUNTERS.lever += jobs.length;
  return jobs;
}

async function scrapeAshbyOrg(org) {
  const url = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams';
  const query = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {\n  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {\n    teams { id name parentTeamId }\n    jobPostings { id title locationName teamId employmentType }\n  }\n}`;
  const body = {
    operationName: 'ApiJobBoardWithTeams',
    variables: { organizationHostedJobsPageName: org },
    query,
  };

  const data = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const teams = new Map((data?.data?.jobBoard?.teams || []).map((t) => [t.id, t.name]));
  const jobs = (data?.data?.jobBoard?.jobPostings || []).map((j) => {
    const team = teams.get(j.teamId) || '';
    return {
      url: compactUrl(`https://jobs.ashbyhq.com/${org}/${j.id}`),
      company: toTitleCaseFromSlug(org),
      title: decodeHtmlEntities(j.title || ''),
      location: decodeHtmlEntities(j.locationName || ''),
      description: `Team: ${team}. Employment: ${j.employmentType || ''}`,
      source: `ashby:${org}`,
    };
  });

  return jobs;
}

async function scrapeAshby(orgs) {
  const batches = await mapLimit(orgs, 4, async (org) => {
    try {
      return await scrapeAshbyOrg(org);
    } catch {
      return [];
    }
  });

  const jobs = batches.flat();
  SOURCE_COUNTERS.ashby += jobs.length;
  return jobs;
}

async function scrapeRemotive() {
  const batches = await mapLimit(KEYWORD_QUERIES, 6, async (query) => {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
    try {
      const data = await fetchJson(url);
      return (data.jobs || []).map((j) => ({
        url: compactUrl(j.url || ''),
        company: decodeHtmlEntities(j.company_name || 'Remote Company'),
        title: decodeHtmlEntities(j.title || ''),
        location: decodeHtmlEntities(j.candidate_required_location || 'Remote'),
        description: stripTags(`${j.description || ''} ${j.salary || ''}`),
        source: 'remotive',
      }));
    } catch {
      return [];
    }
  });

  const jobs = batches.flat();
  SOURCE_COUNTERS.remotive += jobs.length;
  return jobs;
}

async function scrapeArbeitnow() {
  const pages = [1, 2, 3, 4, 5];
  const batches = await mapLimit(pages, 3, async (page) => {
    const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
    try {
      const data = await fetchJson(url);
      return (data.data || []).map((j) => ({
        url: compactUrl(j.url || ''),
        company: decodeHtmlEntities(j.company_name || 'Remote Company'),
        title: decodeHtmlEntities(j.title || ''),
        location: decodeHtmlEntities(j.location || 'Remote'),
        description: stripTags(`${j.description || ''} ${(j.tags || []).join(' ')}`),
        source: 'arbeitnow',
      }));
    } catch {
      return [];
    }
  });

  const jobs = batches.flat();
  SOURCE_COUNTERS.arbeitnow += jobs.length;
  return jobs;
}

function semanticKey(job) {
  const company = String(job.company || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(limited|ltd|inc|llc|co|company|group|technologies|technology)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const title = String(job.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(senior|jr|junior|entry|graduate|new grad|fresh grad|associate|assistant)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${company}::${title}`;
}

function dedupeJobs(jobs) {
  const byUrl = new Map();
  for (const job of jobs) {
    const url = compactUrl(job.url);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, { ...job, url });
  }

  const bySemantic = new Map();
  for (const job of byUrl.values()) {
    const key = semanticKey(job);
    const existing = bySemantic.get(key);
    if (!existing) {
      bySemantic.set(key, job);
      continue;
    }

    const existingHasHkSignal = hasHongKongOrRemote(existing.location, existing.title, existing.description, existing.url);
    const currentHasHkSignal = hasHongKongOrRemote(job.location, job.title, job.description, job.url);

    if (!existingHasHkSignal && currentHasHkSignal) {
      bySemantic.set(key, job);
      continue;
    }

    if ((job.description || '').length > (existing.description || '').length) {
      bySemantic.set(key, job);
    }
  }

  return Array.from(bySemantic.values());
}

function toPipelineShape(job) {
  return {
    url: compactUrl(job.url),
    company: decodeHtmlEntities(job.company),
    title: decodeHtmlEntities(job.title),
    source: job.source,
    location: decodeHtmlEntities(job.location || ''),
    scrapedAt: new Date().toISOString(),
  };
}

function buildReport({ totalRaw, totalPreFilter, totalAfterLanguageScreen, totalFinal, seeds, detailStats }) {
  const lines = [
    '# HK Job Scrape Report',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Raw collected jobs: ${totalRaw}`,
    `- After profile filtering: ${totalPreFilter}`,
    `- After Cantonese requirement screen: ${totalAfterLanguageScreen}`,
    `- After de-duplication: ${totalFinal}`,
    '',
    '## Source Intake',
    '',
    `- LinkedIn guest cards: ${SOURCE_COUNTERS.linkedin}`,
    `- Greenhouse jobs: ${SOURCE_COUNTERS.greenhouse}`,
    `- Lever jobs: ${SOURCE_COUNTERS.lever}`,
    `- Ashby jobs: ${SOURCE_COUNTERS.ashby}`,
    `- Remotive jobs: ${SOURCE_COUNTERS.remotive}`,
    `- Arbeitnow jobs: ${SOURCE_COUNTERS.arbeitnow}`,
    '',
    '## Seed Coverage',
    '',
    `- Greenhouse boards crawled: ${seeds.greenhouseBoards.length}`,
    `- Lever companies crawled: ${seeds.leverCompanies.length}`,
    `- Ashby orgs crawled: ${seeds.ashbyOrgs.length}`,
    '',
    '## Detail Page Language Screening',
    '',
    `- Listing-level Cantonese rejections: ${detailStats.listingCantoneseRejected}`,
    `- Detail pages attempted: ${detailStats.detailPagesAttempted}`,
    `- Detail pages fetched: ${detailStats.detailPagesFetched}`,
    `- Detail page fetch failures: ${detailStats.detailPagesFailed}`,
    `- Detail-level Cantonese rejections: ${detailStats.detailCantoneseRejected}`,
    `- Unverified language-screening rejections: ${detailStats.unverifiedLanguageRejected}`,
    '',
    '## Filters Applied',
    '',
    '- Role relevance: software/UI/UX/engineering support (tech-first)',
    '- Excludes full-time teaching/tutoring tracks',
    '- Geography: Hong Kong or remote',
    '- Experience: entry-level friendly preferred',
    '- Language: excludes explicit Cantonese-required roles from listing and detail pages',
    '- Compensation: excludes explicit sub-20k HKD monthly salary signal',
    '',
  ];

  return lines.join('\n');
}

async function main() {
  const seedUrls = parsePipelineSeedUrls();
  const seeds = deriveBoardSeeds(seedUrls);

  const [linkedin, greenhouse, lever, ashby, remotive, arbeitnow] = await Promise.all([
    scrapeLinkedIn(),
    scrapeGreenhouse(seeds.greenhouseBoards),
    scrapeLever(seeds.leverCompanies),
    scrapeAshby(seeds.ashbyOrgs),
    scrapeRemotive(),
    scrapeArbeitnow(),
  ]);

  const raw = [
    ...linkedin,
    ...greenhouse,
    ...lever,
    ...ashby,
    ...remotive,
    ...arbeitnow,
  ];

  const preFiltered = raw.filter(shouldKeepJob);
  const preFilteredUnique = dedupeJobs(preFiltered);
  const languageScreened = await screenJobsByDetailLanguage(preFilteredUnique);
  const languageFiltered = languageScreened.jobs.filter(
    (job) => !job.languageScreen?.cantoneseRequired && !job.languageScreen?.unverifiedLanguageCheck,
  );
  const unique = dedupeJobs(languageFiltered).map(toPipelineShape);

  unique.sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));

  writeFileSync(OUT_JSON_PATH, `${JSON.stringify(unique, null, 2)}\n`, 'utf-8');
  writeFileSync(
    OUT_REPORT_PATH,
    buildReport({
      totalRaw: raw.length,
      totalPreFilter: preFiltered.length,
      totalAfterLanguageScreen: languageFiltered.length,
      totalFinal: unique.length,
      seeds,
      detailStats: languageScreened.stats,
    }),
    'utf-8',
  );

  console.log(`Saved ${unique.length} jobs to ${OUT_JSON_PATH}`);
  console.log(`Saved scrape report to ${OUT_REPORT_PATH}`);
}

main().catch((err) => {
  console.error('Scraper failed:', err?.message || err);
  process.exit(1);
});
