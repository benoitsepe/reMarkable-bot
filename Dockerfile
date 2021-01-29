FROM node:alpine
WORKDIR /usr/remarkable-bot
COPY . .
RUN yarn
RUN yarn prepare
CMD ["node", "./dist/index.js"]