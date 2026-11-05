FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV PORT=3101
ENV DATA_DIR=/app/data
EXPOSE 3101
CMD ["node", "server.js"]
