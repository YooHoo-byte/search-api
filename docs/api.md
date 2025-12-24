# 🔍 API Overview

The Search API provides a unified JSON interface for querying multiple privacy-focused data sources.

---

## Base URL

```text
Local: http://localhost:3000
Demo:  https://demo-worker.yoohoo.workers.dev

Response Format

All endpoints return JSON.
Success

{
  "success": true,
  "data": {},
  "meta": {
    "cache": "hit",
    "processing_time": 123
  }
}

Error

{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "Missing query parameter"
  }
}

Content Types

    application/json

    UTF-8 encoded


---

## 📄 `docs/endpoints.md`

```md
# 📡 API Endpoints

---

## `/search`

```http
GET /search?q=linux

Returns aggregated web results.
Parameters
Name	Required	Description
q	yes	Search query
page	no	Page number
safe	no	off / moderate / strict
/images

GET /images?q=linux

Returns image results.
/videos

GET /videos?q=linux

Returns video results.
/news

GET /news?q=linux

Returns news articles.
/weather

GET /weather?q=colombo

Returns weather data.
/health

GET /health

Health check endpoint.
/docs

Returns inline API usage instructions.


---

## 📄 `docs/configuration.md`

```md
# ⚙️ Configuration

Search API uses environment variables for configuration.

---

## Required Variables

```env
PORT=3000
NODE_ENV=production

Optional Variables

CACHE_TTL=600000
RATE_LIMIT=100
REQUEST_TIMEOUT=20000

Safe Search

DEFAULT_SAFE_SEARCH=moderate

Logging

LOG_LEVEL=info

    📌 See .env.example in the repo root for full list.


---

## 📄 `docs/providers.md`

```md
# 🔎 Search Providers

All providers are selected based on privacy standards.

---

## Web Search

- DuckDuckGo
- StartPage
- Marginalia

---

## Images

- Unsplash
- Pixabay
- Aggregated privacy-safe sources

---

## Videos

- Invidious instances
- PeerTube instances

---

## News

- RSS aggregators
- Independent news feeds

---

## Provider Failover

If one provider fails:
- Request continues
- Results are merged
- No hard dependency

