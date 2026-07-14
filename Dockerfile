FROM node:20-alpine

RUN npm install --global openproject-codex-plugin@0.5.0

ENTRYPOINT ["openproject-mcp"]
