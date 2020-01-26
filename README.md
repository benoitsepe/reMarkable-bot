To build the docker image:
`docker build -t "remarkable-bot" .`

To save the Docker image:
`docker save -o ./remarkable-bot.tar remarkable-bot`

To load the Docker image:
`docker load -i ./remarkable-bot.tar`