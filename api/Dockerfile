FROM node:22-alpine
WORKDIR /app

# Express reads NODE_ENV directly: without it Express treats the app as
# 'development' and puts full error stacks in HTTP responses. This used to be
# set only by an ACTIVE line in .env.example, so an install without a .env —
# which is now the documented default — ran a public server in development
# mode. Baked into the image so it holds however the stack is started.
ENV NODE_ENV=production

# Copy manifests first so dependency layer is cached separately from source.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js store.js migrate.js schema.sql generate-hash.js validation.js slot-defs.js schedule-formats.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Run as non-root so a compromised process can't write to host-mounted volumes as root.
RUN chown -R node:node /app
USER node

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
