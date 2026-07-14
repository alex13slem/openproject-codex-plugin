FROM node:20-alpine

RUN npm install --global openproject-codex-plugin@0.4.0

# Glama only needs the server to start for MCP introspection. Replace these
# placeholders with real credentials when running the image against OpenProject.
ENTRYPOINT ["sh", "-c", "OPENPROJECT_URL=${OPENPROJECT_URL:-https://example.invalid} OPENPROJECT_API_TOKEN=${OPENPROJECT_API_TOKEN:-glama-introspection} exec openproject-mcp"]
