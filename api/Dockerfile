FROM node:22-alpine
WORKDIR /app

# Copy manifests first so dependency layer is cached separately from source.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js generate-hash.js validation.js slot-defs.js schedule-formats.js ./

# Run as non-root so a compromised process can't write to host-mounted volumes as root.
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
