# reMarkable-bot

NB: This project is not affiliated with reMarkable, and is purely personal.

## Init

First, copy the file `.env.template` to `.env`, and add the bot token `@BotFather` gave you.

This project use yarn. Execute these commands:
```bash
yarn
yarn start
```


## Deploy
You can use Docker to deploy your instance.

To build the docker image:
```bash
docker build -t "remarkable-bot" .
```

To save the Docker image:
```bash
docker save -o ./remarkable-bot.tar remarkable-bot
```

To load the Docker image:
```bash
docker load -i ./remarkable-bot.tar
```
