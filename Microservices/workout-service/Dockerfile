FROM node:20-alpine

WORKDIR /app
COPY workout-service/package.json ./workout-service/package.json
WORKDIR /app/workout-service
RUN npm install --omit=dev
WORKDIR /app
COPY workout-service/ ./workout-service/
COPY shared/ ./shared/
WORKDIR /app/workout-service

ENV PORT=5025 SERVICE_NAME=workout VARIANT=micro
EXPOSE 5025
CMD ["npm", "start"]
