FROM node:20-alpine

WORKDIR /app
COPY notification-service/package.json ./notification-service/package.json
WORKDIR /app/notification-service
RUN npm install --omit=dev
WORKDIR /app
COPY notification-service/ ./notification-service/
COPY shared/ ./shared/
WORKDIR /app/notification-service

ENV PORT=5024 SERVICE_NAME=notification VARIANT=micro
EXPOSE 5024
CMD ["npm", "start"]
