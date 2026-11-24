FROM node:20-alpine

WORKDIR /app
COPY telemetry-service/package.json ./telemetry-service/package.json
WORKDIR /app/telemetry-service
RUN npm install --omit=dev
WORKDIR /app
COPY telemetry-service/ ./telemetry-service/
COPY shared/ ./shared/
WORKDIR /app/telemetry-service

ENV PORT=5022 SERVICE_NAME=telemetry VARIANT=micro
EXPOSE 5022
CMD ["npm", "start"]
