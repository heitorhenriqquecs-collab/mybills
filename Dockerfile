FROM node:22-alpine
WORKDIR /app
COPY server/cloud-server.cjs ./server/cloud-server.cjs
ENV PORT=8787
ENV MYBILLS_DATA_DIR=/data
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server/cloud-server.cjs"]
