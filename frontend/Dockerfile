FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
RUN npm run build -w frontend
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "frontend"]
