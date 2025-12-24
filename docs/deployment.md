# 🚀 Deployment Guide

---

## Node.js Deployment

```bash
npm install
npm start

Reverse Proxy

Compatible with:

    Nginx

    Caddy

    Apache

Server Requirements

    Node.js 18+

    512MB RAM minimum


---

## 📄 `docs/docker.md`

```md
# 🐳 Docker Usage

---

## Build Image

```bash
docker build -t search-api .

Run Container

docker run -p 3000:3000 search-api

Why Docker?

    Easy deployment

    Reproducible builds

    CI/CD friendly


---

## 📄 `docs/demo.md`

```md
# 🌍 Live Demo

The public demo runs on Cloudflare Workers.

---

## Demo URL

https://demo-worker.yoohoo.workers.dev

---

## Example

```bash
curl "https://demo-worker.yoohoo.workers.dev/search?q=linux"

⚠️ Demo may return very large JSON responses.


---

## 📄 `docs/faq.md`

```md
# ❓ FAQ

---

### Is this a Cloudflare Worker project?

No.  
The core project is **Node.js**.  
Workers are used only for public demos.

---

### Is user data logged?

No.

---

### Can I self-host?

Yes, fully.

---

### Is it free?

Yes, MIT licensed.
