# Keep all deps (including dev) so tsx is available for TypeScript migrations.
# The knexfile.ts hardcodes src/database/migrations with extension 'ts',
# so we can't use the compiled dist/ for migrations.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/server.js"]
