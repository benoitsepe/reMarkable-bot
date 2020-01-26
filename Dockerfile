FROM node:alpine
WORKDIR /usr/remarkable-bot
COPY package.json .
COPY yarn.lock .
COPY .env .
RUN yarn
COPY . .
RUN npx tsc
CMD ["node", "./dist/index.js"]