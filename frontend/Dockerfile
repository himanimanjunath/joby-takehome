# Frontend image for the eBOM Explorer take-home.
# Build context is interview/frontend. No Azure SSO — auth has been removed.
#
# Builder compiles the Vite/React/TS source, inlining VITE_API_BASE_URL into
# the bundle. Runtime serves the static dist/ with nginx on port 3000.
FROM node:22-alpine AS builder

WORKDIR /app

# No git in the build context; ensure husky never runs.
ENV HUSKY=0

COPY package.json package-lock.json* ./
RUN npm install

# Vite inlines VITE_* at build time, so the API URL is a build arg. The browser
# is the client, so it points at the host-published backend, not the compose
# network hostname.
ARG VITE_API_BASE_URL=http://localhost:8000/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN npm run build


FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 3000

# nginx listens on IPv4; use 127.0.0.1 (localhost may resolve to ::1 in the container).
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
