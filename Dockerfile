FROM node:24-alpine
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node package.json config.example.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node third_party ./third_party
USER node
ENTRYPOINT ["node", "src/cli.mjs"]
CMD ["--check", "config.example.json"]
