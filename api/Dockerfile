FROM node:22-alpine
WORKDIR /app

# Copy manifests first so dependency layer is cached separately from source.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js generate-hash.js ./

EXPOSE 3000
CMD ["node", "server.js"]
