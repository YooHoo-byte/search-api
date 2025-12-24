FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src ./src

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000

CMD ["node", "src/index.js"]
