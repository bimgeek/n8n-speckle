FROM n8nio/n8n:2.3.4

USER root

# Install Speckle ObjectLoader2 and its dependencies globally
RUN npm install -g @speckle/objectloader2@2.26.2 subscriptions-transport-ws@0.11.0 ws@8.18.3

# Ensure binary-data directory exists with correct ownership
RUN mkdir -p /home/node/.n8n/binary-data && chown -R node:node /home/node/.n8n/binary-data

USER node
