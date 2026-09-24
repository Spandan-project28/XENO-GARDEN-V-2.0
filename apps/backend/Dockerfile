# Xeno Garden backend — build from the repository root:
#   docker build -f apps/backend/Dockerfile -t xeno-backend .
# Serves HTTP on $PORT (4000) and, with MQTT_EMBEDDED=true, MQTT on $MQTT_EMBEDDED_PORT (1883).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Workspace manifests first (better layer caching). All workspaces must be present for `npm ci`.
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/simulator/package.json apps/simulator/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace @xeno/shared --workspace @xeno/backend --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build -w @xeno/shared && npm run build -w @xeno/backend \
 && npm prune --omit=dev --workspace @xeno/shared --workspace @xeno/backend --include-workspace-root

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 MQTT_EMBEDDED_PORT=1883
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
USER node
EXPOSE 4000 1883
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/dist/server.js"]
