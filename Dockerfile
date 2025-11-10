FROM n8nio/n8n:latest

USER root

# Install Speckle ObjectLoader2 and its dependencies globally
RUN npm install -g @speckle/objectloader2@2.26.2 subscriptions-transport-ws@0.11.0 ws@8.18.3

USER node
