FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
RUN npm run build -w frontend
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "frontend"]
