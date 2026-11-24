FROM node:20-alpine

WORKDIR /app
COPY goal-service/package*.json ./goal-service/
WORKDIR /app/goal-service
RUN npm ci --omit=dev
WORKDIR /app
COPY goal-service/ ./goal-service/
COPY shared/ ./shared/
WORKDIR /app/goal-service

ENV PORT=5023 SERVICE_NAME=goal VARIANT=micro GOAL_CPU_MS=10
EXPOSE 5023
CMD ["npm", "start"]
