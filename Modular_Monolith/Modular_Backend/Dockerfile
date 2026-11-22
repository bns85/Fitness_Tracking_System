FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production
EXPOSE 5011
CMD ["node", "src/server.js"]
