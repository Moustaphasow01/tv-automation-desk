FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY apps/desk-control-plane/package.json apps/desk-control-plane/package-lock.json ./apps/desk-control-plane/
RUN npm --prefix apps/desk-control-plane ci

COPY apps/desk-control-plane/index.html apps/desk-control-plane/tsconfig.json apps/desk-control-plane/vite.config.ts ./apps/desk-control-plane/
COPY apps/desk-control-plane/public ./apps/desk-control-plane/public
COPY apps/desk-control-plane/src ./apps/desk-control-plane/src

ARG VITE_DATA_MODE=bff
ARG VITE_FRONT_API_BASE_URL=/front-api/v1
ARG VITE_FRONT_API_TIMEOUT_MS=12000
ENV VITE_DATA_MODE=$VITE_DATA_MODE
ENV VITE_FRONT_API_BASE_URL=$VITE_FRONT_API_BASE_URL
ENV VITE_FRONT_API_TIMEOUT_MS=$VITE_FRONT_API_TIMEOUT_MS

RUN npm --prefix apps/desk-control-plane run build

FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/desk-control-plane/dist /usr/share/nginx/html
EXPOSE 80
