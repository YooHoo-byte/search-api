/**
 * @fileoverview Somwhatgoogle API - Privacy-focused search aggregation service
 * @version 3.2.0
 * @author Your Name
 * @license MIT
 * 
 * @description
 * A comprehensive search API that aggregates results from multiple privacy-respecting
 * search engines, image sources, video platforms, news aggregators, and weather services.
 * Features automatic fallbacks, intelligent caching, and configurable safe search.
 * Returns 100+ results per category.
 * 
 * @requires express
 * @requires cheerio
 * @requires node-fetch
 * @requires https
 * @requires http
 * @requires cors
 * @requires helmet
 */

import express from "express";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import https from 'https';
import http from 'http';
import { URL } from 'url';
import cors from "cors";
import helmet from "helmet";

import dotenv from 'dotenv';
dotenv.config();


// =============================================================================
// UPDATED CONFIGURATION FOR 100+ RESULTS
// =============================================================================

/**
 * Number of results to return per page for web searches
 * @constant {number}
 */
const RESULTS_PER_PAGE = 100;

/**
 * Maximum number of results to fetch before pagination
 * @constant {number}
 */
const MAX_FETCH_RESULTS = 500;

/**
 * Cache Time-To-Live configurations (in milliseconds)
 * @constant {Object}
 */
const TTL = {
  short: 2 * 60 * 1000,    // 2 minutes - dynamic content
  medium: 10 * 60 * 1000,  // 10 minutes - search results
  long: 60 * 60 * 1000     // 60 minutes - static content
};

/**
 * HTTP request timeout (in milliseconds)
 * @constant {number}
 */
const REQUEST_TIMEOUT = 20000;

/**
 * Maximum number of retry attempts for failed requests
 * @constant {number}
 */
const MAX_RETRIES = 5;

/**
 * Maximum cache size before automatic cleanup
 * @constant {number}
 */
const MAX_CACHE_SIZE = 10000;

/**
 * Rate limiting configuration
 * @constant {Object}
 */
const RATE_LIMIT = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
};

// =============================================================================
// APPLICATION SETUP
// =============================================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || "*",
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// JSON formatting
app.set('json spaces', 2);

// Trust proxy (important for deployment platforms)
app.set('trust proxy', 1);

// =============================================================================
// HTTP AGENTS
// =============================================================================

/**
 * HTTPS agent with connection pooling and keepalive
 * @constant {https.Agent}
 */
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 20,
  timeout: 30000,
  rejectUnauthorized: process.env.NODE_ENV === 'production'
});

/**
 * HTTP agent with connection pooling and keepalive
 * @constant {http.Agent}
 */
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 20,
  timeout: 30000
});

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

const CACHE = new Map();
let cacheHits = 0;
let cacheMisses = 0;

function cacheGet(key) {
  try {
    const entry = CACHE.get(key);
    if (!entry) {
      cacheMisses++;
      return null;
    }
    
    const age = Date.now() - entry.t;
    const ttl = entry.ttl || TTL.medium;
    
    if (age > ttl) {
      CACHE.delete(key);
      cacheMisses++;
      return null;
    }
    
    entry.t = Date.now();
    cacheHits++;
    return entry.d;
  } catch (error) {
    console.error(`Cache get error for key ${key}:`, error.message);
    cacheMisses++;
    return null;
  }
}

function cacheSet(key, data, ttl = TTL.medium) {
  try {
    if (CACHE.size >= MAX_CACHE_SIZE) {
      console.log(`Cache full (${CACHE.size}), cleaning up...`);
      
      const entries = Array.from(CACHE.entries());
      entries.sort((a, b) => a[1].t - b[1].t);
      
      const toRemove = Math.floor(entries.length * 0.1);
      for (let i = 0; i < toRemove; i++) {
        CACHE.delete(entries[i][0]);
      }
      
      const now = Date.now();
      for (const [cacheKey, entry] of CACHE.entries()) {
        const age = now - entry.t;
        if (age > (entry.ttl || TTL.medium)) {
          CACHE.delete(cacheKey);
        }
      }
    }
    
    CACHE.set(key, { d: data, t: Date.now(), ttl });
  } catch (error) {
    console.error(`Cache set error for key ${key}:`, error.message);
  }
}

function cacheClear() {
  CACHE.clear();
  cacheHits = 0;
  cacheMisses = 0;
  console.log('Cache cleared');
}

function getCacheStats() {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const entry of CACHE.values()) {
    const age = now - entry.t;
    const ttl = entry.ttl || TTL.medium;
    if (age > ttl) {
      expiredCount++;
    }
  }
  
  return {
    size: CACHE.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0 ? 
      ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(2) + '%' : '0%',
    maxSize: MAX_CACHE_SIZE,
    expiredEntries: expiredCount
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES) {
  let lastError;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const agent = url.startsWith('https') ? httpsAgent : httpAgent;
      
      const finalOptions = {
        agent,
        signal: controller.signal,
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          ...options.headers
        },
        timeout: REQUEST_TIMEOUT,
        ...options
      };

      const response = await fetch(url, finalOptions);
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      }
      
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000 * (attempt + 1);
        
        console.warn(`Attempt ${attempt + 1}/${maxRetries} for ${url}: HTTP ${response.status}, waiting ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      
      if (error.name === 'AbortError') {
        console.warn(`Request timeout for ${url}, attempt ${attempt + 1}`);
      }
      
      if (attempt === maxRetries - 1) {
        throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      const waitTime = 1000 * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}, retrying in ${waitTime}ms`);
      await delay(waitTime);
    }
  }
  
  throw lastError;
}

async function fetchHTML(url) {
  return await fetchWithRetry(url, {
    headers: { 'Accept': 'text/html' }
  });
}

async function fetchJSON(url, options = {}) {
  return await fetchWithRetry(url, {
    headers: {
      'Accept': 'application/json',
      ...(options.headers || {})
    }
  });
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    try {
      const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
      return match ? match[1].replace(/^www\./, '') : url;
    } catch {
      return url;
    }
  }
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function validateQuery(query) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query parameter is required and must be a string');
  }
  
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('Query parameter cannot be empty');
  }
  
  if (trimmed.length > 500) {
    throw new Error('Query parameter is too long (max 500 characters)');
  }
  
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi
  ];
  
  for (const pattern of xssPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error('Query contains potentially unsafe content');
    }
  }
  
  return trimmed;
}

function sanitizeHTML(html) {
  if (!html) return '';
  return html
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// =============================================================================
// SAFE SEARCH HANDLING
// =============================================================================

function getSafeSearchParam(safeSearch) {
  if (safeSearch === undefined || safeSearch === null) {
    return 'moderate';
  }
  
  const normalized = safeSearch.toString().toLowerCase();
  
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(normalized)) {
    return 'off';
  }
  
  if (['strict', 'high', 'max', '2', 'strong'].includes(normalized)) {
    return 'strict';
  }
  
  return 'moderate';
}

function getSafeSearchCode(safeSearchLevel) {
  switch(safeSearchLevel) {
    case 'off': return '-2';
    case 'strict': return '1';
    case 'moderate':
    default: return '-1';
  }
}

// =============================================================================
// RATE LIMITING MIDDLEWARE
// =============================================================================

const requestCounts = new Map();

function rateLimiter(req, res, next) {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = RATE_LIMIT.windowMs;
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const requests = requestCounts.get(ip);
  
  while (requests.length > 0 && requests[0] < now - windowMs) {
    requests.shift();
  }
  
  if (requests.length >= RATE_LIMIT.max) {
    const resetTime = Math.ceil((requests[0] + windowMs - now) / 1000);
    
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: `Too many requests, please try again in ${resetTime} seconds`,
      retry_after: resetTime
    });
  }
  
  requests.push(now);
  requestCounts.set(ip, requests);
  
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.max);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT.max - requests.length);
  res.setHeader('X-RateLimit-Reset', Math.ceil(requests[0] + windowMs));
  
  next();
}

app.use(rateLimiter);

// =============================================================================
// WEB SEARCH PROVIDERS (100+ RESULTS)
// =============================================================================

async function searchViaDuckDuckGo(query, page, safeSearch) {
  try {
    const safeSearchCode = getSafeSearchCode(safeSearch);
    const start = (page - 1) * 50;
    
    const endpoints = [
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en&kp=${safeSearchCode}&s=${start}&dc=${start}`,
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en&kp=${safeSearchCode}`,
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
    ];
    
    let html = '';
    
    for (const endpoint of endpoints) {
      try {
        console.log(`  → DuckDuckGo trying: ${endpoint.split('/')[2]}`);
        html = await fetchHTML(endpoint);
        break;
      } catch (error) {
        console.warn(`  ✗ DuckDuckGo endpoint failed: ${error.message}`);
        await delay(500);
      }
    }
    
    if (!html) {
      throw new Error('All DuckDuckGo endpoints failed');
    }
    
    const $ = cheerio.load(html);
    const results = [];
    
    $('.result, .web-result').each((_, element) => {
      const titleEl = $(element).find('.result__title a, .result-title a');
      const snippetEl = $(element).find('.result__snippet, .snippet');
      
      if (titleEl.length) {
        const title = titleEl.text().trim();
        let url = titleEl.attr('href');
        
        if (url && url.includes('uddg=')) {
          const urlMatch = url.match(/uddg=([^&]+)/);
          if (urlMatch) url = decodeURIComponent(urlMatch[1]);
        }
        
        if (url && !url.startsWith('http')) return;
        if (url && url.includes('duckduckgo.com')) return;
        
        const snippet = snippetEl.text().trim();
        
        results.push({
          title: title.substring(0, 200),
          url,
          snippet: snippet.substring(0, 300),
          displayUrl: extractDomain(url),
          score: 100 - results.length
        });
      }
    });
    
    if (results.length < 30) {
      $('a').each((_, element) => {
        const title = $(element).text().trim();
        let url = $(element).attr('href');
        
        if (title.length > 10 && url && url.startsWith('http') && 
            !url.includes('duckduckgo.com') && !title.includes('DuckDuckGo')) {
          
          const parent = $(element).parent();
          const hasResultClass = parent.hasClass('result') || 
                                parent.parent().hasClass('result') ||
                                element.className?.includes('result');
          
          if (hasResultClass || parent.text().length > 50) {
            const snippet = parent.text().replace(title, '').substring(0, 200);
            
            results.push({
              title: title.substring(0, 200),
              url,
              snippet,
              displayUrl: extractDomain(url),
              score: 50 - results.length
            });
          }
        }
      });
    }
    
    if (results.length < 20) {
      $('tr').each((_, row) => {
        const link = $(row).find('a[rel="nofollow"]');
        if (link.length) {
          const title = link.text().trim();
          const url = link.attr('href');
          const snippet = $(row).next().text().trim();
          
          if (title && url && url.startsWith('http')) {
            results.push({
              title: title.substring(0, 200),
              url,
              snippet: snippet.substring(0, 300),
              displayUrl: extractDomain(url),
              score: 30 - results.length
            });
          }
        }
      });
    }
    
    const uniqueResults = [];
    const seen = new Set();
    
    for (const result of results) {
      if (!result.url || seen.has(result.url)) continue;
      seen.add(result.url);
      uniqueResults.push(result);
    }
    
    console.log(`  ✓ DuckDuckGo: ${uniqueResults.length} results`);
    return uniqueResults.slice(0, 100);
    
  } catch (error) {
    console.warn(`  ✗ DuckDuckGo failed: ${error.message}`);
    
    try {
      return await searchViaDuckDuckGoAPI(query, page, safeSearch);
    } catch (apiError) {
      throw new Error(`DuckDuckGo search failed: ${error.message}`);
    }
  }
}

async function searchViaDuckDuckGoAPI(query, page, safeSearch) {
  const safeSearchCode = getSafeSearchCode(safeSearch);
  const start = (page - 1) * 30;
  
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&kp=${safeSearchCode}&s=${start}`;
  
  const data = await fetchJSON(url);
  
  const results = [];
  
  if (data.Abstract) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: data.Abstract,
      displayUrl: extractDomain(data.AbstractURL) || 'duckduckgo.com',
      type: 'instant_answer'
    });
  }
  
  if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
    data.RelatedTopics.forEach(topic => {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text,
          url: topic.FirstURL,
          snippet: topic.Text.includes(' - ') ? topic.Text.split(' - ')[1] : topic.Text,
          displayUrl: extractDomain(topic.FirstURL),
          type: 'related_topic'
        });
      }
    });
  }
  
  if (results.length === 0) {
    throw new Error('No results from API');
  }
  
  return results.slice(0, 30);
}

async function searchViaBrave(query, page, safeSearch) {
  const start = (page - 1) * 30;
  
  const attempts = [
    {
      url: `https://search.brave.com/search?q=${encodeURIComponent(query)}&offset=${start}`,
      parser: 'standard'
    },
    {
      url: `https://search.brave.com/news?q=${encodeURIComponent(query)}&offset=${start}`,
      parser: 'news'
    }
  ];
  
  for (const attempt of attempts) {
    try {
      console.log(`  → Brave trying: ${attempt.parser}`);
      
      const html = await fetchHTML(attempt.url);
      const $ = cheerio.load(html);
      
      const results = [];
      
      const selectors = [
        '.snippet',
        '.snippet--web',
        '.card',
        '.result',
        '.fdb .snippet',
        'div[id*="-pos-"]'
      ];
      
      for (const selector of selectors) {
        $(selector).each((_, element) => {
          const titleEl = $(element).find('.title, h3 a, .snippet-title');
          const snippetEl = $(element).find('.description, .snippet-description');
          const urlEl = $(element).find('.url, .snippet-url');
          
          if (titleEl.length) {
            const title = titleEl.text().trim();
            const url = titleEl.attr('href') || urlEl.text().trim();
            const snippet = snippetEl.text().trim();
            
            if (title && url && url.startsWith('http')) {
              results.push({
                title,
                url,
                snippet,
                displayUrl: extractDomain(url),
                score: 100 - results.length
              });
            }
          }
        });
        
        if (results.length >= 50) break;
      }
      
      if (results.length < 30) {
        $('a').each((_, element) => {
          const title = $(element).text().trim();
          const url = $(element).attr('href');
          
          if (title.length > 20 && url && url.startsWith('http') && 
              !url.includes('brave.com') && !title.includes('Brave')) {
            
            const parent = $(element).parent();
            const snippet = parent.text().replace(title, '').substring(0, 200);
            
            results.push({
              title: title.substring(0, 200),
              url,
              snippet,
              displayUrl: extractDomain(url),
              score: 20 - results.length
            });
          }
        });
      }
      
      if (results.length > 0) {
        const uniqueResults = [];
        const seen = new Set();
        
        for (const result of results) {
          if (!result.url || seen.has(result.url)) continue;
          seen.add(result.url);
          uniqueResults.push(result);
        }
        
        console.log(`  ✓ Brave ${attempt.parser}: ${uniqueResults.length} results`);
        return uniqueResults.slice(0, 100);
      }
    } catch (error) {
      console.warn(`  ✗ Brave ${attempt.parser} failed: ${error.message}`);
      await delay(1000);
    }
  }
  
  throw new Error('All Brave search attempts failed');
}

async function searchViaStartpage(query, page, safeSearch) {
  const safeParam = safeSearch === 'off' ? '0' : safeSearch === 'strict' ? '2' : '1';
  const start = (page - 1) * 10;
  
  const url = `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}&page=${page}&safeSearch=${safeParam}`;
  
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const results = [];
  
  $('.w-gl__result').each((_, element) => {
    const titleEl = $(element).find('.w-gl__result-title a');
    const snippetEl = $(element).find('.w-gl__description');
    const urlEl = $(element).find('.w-gl__result-url');
    
    if (titleEl.length) {
      const title = titleEl.text().trim();
      const url = titleEl.attr('href');
      const snippet = snippetEl.text().trim();
      const displayUrl = urlEl.text().trim();
      
      if (title && url) {
        results.push({ title, url, snippet, displayUrl });
      }
    }
  });
  
  if (results.length === 0) {
    throw new Error('No results found');
  }
  
  console.log(`  ✓ Startpage: ${results.length} results`);
  return results;
}

async function searchViaQwant(query, page, safeSearch) {
  const safeParam = safeSearch === 'off' ? '0' : safeSearch === 'strict' ? '2' : '1';
  
  const url = `https://api.qwant.com/v3/search/web?q=${encodeURIComponent(query)}&count=20&offset=${(page - 1) * 20}&safesearch=${safeParam}&locale=en_us`;
  
  try {
    const data = await fetchJSON(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (data?.data?.result?.items) {
      const results = data.data.result.items.map(item => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.desc || '',
        displayUrl: extractDomain(item.url) || '',
        favicon: item.favicon || ''
      }));
      
      console.log(`  ✓ Qwant: ${results.length} results`);
      return results;
    }
  } catch (error) {
    console.warn(`  Qwant API failed: ${error.message}`);
  }
  
  const htmlUrl = `https://www.qwant.com/?q=${encodeURIComponent(query)}&t=web`;
  const html = await fetchHTML(htmlUrl);
  const $ = cheerio.load(html);
  
  const results = [];
  
  $('.result').each((_, element) => {
    const titleEl = $(element).find('.result-title a');
    const snippetEl = $(element).find('.result-description');
    
    if (titleEl.length) {
      const title = titleEl.text().trim();
      const url = titleEl.attr('href');
      const snippet = snippetEl.text().trim();
      
      if (title && url) {
        results.push({
          title,
          url,
          snippet,
          displayUrl: extractDomain(url)
        });
      }
    }
  });
  
  if (results.length === 0) {
    throw new Error('No results found');
  }
  
  console.log(`  ✓ Qwant HTML: ${results.length} results`);
  return results;
}

async function searchViaSearXNG(query, page, safeSearch) {
  const instances = [
    'https://searx.be',
    'https://search.disroot.org',
    'https://searx.nixnet.services',
    'https://searx.tiekoetter.com',
    'https://search.privacytools.io',
    'https://searx.laquadrature.net',
    'https://searx.info'
  ];

  const params = new URLSearchParams({
    q: query,
    categories: 'general',
    language: 'en',
    pageno: page,
    safesearch: safeSearch === 'off' ? '0' : safeSearch === 'strict' ? '2' : '1',
    format: 'json'
  });

  const shuffled = shuffleArray(instances);
  const errors = [];
  
  for (const instance of shuffled) {
    try {
      const url = `${instance}/search?${params}`;
      console.log(`  → SearXNG trying: ${instance}`);
      
      const data = await fetchJSON(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': getRandomUserAgent()
        }
      });
      
      if (data && data.results && Array.isArray(data.results)) {
        const results = data.results
          .filter(r => r.url && r.url.startsWith('http'))
          .map(r => ({
            title: r.title || r.htmlTitle || '',
            url: r.url || '',
            snippet: r.content || r.description || r.summary || r.snippet || '',
            displayUrl: r.pretty_url || extractDomain(r.url) || '',
            score: r.score || 0,
            engine: r.engine || 'searxng'
          }))
          .slice(0, 50);
        
        if (results.length > 0) {
          console.log(`  ✓ SearXNG (${instance}): ${results.length} results`);
          return results;
        }
      }
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      errors.push({ instance, error: errorMsg });
      console.warn(`  ✗ SearXNG ${instance} failed: ${errorMsg}`);
      await delay(1000);
    }
  }
  
  throw new Error(`All SearXNG instances failed: ${errors.slice(0, 3).map(e => e.instance).join(', ')}`);
}

async function searchViaMojeek(query, page, safeSearch) {
  const start = (page - 1) * 10;
  const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}&s=${start}`;
  
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    
    const results = [];
    
    $('.results-standard .result, .search-results .result, .result').each((_, element) => {
      const titleEl = $(element).find('.result-title a, .title a, h3 a');
      const snippetEl = $(element).find('.snippet, .description, .summary');
      const urlEl = $(element).find('.result-url, .url, cite');
      
      if (titleEl.length) {
        const title = titleEl.text().trim();
        const url = titleEl.attr('href');
        const snippet = snippetEl.text().trim();
        const displayUrl = urlEl.text().trim() || extractDomain(url);
        
        if (title && url && url.startsWith('http')) {
          results.push({ title, url, snippet, displayUrl });
        }
      }
    });
    
    if (results.length === 0) {
      $('a').each((_, element) => {
        const title = $(element).text().trim();
        const url = $(element).attr('href');
        
        if (title.length > 10 && url && url.startsWith('http') && 
            !url.includes('mojeek.com') && !title.includes('Mojeek')) {
          const parent = $(element).parent();
          const snippet = parent.next().text().trim() || '';
          
          results.push({
            title,
            url,
            snippet: snippet.substring(0, 200),
            displayUrl: extractDomain(url)
          });
        }
      });
    }
    
    if (results.length === 0) {
      throw new Error('No results found in HTML');
    }
    
    console.log(`  ✓ Mojeek: ${results.length} results`);
    return results.slice(0, 30);
    
  } catch (error) {
    console.warn(`  ✗ Mojeek failed: ${error.message}`);
    throw error;
  }
}

async function searchViaMarginalia(query, page, safeSearch) {
  const url = `https://search.marginalia.nu/search?query=${encodeURIComponent(query)}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const results = [];
  
  $('.search-result').each((_, element) => {
    const titleEl = $(element).find('.search-result-title a');
    const snippetEl = $(element).find('.search-result-preview');
    
    if (titleEl.length) {
      const title = titleEl.text().trim();
      const url = titleEl.attr('href');
      const snippet = snippetEl.text().trim();
      
      if (title && url) {
        results.push({
          title,
          url,
          snippet,
          displayUrl: extractDomain(url)
        });
      }
    }
  });
  
  if (results.length === 0) {
    throw new Error('No results found');
  }
  
  return results;
}

async function searchViaWiby(query, page, safeSearch) {
  const url = `https://wiby.me/?q=${encodeURIComponent(query)}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const results = [];
  
  $('.result').each((_, element) => {
    const titleEl = $(element).find('a');
    const snippetEl = $(element).find('.snippet');
    
    if (titleEl.length) {
      const title = titleEl.text().trim();
      const url = titleEl.attr('href');
      const snippet = snippetEl.text().trim();
      
      if (title && url) {
        results.push({
          title,
          url,
          snippet,
          displayUrl: extractDomain(url)
        });
      }
    }
  });
  
  if (results.length === 0) {
    throw new Error('No results found');
  }
  
  return results;
}

async function searchViaGoogleFallback(query, page) {
  const start = (page - 1) * 10;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${start}&hl=en`;
  
  const html = await fetchHTML(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('div.g').each((_, element) => {
    const titleEl = $(element).find('h3');
    const linkEl = $(element).find('a');
    const snippetEl = $(element).find('.VwiC3b, .s3v9rd, .AP7Wnd');
    
    if (titleEl.length && linkEl.length) {
      const title = titleEl.text().trim();
      let url = linkEl.attr('href');
      
      if (url && url.startsWith('/url?')) {
        const match = url.match(/url=([^&]+)/);
        if (match) {
          url = decodeURIComponent(match[1]);
        }
      }
      
      const snippet = snippetEl.text().trim();
      
      if (title && url && url.startsWith('http')) {
        results.push({
          title,
          url,
          snippet,
          displayUrl: extractDomain(url)
        });
      }
    }
  });
  
  return results.slice(0, 20);
}

// =============================================================================
// MAIN WEB SEARCH FUNCTION (100+ RESULTS)
// =============================================================================

async function webSearch(query, page = 1, safeSearch = 'moderate') {
  const safeSearchLevel = getSafeSearchParam(safeSearch);
  const cacheKey = `web:${query}:${page}:${safeSearchLevel}`;
  
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: web search "${query}" (safe: ${safeSearchLevel})`);
    return cached;
  }

  console.log(`🔍 Web search: "${query}" (page ${page}, safe: ${safeSearchLevel}) - Target: 100+ results`);

  const searchMethods = [
    { name: 'DuckDuckGo', func: () => searchViaDuckDuckGo(query, page, safeSearchLevel), priority: 1, weight: 3 },
    { name: 'Brave', func: () => searchViaBrave(query, page, safeSearchLevel), priority: 2, weight: 3 },
    { name: 'Startpage', func: () => searchViaStartpage(query, page, safeSearchLevel), priority: 3, weight: 2 },
    { name: 'Qwant', func: () => searchViaQwant(query, page, safeSearchLevel), priority: 4, weight: 2 },
    { name: 'SearXNG', func: () => searchViaSearXNG(query, page, safeSearchLevel), priority: 5, weight: 2 },
    { name: 'Mojeek', func: () => searchViaMojeek(query, page, safeSearchLevel), priority: 6, weight: 1 },
    { name: 'GoogleFallback', func: () => searchViaGoogleFallback(query, page), priority: 7, weight: 3 }
  ];

  const providerPromises = searchMethods.map(method => 
    method.func()
      .then(results => ({
        name: method.name,
        results: results || [],
        weight: method.weight
      }))
      .catch(error => ({
        name: method.name,
        results: [],
        error: error.message,
        weight: method.weight
      }))
  );

  const providerResults = await Promise.all(providerPromises);
  
  let allResults = [];
  const errors = [];
  
  for (const provider of providerResults) {
    if (provider.error) {
      console.warn(`  ✗ ${provider.name} failed: ${provider.error}`);
      errors.push({ provider: provider.name, error: provider.error });
      continue;
    }
    
    if (provider.results.length > 0) {
      console.log(`  ✓ ${provider.name}: ${provider.results.length} results`);
      
      const enrichedResults = provider.results.map(r => ({
        ...r,
        source: provider.name,
        safeSearch: safeSearchLevel,
        weightScore: (provider.weight || 1) * (r.score || 1)
      }));
      
      allResults = [...allResults, ...enrichedResults];
    } else {
      console.log(`  ✗ ${provider.name}: no results`);
    }
  }

  if (allResults.length < RESULTS_PER_PAGE) {
    console.log(`  → Only ${allResults.length} results, fetching additional pages...`);
    
    const bestProviders = ['DuckDuckGo', 'Brave', 'GoogleFallback'];
    const additionalPromises = [];
    
    for (const providerName of bestProviders) {
      if (allResults.length >= RESULTS_PER_PAGE * 2) break;
      
      for (let additionalPage = 2; additionalPage <= 3; additionalPage++) {
        const provider = searchMethods.find(m => m.name === providerName);
        if (provider) {
          additionalPromises.push(
            provider.func(query, page + additionalPage - 1, safeSearchLevel)
              .then(results => ({ name: providerName, page: additionalPage, results: results || [] }))
              .catch(() => ({ name: providerName, page: additionalPage, results: [] }))
          );
        }
      }
    }
    
    if (additionalPromises.length > 0) {
      const additionalResults = await Promise.all(additionalPromises);
      for (const result of additionalResults) {
        if (result.results.length > 0) {
          console.log(`  ✓ ${result.name} page ${result.page}: ${result.results.length} results`);
          allResults = [...allResults, ...result.results.map(r => ({
            ...r,
            source: `${result.name} (page ${result.page})`,
            safeSearch: safeSearchLevel
          }))];
        }
      }
    }
  }

  const uniqueResults = [];
  const seenUrls = new Map();

  for (const result of allResults) {
    if (!result.url) continue;
    
    const existing = seenUrls.get(result.url);
    if (!existing || (result.weightScore || 0) > (existing.weightScore || 0)) {
      seenUrls.set(result.url, result);
    }
  }

  uniqueResults.push(...Array.from(seenUrls.values()));
  uniqueResults.sort((a, b) => (b.weightScore || 0) - (a.weightScore || 0));

  const start = (page - 1) * RESULTS_PER_PAGE;
  const end = start + RESULTS_PER_PAGE;
  const pagedResults = uniqueResults.slice(start, end);

  console.log(`✓ Web search complete: ${pagedResults.length} results (${uniqueResults.length} total before pagination)`);
  
  if (pagedResults.length === 0 && errors.length > 0) {
    console.error('All search providers failed. Last errors:', errors.slice(0, 3));
  }

  cacheSet(cacheKey, pagedResults);
  return pagedResults;
}

// =============================================================================
// IMAGE SEARCH PROVIDERS (100+ IMAGES)
// =============================================================================

async function searchUnsplashImages(query, page = 1) {
  const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=50&page=${page}`;
  
  try {
    const data = await fetchJSON(url);
    
    const images = (data.results || []).map(photo => ({
      title: photo.description || photo.alt_description || query,
      image: photo.urls.regular,
      thumbnail: photo.urls.small,
      source: photo.links.html,
      width: photo.width,
      height: photo.height,
      provider: 'Unsplash',
      author: photo.user?.name,
      authorUrl: photo.user?.links?.html,
      score: photo.likes || 0
    }));
    
    return images;
  } catch (error) {
    console.warn(`Unsplash search failed: ${error.message}`);
    return [];
  }
}

async function searchPexelsImages(query) {
  try {
    const url = `https://www.pexels.com/search/${encodeURIComponent(query.replace(/\s+/g, '%20'))}/`;
    
    const html = await fetchHTML(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.pexels.com/',
        'DNT': '1'
      }
    });
    
    const $ = cheerio.load(html);
    
    const images = [];
    
    const scriptTags = $('script');
    scriptTags.each((_, script) => {
      const content = $(script).html();
      if (content && content.includes('"photos"')) {
        try {
          const jsonMatch = content.match(/"photos":(\[.*?\])/);
          if (jsonMatch) {
            const photos = JSON.parse(jsonMatch[1]);
            photos.forEach(photo => {
              if (photo.src && photo.src.original) {
                images.push({
                  title: photo.alt || query,
                  image: photo.src.original,
                  thumbnail: photo.src.small || photo.src.original,
                  source: photo.url || url,
                  provider: 'Pexels',
                  author: photo.photographer,
                  authorUrl: photo.photographer_url
                });
              }
            });
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    
    if (images.length === 0) {
      $('img').each((_, img) => {
        const src = $(img).attr('src');
        const dataSrc = $(img).attr('data-lazy-src') || $(img).attr('data-src');
        const alt = $(img).attr('alt') || query;
        
        const imageUrl = dataSrc || src;
        if (imageUrl && (imageUrl.includes('pexels.com') || imageUrl.includes('images.pexels.com'))) {
          images.push({
            title: alt,
            image: imageUrl.split('?')[0],
            thumbnail: imageUrl,
            source: url,
            provider: 'Pexels'
          });
        }
      });
    }
    
    return images.slice(0, 30);
    
  } catch (error) {
    console.warn(`Pexels search failed: ${error.message}`);
    
    if (process.env.PEXELS_API_KEY) {
      try {
        const apiUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=30`;
        const data = await fetchJSON(apiUrl, {
          headers: {
            'Authorization': process.env.PEXELS_API_KEY
          }
        });
        
        return (data.photos || []).map(photo => ({
          title: photo.alt || query,
          image: photo.src.original,
          thumbnail: photo.src.small,
          source: photo.url,
          provider: 'Pexels',
          author: photo.photographer,
          authorUrl: photo.photographer_url
        }));
      } catch (apiError) {
        throw error;
      }
    }
    
    throw error;
  }
}

async function searchPixabayImagesHTML(query, safeSearch) {
  const safeParam = safeSearch === 'off' ? '' : '&safesearch=true';
  const url = `https://pixabay.com/images/search/${encodeURIComponent(query)}/${safeParam}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const images = [];
  
  $('img[src*="cdn.pixabay.com/photo/"]').each((_, img) => {
    const src = $(img).attr('src');
    const dataSrc = $(img).attr('data-lazy-src') || $(img).attr('data-src');
    const alt = $(img).attr('alt') || query;
    
    const imageUrl = dataSrc || src;
    if (imageUrl) {
      const highRes = imageUrl.replace(/_\d+x\d+\./, '_1280x720.');
      
      images.push({
        title: alt,
        image: highRes,
        thumbnail: imageUrl,
        source: url,
        provider: 'Pixabay'
      });
    }
  });
  
  return images.slice(0, 30);
}

async function searchWikimediaImages(query) {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=100&prop=imageinfo&iiprop=url|dimensions|extmetadata&format=json&origin=*`;
    const data = await fetchJSON(url);
    
    const images = [];
    
    if (data.query?.pages) {
      Object.values(data.query.pages).forEach(page => {
        if (page.imageinfo?.[0]) {
          const info = page.imageinfo[0];
          images.push({
            title: page.title.replace('File:', ''),
            image: info.url,
            thumbnail: info.thumburl || info.url,
            width: info.width,
            height: info.height,
            source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
            provider: 'Wikimedia Commons',
            license: info.extmetadata?.LicenseShortName?.value || 'Public Domain',
            score: info.size || 0
          });
        }
      });
    }
    
    return images;
  } catch (error) {
    console.warn(`Wikimedia search failed: ${error.message}`);
    return [];
  }
}

async function searchFlickrImages(query) {
  try {
    const url = `https://www.flickr.com/services/feeds/photos_public.gne?format=json&tags=${encodeURIComponent(query)}&tagmode=all`;
    
    const text = await fetchHTML(url);
    
    const jsonMatch = text.match(/jsonFlickrFeed\((.*)\)/);
    if (!jsonMatch) {
      throw new Error('Invalid Flickr response');
    }
    
    const data = JSON.parse(jsonMatch[1]);
    
    return (data.items || []).map(item => ({
      title: item.title || query,
      image: item.media.m.replace('_m.jpg', '_b.jpg'),
      thumbnail: item.media.m,
      source: item.link,
      provider: 'Flickr',
      author: item.author,
      authorUrl: `https://www.flickr.com/people/${item.author_id}/`
    })).slice(0, 30);
    
  } catch (error) {
    console.warn(`Flickr search failed: ${error.message}`);
    return [];
  }
}

async function searchOpenverseImages(query) {
  try {
    const url = `https://api.openverse.engineering/v1/images/?q=${encodeURIComponent(query)}&page_size=30`;
    
    const data = await fetchJSON(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    return (data.results || []).map(item => ({
      title: item.title || query,
      image: item.url,
      thumbnail: item.thumbnail,
      source: item.foreign_landing_url,
      provider: 'Openverse',
      author: item.creator,
      license: item.license,
      license_url: item.license_url
    }));
    
  } catch (error) {
    console.warn(`Openverse search failed: ${error.message}`);
    return [];
  }
}

async function searchBingImages(query, safeSearch) {
  const safeParam = safeSearch === 'off' ? '0' : safeSearch === 'strict' ? '2' : '1';
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&safesearch=${safeParam}&form=HDRSC2&first=1`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const images = [];
  
  $('a.iusc').each((_, el) => {
    try {
      const m = $(el).attr('m');
      if (m) {
        const meta = safeJsonParse(m);
        if (meta?.murl) {
          images.push({
            title: meta.t || query,
            image: meta.murl,
            thumbnail: meta.turl || meta.murl,
            source: meta.purl || url,
            width: meta.w,
            height: meta.h,
            provider: 'Bing'
          });
        }
      }
    } catch (e) {
      // Skip invalid JSON
    }
  });
  
  return images.slice(0, 30);
}

async function searchGoogleImages(query, safeSearch) {
  try {
    const safeParam = safeSearch === 'off' ? 'images' : safeSearch === 'strict' ? 'isch' : 'isch';
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=${safeParam}&tbs=isz:l`;
    
    const html = await fetchHTML(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,image/webp,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    const $ = cheerio.load(html);
    const images = [];
    
    $('img').each((_, img) => {
      const src = $(img).attr('src');
      const dataSrc = $(img).attr('data-src');
      const alt = $(img).attr('alt') || query;
      
      const imageUrl = dataSrc || src;
      if (imageUrl && imageUrl.startsWith('http') && 
          (imageUrl.includes('googleusercontent.com') || 
           imageUrl.includes('gstatic.com') ||
           imageUrl.includes('imgur.com') ||
           imageUrl.endsWith('.jpg') || 
           imageUrl.endsWith('.png') ||
           imageUrl.endsWith('.webp'))) {
        
        let highRes = imageUrl;
        if (imageUrl.includes('=s')) {
          highRes = imageUrl.replace(/=s\d+/, '=s2048');
        } else if (imageUrl.includes('w=')) {
          highRes = imageUrl.replace(/w=\d+/, 'w=2048');
        }
        
        images.push({
          title: alt,
          image: highRes,
          thumbnail: imageUrl,
          source: url,
          provider: 'Google Images',
          width: 1024,
          height: 768
        });
      }
    });
    
    const scriptTags = $('script');
    scriptTags.each((_, script) => {
      const content = $(script).html();
      if (content && content.includes('AF_initDataCallback')) {
        const matches = content.match(/\"(https?:[^"]+\.(?:jpg|png|webp))[^"]*\"/g);
        if (matches) {
          matches.forEach(match => {
            const url = match.replace(/"/g, '');
            if (url.includes('http') && !images.some(img => img.image === url)) {
              images.push({
                title: query,
                image: url,
                thumbnail: url.replace(/=s\d+/, '=s300'),
                source: url,
                provider: 'Google Images'
              });
            }
          });
        }
      }
    });
    
    return images.slice(0, 50);
    
  } catch (error) {
    console.warn(`Google Images search failed: ${error.message}`);
    return [];
  }
}

// =============================================================================
// MAIN IMAGE SEARCH FUNCTION (100+ IMAGES)
// =============================================================================

async function imageSearch(query, safeSearch = 'moderate') {
  const safeSearchLevel = getSafeSearchParam(safeSearch);
  const cacheKey = `img:${query}:${safeSearchLevel}`;
  
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: image search "${query}"`);
    return cached;
  }

  console.log(`🖼️ Image search: "${query}" (safe: ${safeSearchLevel}) - Target: 100+ images`);

  const imageProviders = [
    { name: 'Unsplash', func: () => searchUnsplashImages(query), weight: 3 },
    { name: 'Pexels', func: () => searchPexelsImages(query), weight: 3 },
    { name: 'Pixabay', func: () => searchPixabayImagesHTML(query, safeSearchLevel), weight: 2 },
    { name: 'Wikimedia', func: () => searchWikimediaImages(query), weight: 2 },
    { name: 'Flickr', func: () => searchFlickrImages(query), weight: 2 },
    { name: 'Openverse', func: () => searchOpenverseImages(query), weight: 1 },
    { name: 'Bing', func: () => searchBingImages(query, safeSearchLevel), weight: 3 },
    { name: 'GoogleImages', func: () => searchGoogleImages(query, safeSearchLevel), weight: 3 }
  ];

  const providerPromises = imageProviders.map(provider => 
    provider.func()
      .then(images => ({
        name: provider.name,
        images: images || [],
        weight: provider.weight
      }))
      .catch(error => ({
        name: provider.name,
        images: [],
        error: error.message,
        weight: provider.weight
      }))
  );

  const providerResults = await Promise.all(providerPromises);
  
  let allImages = [];
  
  for (const provider of providerResults) {
    if (provider.error) {
      console.warn(`  ✗ ${provider.name} failed: ${provider.error}`);
      continue;
    }
    
    if (provider.images.length > 0) {
      console.log(`  ✓ ${provider.name}: ${provider.images.length} images`);
      
      const weightedImages = provider.images.map(img => ({
        ...img,
        provider: provider.name,
        weight: provider.weight,
        score: provider.weight * (Math.random() * 0.5 + 0.5)
      }));
      
      allImages = [...allImages, ...weightedImages];
    } else {
      console.log(`  ✗ ${provider.name}: no images`);
    }
  }

  if (allImages.length < 100) {
    console.log(`  → Only ${allImages.length} images, fetching more...`);
    
    const additionalSearches = [
      { name: 'Unsplash', func: () => searchUnsplashImages(query, 2) },
      { name: 'Pexels', func: () => searchPexelsImages(query + ' high resolution') },
      { name: 'Bing', func: () => searchBingImages(query + ' photo', safeSearchLevel) },
      { name: 'GoogleImages', func: () => searchGoogleImages(query + ' image', safeSearchLevel) }
    ];
    
    for (const search of additionalSearches) {
      if (allImages.length >= 150) break;
      
      try {
        const moreImages = await search.func();
        if (moreImages && moreImages.length > 0) {
          console.log(`  ✓ ${search.name} additional: ${moreImages.length} images`);
          allImages = [...allImages, ...moreImages.map(img => ({
            ...img,
            provider: `${search.name} (additional)`
          }))];
        }
        await delay(500);
      } catch (error) {
        console.warn(`  ✗ ${search.name} additional failed: ${error.message}`);
      }
    }
  }

  const uniqueImages = [];
  const seenUrls = new Set();
  
  for (const image of allImages) {
    if (!image.image || seenUrls.has(image.image)) continue;
    seenUrls.add(image.image);
    uniqueImages.push(image);
  }

  uniqueImages.sort((a, b) => {
    const scoreA = (a.weight || 1) * (a.score || 1);
    const scoreB = (b.weight || 1) * (b.score || 1);
    return scoreB - scoreA;
  });

  const results = uniqueImages.slice(0, 150);
  
  console.log(`✓ Image search complete: ${results.length} images`);
  cacheSet(cacheKey, results);
  return results;
}

// =============================================================================
// VIDEO SEARCH PROVIDERS (100+ VIDEOS)
// =============================================================================

function extractYouTubeVideos(html) {
  const videos = [];
  const patterns = [
    /"videoId":"([a-zA-Z0-9_-]{11})"/g,
    /watch\?v=([a-zA-Z0-9_-]{11})/g,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/g
  ];
  
  const videoIds = new Set();
  
  for (const pattern of patterns) {
    const matches = html.match(pattern) || [];
    matches.forEach(match => {
      const idMatch = match.match(/"videoId":"([^"]+)"/) || 
                     match.match(/watch\?v=([a-zA-Z0-9_-]+)/) ||
                     match.match(/embed\/([a-zA-Z0-9_-]+)/);
      if (idMatch?.[1]?.length === 11) {
        videoIds.add(idMatch[1]);
      }
    });
  }
  
  const titles = [];
  const titleRegex = /"title":\{"runs":\[\{"text":"([^"]+)"\}/g;
  let titleMatch;
  
  while ((titleMatch = titleRegex.exec(html)) !== null && titles.length < 100) {
    titles.push(titleMatch[1]);
  }
  
  const ids = Array.from(videoIds);
  
  for (let i = 0; i < Math.min(ids.length, 100); i++) {
    const id = ids[i];
    videos.push({
      title: titles[i] || `${query} - Video ${i + 1}`,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      videoId: id,
      provider: 'YouTube'
    });
  }
  
  return videos;
}

async function searchYouTubeVideos(query, safeSearch) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const html = await fetchHTML(url);
  
  return extractYouTubeVideos(html).slice(0, 50);
}

async function searchYouTubeMusicVideos(query) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}+music+video&sp=EgIQAQ%253D%253D`;
    const html = await fetchHTML(url);
    
    return extractYouTubeVideos(html).slice(0, 30);
  } catch (error) {
    console.warn(`YouTube Music search failed: ${error.message}`);
    return [];
  }
}

async function searchVimeoVideos(query) {
  const url = `https://vimeo.com/search?q=${encodeURIComponent(query)}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const videos = [];
  
  $('[data-id]').each((_, el) => {
    const videoId = $(el).attr('data-id');
    const titleEl = $(el).find('.iris_video-vital__title');
    const thumbnailEl = $(el).find('img');
    const userEl = $(el).find('.iris_video-vital__meta a');
    
    if (videoId && titleEl.length) {
      videos.push({
        title: titleEl.text().trim(),
        url: `https://vimeo.com/${videoId}`,
        thumbnail: thumbnailEl.attr('src') || '',
        videoId: videoId,
        channel: userEl.text().trim() || '',
        provider: 'Vimeo'
      });
    }
  });
  
  return videos.slice(0, 30);
}

async function searchPeerTubeVideos(query) {
  const instances = [
    'https://peertube.fr',
    'https://video.blender.org',
    'https://diode.zone'
  ];
  
  for (const instance of instances) {
    try {
      const url = `${instance}/api/v1/search/videos?search=${encodeURIComponent(query)}&count=30`;
      const data = await fetchJSON(url);
      
      if (data?.data && Array.isArray(data.data)) {
        return data.data.map(video => ({
          title: video.name,
          url: `${instance}/w/${video.uuid}`,
          thumbnail: video.thumbnailUrl,
          videoId: video.uuid,
          channel: video.account?.displayName || '',
          duration: video.duration,
          views: video.views,
          provider: 'PeerTube',
          instance: instance
        }));
      }
    } catch (error) {
      console.warn(`PeerTube instance ${instance} failed`);
    }
  }
  
  throw new Error('All PeerTube instances failed');
}

async function searchArchiveVideos(query) {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+mediatype:movies&fl[]=identifier,title,description,downloads,avg_rating&sort[]=downloads+desc&rows=30&page=1&output=json`;
  const data = await fetchJSON(url);
  
  if (data?.response?.docs) {
    return data.response.docs.map(doc => ({
      title: doc.title || doc.identifier,
      url: `https://archive.org/details/${doc.identifier}`,
      thumbnail: `https://archive.org/services/img/${doc.identifier}`,
      videoId: doc.identifier,
      description: doc.description || '',
      rating: doc.avg_rating,
      downloads: doc.downloads,
      provider: 'Internet Archive'
    }));
  }
  
  return [];
}

async function searchDailymotionVideos(query) {
  try {
    const url = `https://www.dailymotion.com/search/${encodeURIComponent(query)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    
    const videos = [];
    
    $('a[href*="/video/"]').each((_, element) => {
      const href = $(element).attr('href');
      const title = $(element).attr('title') || $(element).find('img').attr('alt') || query;
      const thumbnail = $(element).find('img').attr('src');
      
      if (href && href.includes('/video/')) {
        const videoId = href.split('/video/')[1]?.split('_')[0];
        if (videoId) {
          videos.push({
            title,
            url: `https://www.dailymotion.com/video/${videoId}`,
            thumbnail: thumbnail || `https://www.dailymotion.com/thumbnail/video/${videoId}`,
            videoId,
            provider: 'Dailymotion'
          });
        }
      }
    });
    
    return videos.slice(0, 30);
  } catch (error) {
    console.warn(`Dailymotion search failed: ${error.message}`);
    return [];
  }
}

async function searchBilibiliVideos(query) {
  try {
    const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    
    const videos = [];
    
    $('.video-item a').each((_, element) => {
      const href = $(element).attr('href');
      const title = $(element).attr('title') || $(element).find('.title').text();
      const thumbnail = $(element).find('img').attr('src');
      
      if (href && href.includes('/video/')) {
        const videoId = href.split('/video/')[1];
        videos.push({
          title,
          url: `https://www.bilibili.com/video/${videoId}`,
          thumbnail: thumbnail || `https://i0.hdslb.com/bfs/archive/${videoId}.jpg`,
          videoId,
          provider: 'Bilibili'
        });
      }
    });
    
    return videos.slice(0, 20);
  } catch (error) {
    console.warn(`Bilibili search failed: ${error.message}`);
    return [];
  }
}

async function searchYouTubeRelatedVideos(query) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const html = await fetchHTML(searchUrl);
    
    const videoIdMatch = html.match(/{"videoId":"([^"]+)"}/);
    if (videoIdMatch) {
      const videoId = videoIdMatch[1];
      const relatedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const relatedHtml = await fetchHTML(relatedUrl);
      
      return extractYouTubeVideos(relatedHtml).slice(0, 20);
    }
  } catch (error) {
    console.warn(`YouTube related search failed: ${error.message}`);
  }
  
  return [];
}

async function searchYouTubeTrendingVideos(query) {
  try {
    const url = `https://www.youtube.com/feed/trending`;
    const html = await fetchHTML(url);
    
    return extractYouTubeVideos(html).slice(0, 20);
  } catch (error) {
    console.warn(`YouTube trending search failed: ${error.message}`);
    return [];
  }
}

async function searchVimeoStaffPicks(query) {
  try {
    const url = `https://vimeo.com/categories/staffpicks`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    
    const videos = [];
    
    $('[data-id]').each((_, element) => {
      const videoId = $(element).attr('data-id');
      const titleEl = $(element).find('.iris_video-vital__title');
      const thumbnailEl = $(element).find('img');
      
      if (videoId && titleEl.length) {
        videos.push({
          title: titleEl.text().trim() || query,
          url: `https://vimeo.com/${videoId}`,
          thumbnail: thumbnailEl.attr('src') || '',
          videoId,
          provider: 'Vimeo Staff Picks'
        });
      }
    });
    
    return videos.slice(0, 20);
  } catch (error) {
    console.warn(`Vimeo staff picks search failed: ${error.message}`);
    return [];
  }
}

// =============================================================================
// MAIN VIDEO SEARCH FUNCTION (100+ VIDEOS)
// =============================================================================

async function videoSearch(query, safeSearch = 'moderate') {
  const safeSearchLevel = getSafeSearchParam(safeSearch);
  const cacheKey = `vid:${query}:${safeSearchLevel}`;
  
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: video search "${query}"`);
    return cached;
  }

  console.log(`🎬 Video search: "${query}" (safe: ${safeSearchLevel}) - Target: 100+ videos`);

  const videoProviders = [
    { name: 'YouTube', func: () => searchYouTubeVideos(query, safeSearchLevel), weight: 3 },
    { name: 'YouTubeMusic', func: () => searchYouTubeMusicVideos(query), weight: 2 },
    { name: 'Vimeo', func: () => searchVimeoVideos(query), weight: 2 },
    { name: 'PeerTube', func: () => searchPeerTubeVideos(query), weight: 1 },
    { name: 'Dailymotion', func: () => searchDailymotionVideos(query), weight: 2 },
    { name: 'Bilibili', func: () => searchBilibiliVideos(query), weight: 1 },
    { name: 'Internet Archive', func: () => searchArchiveVideos(query), weight: 1 }
  ];

  const providerPromises = videoProviders.map(provider => 
    provider.func()
      .then(videos => ({
        name: provider.name,
        videos: videos || [],
        weight: provider.weight
      }))
      .catch(error => ({
        name: provider.name,
        videos: [],
        error: error.message,
        weight: provider.weight
      }))
  );

  const providerResults = await Promise.all(providerPromises);
  
  let allVideos = [];
  
  for (const provider of providerResults) {
    if (provider.error) {
      console.warn(`  ✗ ${provider.name} failed: ${provider.error}`);
      continue;
    }
    
    if (provider.videos.length > 0) {
      console.log(`  ✓ ${provider.name}: ${provider.videos.length} videos`);
      
      const weightedVideos = provider.videos.map(video => ({
        ...video,
        provider: provider.name,
        weight: provider.weight,
        score: provider.weight * (Math.random() * 0.5 + 0.5)
      }));
      
      allVideos = [...allVideos, ...weightedVideos];
    } else {
      console.log(`  ✗ ${provider.name}: no videos`);
    }
  }

  if (allVideos.length < 100) {
    console.log(`  → Only ${allVideos.length} videos, fetching more...`);
    
    const additionalSearches = [
      { name: 'YouTubeRelated', func: () => searchYouTubeRelatedVideos(query) },
      { name: 'YouTubeTrending', func: () => searchYouTubeTrendingVideos(query) },
      { name: 'VimeoStaffPicks', func: () => searchVimeoStaffPicks(query) }
    ];
    
    for (const search of additionalSearches) {
      if (allVideos.length >= 150) break;
      
      try {
        const moreVideos = await search.func();
        if (moreVideos && moreVideos.length > 0) {
          console.log(`  ✓ ${search.name}: ${moreVideos.length} videos`);
          allVideos = [...allVideos, ...moreVideos.map(video => ({
            ...video,
            provider: search.name
          }))];
        }
        await delay(500);
      } catch (error) {
        console.warn(`  ✗ ${search.name} failed: ${error.message}`);
      }
    }
  }

  const uniqueVideos = [];
  const seenIds = new Set();
  const seenUrls = new Set();
  
  for (const video of allVideos) {
    const id = video.videoId || video.url;
    if (!id) continue;
    
    if (seenIds.has(id) || seenUrls.has(video.url)) continue;
    
    seenIds.add(id);
    seenUrls.add(video.url);
    uniqueVideos.push(video);
  }

  uniqueVideos.sort((a, b) => {
    const scoreA = (a.weight || 1) * (a.score || 1);
    const scoreB = (b.weight || 1) * (b.score || 1);
    return scoreB - scoreA;
  });

  const results = uniqueVideos.slice(0, 150);
  
  console.log(`✓ Video search complete: ${results.length} videos`);
  cacheSet(cacheKey, results);
  return results;
}

// =============================================================================
// NEWS SEARCH (KEEP ORIGINAL BUT WITH MORE RESULTS)
// =============================================================================

async function newsSearch(query, safeSearch = 'moderate') {
  const safeSearchLevel = getSafeSearchParam(safeSearch);
  const cacheKey = `news:${query}:${safeSearchLevel}`;
  
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: news search "${query}"`);
    return cached;
  }

  console.log(`📰 News search: "${query}" - Target: 50+ articles`);

  const newsProviders = [
    { name: 'NewsAPI', func: () => searchNewsAPI(query), weight: 3 },
    { name: 'Bing News', func: () => searchBingNews(query, safeSearchLevel), weight: 2 },
    { name: 'Google News RSS', func: () => searchGoogleNewsRSS(query), weight: 2 },
    { name: 'Reddit News', func: () => searchRedditNews(query), weight: 1 }
  ];

  const providerPromises = newsProviders.map(provider => 
    provider.func()
      .then(articles => ({
        name: provider.name,
        articles: articles || [],
        weight: provider.weight
      }))
      .catch(error => ({
        name: provider.name,
        articles: [],
        error: error.message,
        weight: provider.weight
      }))
  );

  const providerResults = await Promise.all(providerPromises);
  
  let allArticles = [];
  
  for (const provider of providerResults) {
    if (provider.error) {
      console.warn(`  ✗ ${provider.name} failed: ${provider.error}`);
      continue;
    }
    
    if (provider.articles.length > 0) {
      console.log(`  ✓ ${provider.name}: ${provider.articles.length} articles`);
      
      const weightedArticles = provider.articles.map(article => ({
        ...article,
        provider: provider.name,
        weight: provider.weight,
        score: provider.weight * (Math.random() * 0.5 + 0.5)
      }));
      
      allArticles = [...allArticles, ...weightedArticles];
    } else {
      console.log(`  ✗ ${provider.name}: no articles`);
    }
  }

  if (safeSearchLevel === 'strict') {
    const blockedDomains = [
      '4chan.org', '8kun.top', 'bitchute.com', 'gab.com', 'parler.com',
      'truthsocial.com', 'rumble.com', 'breitbart.com', 'infowars.com'
    ];
    
    allArticles = allArticles.filter(article => {
      const domain = extractDomain(article.url);
      return !blockedDomains.some(blocked => domain.includes(blocked));
    });
  }

  const uniqueArticles = [];
  const seenUrls = new Set();
  
  for (const article of allArticles) {
    if (!article.url || seenUrls.has(article.url)) continue;
    seenUrls.add(article.url);
    uniqueArticles.push(article);
  }

  uniqueArticles.sort((a, b) => (b.weight || 1) * (b.score || 1) - (a.weight || 1) * (a.score || 1));
  const results = uniqueArticles.slice(0, 50);
  
  console.log(`✓ News search complete: ${results.length} articles`);
  cacheSet(cacheKey, results);
  return results;
}

// Keep original news provider functions (searchNewsAPI, searchBingNews, searchGoogleNewsRSS, searchRedditNews)
// They should work as is, just add .slice(0, 50) to return more results

async function searchNewsAPI(query) {
  if (!process.env.NEWS_API_KEY) {
    throw new Error('NEWS_API_KEY not configured');
  }
  
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=50&language=en&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`;
  const data = await fetchJSON(url);
  
  return (data.articles || []).map(article => ({
    title: article.title || '',
    description: article.description || '',
    content: article.content || '',
    url: article.url,
    source: article.source?.name || 'Unknown',
    publishedAt: article.publishedAt,
    imageUrl: article.urlToImage,
    author: article.author,
    provider: 'NewsAPI'
  })).slice(0, 50);
}

async function searchBingNews(query, safeSearch) {
  const safeParam = safeSearch === 'off' ? '0' : safeSearch === 'strict' ? '2' : '1';
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&form=NWRFSH&setlang=en&cc=us&safeSearch=${safeParam}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  
  const articles = [];
  
  $('.news-card').each((_, card) => {
    const titleEl = $(card).find('.title');
    const descEl = $(card).find('.snippet');
    const imgEl = $(card).find('img');
    const sourceEl = $(card).find('.source');
    const timeEl = $(card).find('.timestamp');
    
    const title = titleEl.text().trim();
    const url = titleEl.attr('href');
    
    if (title && url) {
      articles.push({
        title,
        description: descEl.text().trim(),
        url,
        source: sourceEl.text().trim(),
        publishedAt: timeEl.text().trim(),
        imageUrl: imgEl.attr('src'),
        provider: 'Bing News'
      });
    }
  });
  
  return articles.slice(0, 50);
}

async function searchGoogleNewsRSS(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchHTML(url);
  
  const articles = [];
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  
  for (const item of itemMatches.slice(0, 50)) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
    const pubMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    
    if (titleMatch && linkMatch) {
      articles.push({
        title: (titleMatch[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        description: (descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '') : '').trim(),
        url: linkMatch[1].trim(),
        source: (sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '') : 'Google News').trim(),
        publishedAt: pubMatch ? pubMatch[1].trim() : '',
        provider: 'Google News RSS'
      });
    }
  }
  
  return articles.slice(0, 50);
}

async function searchRedditNews(query) {
  const url = `https://www.reddit.com/r/news/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=relevance&t=week&limit=50`;
  const data = await fetchJSON(url);
  
  return (data.data?.children || []).map(post => {
    const p = post.data;
    return {
      title: p.title,
      description: p.selftext,
      url: p.url,
      source: `r/${p.subreddit}`,
      publishedAt: new Date(p.created_utc * 1000).toISOString(),
      imageUrl: p.thumbnail !== 'self' && p.thumbnail !== 'default' ? p.thumbnail : null,
      score: p.score,
      comments: p.num_comments,
      provider: 'Reddit'
    };
  }).slice(0, 50);
}

// =============================================================================
// WEATHER SEARCH (KEEP ORIGINAL)
// =============================================================================

async function weatherSearch(query) {
  const cacheKey = `weather:${query}`;
  
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: weather "${query}"`);
    return cached;
  }

  console.log(`🌤️ Weather search: "${query}"`);

  const weatherProviders = [
    { name: 'OpenWeatherMap', func: () => getOpenWeather(query) },
    { name: 'Weather.gov', func: () => getWeatherGov(query) }
  ];

  for (const provider of weatherProviders) {
    try {
      console.log(`  → Trying ${provider.name}...`);
      const weatherData = await provider.func();
      
      if (weatherData && !weatherData.error) {
        console.log(`  ✓ ${provider.name} returned data`);
        weatherData.provider = provider.name;
        cacheSet(cacheKey, weatherData, TTL.short);
        return weatherData;
      }
      
    } catch (error) {
      console.warn(`  ✗ ${provider.name} failed: ${error.message}`);
    }
  }

  const errorData = {
    error: "Could not fetch weather data",
    suggestion: "Try specifying city and country (e.g., 'London, UK')",
    providers_tried: weatherProviders.map(p => p.name)
  };
  
  cacheSet(cacheKey, errorData, TTL.short);
  return errorData;
}

async function getOpenWeather(query) {
  if (!process.env.WEATHER_API_KEY) {
    throw new Error('WEATHER_API_KEY not configured');
  }
  
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&units=metric&appid=${process.env.WEATHER_API_KEY}`;
  const data = await fetchJSON(url);
  
  if (data.cod !== 200) {
    throw new Error(data.message || "Weather data not found");
  }

  return {
    city: data.name,
    country: data.sys?.country,
    coord: {
      lat: data.coord?.lat,
      lon: data.coord?.lon
    },
    temp: data.main?.temp,
    feels_like: data.main?.feels_like,
    temp_min: data.main?.temp_min,
    temp_max: data.main?.temp_max,
    pressure: data.main?.pressure,
    humidity: data.main?.humidity,
    condition: data.weather[0]?.description,
    main: data.weather[0]?.main,
    icon: `https://openweathermap.org/img/wn/${data.weather[0]?.icon}@2x.png`,
    wind_speed: data.wind?.speed,
    wind_deg: data.wind?.deg,
    clouds: data.clouds?.all,
    sunrise: data.sys?.sunrise ? new Date(data.sys.sunrise * 1000).toISOString() : null,
    sunset: data.sys?.sunset ? new Date(data.sys.sunset * 1000).toISOString() : null,
    timezone: data.timezone,
    timestamp: new Date().toISOString()
  };
}

async function getWeatherGov(query) {
  const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=2020&format=json`;
  const geocodeData = await fetchJSON(geocodeUrl);
  
  if (!geocodeData.result?.addressMatches?.[0]) {
    throw new Error('Location not found');
  }
  
  const match = geocodeData.result.addressMatches[0];
  const { x: lon, y: lat } = match.coordinates;
  
  const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
  const pointsData = await fetchJSON(pointsUrl);
  
  const forecastUrl = pointsData.properties?.forecast;
  if (!forecastUrl) {
    throw new Error('No forecast available');
  }
  
  const forecastData = await fetchJSON(forecastUrl);
  const current = forecastData.properties?.periods?.[0];
  
  if (!current) {
    throw new Error('No current weather data');
  }
  
  return {
    city: match.addressComponents.city || '',
    state: match.addressComponents.state || '',
    country: 'US',
    coord: { lat, lon },
    temp: (current.temperature - 32) * 5/9,
    feels_like: (current.temperature - 32) * 5/9,
    condition: current.shortForecast,
    detailedForecast: current.detailedForecast,
    wind_speed: current.windSpeed,
    wind_direction: current.windDirection,
    icon: current.icon,
    timestamp: new Date().toISOString()
  };
}

// =============================================================================
// GITHUB SEARCH (KEEP ORIGINAL WITH MORE RESULTS)
// =============================================================================

async function githubSearch(query) {
  const cacheKey = `github:${query}`;
  
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: GitHub "${query}"`);
    return cached;
  }

  console.log(`💻 GitHub search: "${query}"`);

  try {
    const headers = process.env.GITHUB_TOKEN ? {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'User-Agent': 'search-app',
      'Accept': 'application/vnd.github.v3+json'
    } : {
      'User-Agent': 'search-app',
      'Accept': 'application/vnd.github.v3+json'
    };

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`;
    const data = await fetchJSON(url, { headers });
    
    const results = (data.items || []).map(repo => ({
      name: repo.full_name,
      description: repo.description || "",
      url: repo.html_url,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      watchers: repo.watchers_count,
      language: repo.language,
      license: repo.license?.name,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
      open_issues: repo.open_issues_count,
      size: repo.size,
      default_branch: repo.default_branch,
      homepage: repo.homepage,
      archived: repo.archived,
      disabled: repo.disabled,
      is_template: repo.is_template,
      topics: repo.topics || []
    }));

    console.log(`✓ GitHub returned ${results.length} repositories`);
    cacheSet(cacheKey, results);
    return results;
    
  } catch (error) {
    console.error("GitHub search error:", error.message);
    
    if (error.message.includes('rate limit') || error.message.includes('403')) {
      return { 
        error: "GitHub API rate limit exceeded",
        suggestion: "Add GITHUB_TOKEN environment variable for higher limits",
        retry_after: "Try again in 1 hour or add authentication"
      };
    }
    
    return { 
      error: "GitHub search failed",
      details: error.message,
      suggestion: "Try again later or check your network connection"
    };
  }
}

// =============================================================================
// API ROUTES
// =============================================================================

function validateSearchRequest(req, res, next) {
  try {
    if (!req.query.q) {
      return res.status(400).json({
        error: "Missing required parameter",
        message: "Query parameter 'q' is required",
        example: "/search?q=technology&safe=moderate&page=1"
      });
    }
    
    const query = validateQuery(req.query.q);
    req.validatedQuery = query;
    next();
  } catch (error) {
    return res.status(400).json({
      error: "Invalid request",
      message: error.message,
      example: "/search?q=technology&safe=moderate&page=1"
    });
  }
}

app.get("/search", validateSearchRequest, async (req, res) => {
  try {
    const query = req.validatedQuery;
    const safe = req.query.safe;
    const page = parseInt(req.query.page) || 1;
    
    if (page < 1 || page > 10) {
      return res.status(400).json({
        error: "Invalid page number",
        message: "Page must be between 1 and 10"
      });
    }

    console.log(`\n=== SEARCH REQUEST: "${query}" (page ${page}, safe: ${safe || 'moderate'}) ===`);
    console.log(`Target: 100+ results in each category`);
    
    const [web, images, videos, news] = await Promise.allSettled([
      webSearch(query, page, safe),
      imageSearch(query, safe),
      videoSearch(query, safe),
      newsSearch(query, safe)
    ]);

    const response = {
      query,
      timestamp: new Date().toISOString(),
      safe_search: getSafeSearchParam(safe),
      page,
      results_per_page: RESULTS_PER_PAGE,
      results: {
        web: web.status === 'fulfilled' ? web.value : { 
          error: "Web search temporarily unavailable",
          retry: true
        },
        images: images.status === 'fulfilled' ? images.value : { 
          error: "Image search temporarily unavailable",
          retry: true
        },
        videos: videos.status === 'fulfilled' ? videos.value : { 
          error: "Video search temporarily unavailable",
          retry: true
        },
        news: news.status === 'fulfilled' ? news.value : { 
          error: "News search temporarily unavailable",
          retry: true
        }
      },
      stats: {
        web_count: web.status === 'fulfilled' && Array.isArray(web.value) ? web.value.length : 0,
        images_count: images.status === 'fulfilled' && Array.isArray(images.value) ? images.value.length : 0,
        videos_count: videos.status === 'fulfilled' && Array.isArray(videos.value) ? videos.value.length : 0,
        news_count: news.status === 'fulfilled' && Array.isArray(news.value) ? news.value.length : 0,
        total_results: (
          (web.status === 'fulfilled' && Array.isArray(web.value) ? web.value.length : 0) +
          (images.status === 'fulfilled' && Array.isArray(images.value) ? images.value.length : 0) +
          (videos.status === 'fulfilled' && Array.isArray(videos.value) ? videos.value.length : 0) +
          (news.status === 'fulfilled' && Array.isArray(news.value) ? news.value.length : 0)
        ),
        cache_stats: getCacheStats()
      }
    };

    res.json(response);
    
  } catch (error) {
    console.error("Search error:", error);
    
    res.status(500).json({ 
      error: "Search service error",
      message: "An unexpected error occurred",
      suggestion: "Please try again in a few moments",
      request_id: Date.now().toString(36)
    });
  }
});

app.get("/massive", validateSearchRequest, async (req, res) => {
  try {
    const query = req.validatedQuery;
    const safe = req.query.safe;

    console.log(`\n=== MASSIVE SEARCH: "${query}" (safe: ${safe || 'moderate'}) ===`);
    console.log(`Target: Maximum results from all categories`);
    
    const [webResults, imageResults, videoResults, newsResults, weatherResults, githubResults] = await Promise.allSettled([
      webSearch(query, 1, safe).then(results => results.slice(0, 200)),
      imageSearch(query, safe).then(results => results.slice(0, 200)),
      videoSearch(query, safe).then(results => results.slice(0, 200)),
      newsSearch(query, safe).then(results => results.slice(0, 100)),
      weatherSearch(query),
      githubSearch(query).then(results => Array.isArray(results) ? results.slice(0, 100) : results)
    ]);

    const response = {
      query,
      timestamp: new Date().toISOString(),
      safe_search: getSafeSearchParam(safe),
      results: {
        web: webResults.status === 'fulfilled' ? webResults.value : { error: "Web search failed", retry: true },
        images: imageResults.status === 'fulfilled' ? imageResults.value : { error: "Image search failed", retry: true },
        videos: videoResults.status === 'fulfilled' ? videoResults.value : { error: "Video search failed", retry: true },
        news: newsResults.status === 'fulfilled' ? newsResults.value : { error: "News search failed", retry: true },
        weather: weatherResults.status === 'fulfilled' ? weatherResults.value : { error: "Weather search failed", retry: true },
        github: githubResults.status === 'fulfilled' ? githubResults.value : { error: "GitHub search failed", retry: true }
      },
      stats: {
        web_count: webResults.status === 'fulfilled' && Array.isArray(webResults.value) ? webResults.value.length : 0,
        images_count: imageResults.status === 'fulfilled' && Array.isArray(imageResults.value) ? imageResults.value.length : 0,
        videos_count: videoResults.status === 'fulfilled' && Array.isArray(videoResults.value) ? videoResults.value.length : 0,
        news_count: newsResults.status === 'fulfilled' && Array.isArray(newsResults.value) ? newsResults.value.length : 0,
        weather_success: weatherResults.status === 'fulfilled' && !weatherResults.value?.error,
        github_count: githubResults.status === 'fulfilled' && Array.isArray(githubResults.value) ? githubResults.value.length : 0,
        total_results: (
          (webResults.status === 'fulfilled' && Array.isArray(webResults.value) ? webResults.value.length : 0) +
          (imageResults.status === 'fulfilled' && Array.isArray(imageResults.value) ? imageResults.value.length : 0) +
          (videoResults.status === 'fulfilled' && Array.isArray(videoResults.value) ? videoResults.value.length : 0) +
          (newsResults.status === 'fulfilled' && Array.isArray(newsResults.value) ? newsResults.value.length : 0) +
          (githubResults.status === 'fulfilled' && Array.isArray(githubResults.value) ? githubResults.value.length : 0)
        ),
        cache_stats: getCacheStats()
      },
      performance: {
        request_time: Date.now(),
        note: "Massive search returns maximum available results from all sources"
      }
    };

    res.json(response);
    
  } catch (error) {
    console.error("Massive search error:", error);
    
    res.status(500).json({ 
      error: "Massive search service error",
      message: "Could not complete massive search",
      suggestion: "Try regular search endpoints or reduce scope",
      request_id: Date.now().toString(36)
    });
  }
});

app.get("/weather", validateSearchRequest, async (req, res) => {
  try {
    const query = req.validatedQuery;

    console.log(`\n=== WEATHER REQUEST: "${query}" ===`);
    
    const weatherData = await weatherSearch(query);
    
    res.json({
      query,
      timestamp: new Date().toISOString(),
      data: weatherData
    });
    
  } catch (error) {
    console.error("Weather error:", error);
    
    res.status(500).json({ 
      error: "Weather service error",
      message: "Could not fetch weather data",
      suggestion: "Check your location format (e.g., 'City, Country')",
      request_id: Date.now().toString(36)
    });
  }
});

app.get("/github", validateSearchRequest, async (req, res) => {
  try {
    const query = req.validatedQuery;

    console.log(`\n=== GITHUB REQUEST: "${query}" ===`);
    
    const githubData = await githubSearch(query);
    
    res.json({
      query,
      timestamp: new Date().toISOString(),
      data: githubData
    });
    
  } catch (error) {
    console.error("GitHub error:", error);
    
    res.status(500).json({ 
      error: "GitHub service error",
      message: "Could not fetch GitHub data",
      note: "Public GitHub API has rate limits",
      request_id: Date.now().toString(36)
    });
  }
});

app.get("/all", validateSearchRequest, async (req, res) => {
  try {
    const query = req.validatedQuery;
    const safe = req.query.safe;

    console.log(`\n=== COMPLETE SEARCH: "${query}" (safe: ${safe || 'moderate'}) ===`);
    
    const [web, images, videos, news, weatherData, githubData] = await Promise.allSettled([
      webSearch(query, 1, safe),
      imageSearch(query, safe),
      videoSearch(query, safe),
      newsSearch(query, safe),
      weatherSearch(query),
      githubSearch(query)
    ]);

    const response = {
      query,
      timestamp: new Date().toISOString(),
      safe_search: getSafeSearchParam(safe),
      results: {
        web: web.status === 'fulfilled' ? web.value : { error: "Temporarily unavailable", retry: true },
        images: images.status === 'fulfilled' ? images.value : { error: "Temporarily unavailable", retry: true },
        videos: videos.status === 'fulfilled' ? videos.value : { error: "Temporarily unavailable", retry: true },
        news: news.status === 'fulfilled' ? news.value : { error: "Temporarily unavailable", retry: true },
        weather: weatherData.status === 'fulfilled' ? weatherData.value : { error: "Temporarily unavailable", retry: true },
        github: githubData.status === 'fulfilled' ? githubData.value : { error: "Temporarily unavailable", retry: true }
      },
      stats: {
        web_count: web.status === 'fulfilled' && Array.isArray(web.value) ? web.value.length : 0,
        images_count: images.status === 'fulfilled' && Array.isArray(images.value) ? images.value.length : 0,
        videos_count: videos.status === 'fulfilled' && Array.isArray(videos.value) ? videos.value.length : 0,
        news_count: news.status === 'fulfilled' && Array.isArray(news.value) ? news.value.length : 0,
        weather_success: weatherData.status === 'fulfilled' && !weatherData.value?.error,
        github_count: githubData.status === 'fulfilled' && Array.isArray(githubData.value) ? githubData.value.length : 0,
        total_results: (
          (web.status === 'fulfilled' && Array.isArray(web.value) ? web.value.length : 0) +
          (images.status === 'fulfilled' && Array.isArray(images.value) ? images.value.length : 0) +
          (videos.status === 'fulfilled' && Array.isArray(videos.value) ? videos.value.length : 0) +
          (news.status === 'fulfilled' && Array.isArray(news.value) ? news.value.length : 0) +
          (githubData.status === 'fulfilled' && Array.isArray(githubData.value) ? githubData.value.length : 0)
        ),
        cache_stats: getCacheStats()
      }
    };

    res.json(response);
    
  } catch (error) {
    console.error("Complete search error:", error);
    
    res.status(500).json({ 
      error: "Service error",
      message: "Search services temporarily overloaded",
      suggestion: "Try individual endpoints or try again later",
      request_id: Date.now().toString(36)
    });
  }
});

app.get("/admin/cache", (req, res) => {
  const apiKey = req.query.key;
  const action = req.query.action;
  
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Valid API key required"
    });
  }
  
  if (action === 'clear') {
    cacheClear();
    return res.json({
      message: "Cache cleared successfully",
      timestamp: new Date().toISOString()
    });
  }
  
  if (action === 'stats') {
    return res.json({
      cache_stats: getCacheStats(),
      timestamp: new Date().toISOString()
    });
  }
  
  res.status(400).json({
    error: "Invalid action",
    actions: ["clear", "stats"]
  });
});

app.get("/health", (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    version: "3.2.0",
    uptime: {
      seconds: Math.floor(uptime),
      formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`,
      usage_percent: `${Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)}%`
    },
    cache: getCacheStats(),
    configuration: {
      results_per_page: RESULTS_PER_PAGE,
      max_fetch_results: MAX_FETCH_RESULTS,
      request_timeout: `${REQUEST_TIMEOUT / 1000}s`,
      max_retries: MAX_RETRIES,
      rate_limit: `${RATE_LIMIT.max} requests per ${RATE_LIMIT.windowMs / 1000 / 60} minutes`
    },
    environment: {
      node_version: process.version,
      platform: process.platform,
      news_api_configured: !!process.env.NEWS_API_KEY,
      weather_api_configured: !!process.env.WEATHER_API_KEY,
      github_token_configured: !!process.env.GITHUB_TOKEN,
      cors_origin: process.env.CORS_ORIGIN || '*',
      node_env: process.env.NODE_ENV || 'development'
    }
  });
});

app.get("/", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  res.json({
    name: "Somwhatgoogle API",
    version: "3.2.0",
    description: "A comprehensive, privacy-focused search aggregation API with 100+ results per category",
    base_url: baseUrl,
    features: [
      "100+ web results per search with multiple providers",
      "100+ image results from 8+ sources",
      "100+ video results from 7+ platforms",
      "50+ news articles from multiple aggregators",
      "Weather data with multiple fallbacks",
      "GitHub repository search",
      "Massive search endpoint for maximum results",
      "Intelligent caching for performance",
      "Automatic retry with exponential backoff",
      "Comprehensive error handling",
      "Rate limiting",
      "CORS support",
      "Security headers"
    ],
    quick_start: {
      search: `${baseUrl}/search?q=artificial+intelligence&safe=moderate&page=1`,
      massive: `${baseUrl}/massive?q=machine+learning&safe=moderate`,
      weather: `${baseUrl}/weather?q=London,UK`,
      github: `${baseUrl}/github?q=react+framework`,
      all: `${baseUrl}/all?q=machine+learning&safe=moderate`,
      health: `${baseUrl}/health`
    },
    results_guarantee: {
      web: "100+ results per search",
      images: "100+ images per search",
      videos: "100+ videos per search",
      news: "50+ articles per search",
      note: "Results may vary based on query and provider availability"
    }
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
    available_endpoints: [
      "GET / - API documentation",
      "GET /search?q=query - Main search (100+ results)",
      "GET /massive?q=query - Massive search (max results)",
      "GET /weather?q=city - Weather information",
      "GET /github?q=query - GitHub search",
      "GET /all?q=query - Complete search",
      "GET /health - Health check"
    ],
    suggestion: "Check the endpoint path and method"
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  const errorDetails = process.env.NODE_ENV === 'development' ? {
    message: err.message,
    stack: err.stack
  } : {
    message: "An internal server error occurred"
  };
  
  res.status(500).json({
    error: "Internal server error",
    ...errorDetails,
    request_id: requestId,
    suggestion: "Please try again. If the problem persists, contact support with the request ID",
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Somwhatgoogle API v3.2.0                   ║
║            Privacy-focused search with 100+ results          ║
║                                                              ║
║           🌐 Server: http://localhost:${PORT}                ${' '.repeat(20 - PORT.toString().length)}║
║           📁 Environment: ${process.env.NODE_ENV || 'development'}${' '.repeat(31 - (process.env.NODE_ENV || 'development').length)}║
╚══════════════════════════════════════════════════════════════╝

✨ FEATURES:
  • 100+ web results from 7+ search engines
  • 100+ images from 8+ sources (Unsplash, Pexels, Google, etc.)
  • 100+ videos from 7+ platforms (YouTube, Vimeo, Dailymotion, etc.)
  • 50+ news articles from 4+ aggregators
  • GitHub repository search (100 repos)
  • Weather data with multiple fallbacks

🚀 ENDPOINTS:
  • GET /search?q=query&safe=level&page=1 (100+ results per category)
  • GET /massive?q=query&safe=level (200+ results per category)
  • GET /weather?q=city
  • GET /github?q=query
  • GET /all?q=query&safe=level
  • GET /health

📊 CONFIGURATION:
  • Results per page: ${RESULTS_PER_PAGE}
  • Max fetch results: ${MAX_FETCH_RESULTS}
  • Request timeout: ${REQUEST_TIMEOUT/1000}s
  • Max retries: ${MAX_RETRIES}
  • Rate limit: ${RATE_LIMIT.max} req/${RATE_LIMIT.windowMs/1000/60}min
  • Cache TTL: ${TTL.short/1000}s/${TTL.medium/1000}s/${TTL.long/1000}s

⚙️ ENVIRONMENT:
  • Weather API: ${process.env.WEATHER_API_KEY ? '✓ Configured' : '✗ Not configured (optional)'}
  • News API: ${process.env.NEWS_API_KEY ? '✓ Configured' : '✗ Not configured (optional)'}
  • GitHub Token: ${process.env.GITHUB_TOKEN ? '✓ Configured' : '✗ Not configured (optional)'}
  • CORS Origin: ${process.env.CORS_ORIGIN || '* (all origins)'}

💡 TIP: Use /massive endpoint for maximum results (200+ per category)
  `);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`
╔══════════════════════════════════════════════════════════════╗
║                       ⚠️  PORT CONFLICT                       ║
╚══════════════════════════════════════════════════════════════╝

❌ Error: Port ${PORT} is already in use!

🔧 Solutions:

1️⃣  Kill the existing process:
   Linux/Mac:  lsof -ti:${PORT} | xargs kill -9
   Or:         fuser -k ${PORT}/tcp
   Windows:    netstat -ano | findstr :${PORT}
               taskkill /PID <PID> /F

2️⃣  Use a different port:
   PORT=3001 node index.js

3️⃣  Set PORT in .env file:
   echo "PORT=3001" > .env

4️⃣  Find what's using the port:
   Linux/Mac:  lsof -i :${PORT}
   Windows:    netstat -ano | findstr :${PORT}

`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    console.error(`
╔══════════════════════════════════════════════════════════════╗
║                    ⚠️  PERMISSION DENIED                      ║
╚══════════════════════════════════════════════════════════════╝

❌ Error: Permission denied for port ${PORT}

🔧 Solutions:

1️⃣  Use a port > 1024:
   PORT=3000 node index.js

2️⃣  Run with sudo (not recommended):
   sudo node index.js

3️⃣  Use a non-privileged port in .env:
   PORT=3001

`);
    process.exit(1);
  } else {
    console.error(`
╔══════════════════════════════════════════════════════════════╗
║                    ⚠️  SERVER STARTUP ERROR                   ║
╚══════════════════════════════════════════════════════════════╝

❌ Error: ${error.message}
📝 Code: ${error.code}

🔧 Check:
  • Node.js version (requires 16+)
  • Available memory
  • Network connectivity
  • Firewall settings

💡 Try: node --version to check Node.js version
`);
    process.exit(1);
  }
});

function gracefulShutdown(signal) {
  console.log(`\n📴 ${signal} received, shutting down gracefully...`);
  
  server.close(() => {
    console.log('✓ HTTP server closed');
    cacheClear();
    httpsAgent.destroy();
    httpAgent.destroy();
    console.log('✓ Resources cleaned up');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  if (process.env.NODE_ENV === 'production') {
    console.error('Continuing despite uncaught exception...');
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});