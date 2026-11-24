FROM node:20-alpine

WORKDIR /app
COPY gateway/package.json ./gateway/package.json
WORKDIR /app/gateway
RUN npm install --omit=dev
COPY gateway/ ./
WORKDIR /app
COPY shared/ ./shared/
WORKDIR /app/gateway

ENV PORT=5021 SERVICE_NAME=gateway VARIANT=micro FRONTEND_DIR=/Frontend_Shared
EXPOSE 5021
CMD ["npm", "start"]
