import Telegraf, { ContextMessageUpdate } from 'telegraf';
import { Remarkable } from 'remarkable-typescript';
import got from 'got';
import storage from 'node-persist';

// Do this as early as possible
require('dotenv').config();

(async () => {
  if (!process.env.BOT_TOKEN) {
    throw Error('BOT_TOKEN missing in process.env');
  }

  await storage.init({
    dir: 'db',
    stringify: JSON.stringify,
    parse: JSON.parse,
    encoding: 'utf8',
    logging: false, // can also be custom logging function
    expiredInterval: 2 * 60 * 1000, // every 2 minutes the process will clean-up the expired cache
    forgiveParseErrors: false,
  });

  type sessionType = {
    token: string,
  };

  const getSessionKey = (ctx: ContextMessageUpdate) => {
    if (ctx.from && ctx.chat) {
      return `${ctx.from.id}:${ctx.chat.id}`;
    } if (ctx.from && ctx.inlineQuery) {
      return `${ctx.from.id}:${ctx.from.id}`;
    }
    throw Error('Bot didn\'t recognized this method of communication');
  };

  const getSession = async (ctx: ContextMessageUpdate, key: keyof sessionType) => (
    await storage.getItem(getSessionKey(ctx)) as sessionType
  )[key];
  const setSession = async (ctx: ContextMessageUpdate, session: Partial<sessionType>) => {
    const prevSession = await storage.getItem(getSessionKey(ctx)) as sessionType;
    const newSession: sessionType = {
      ...prevSession,
      ...session,
    };
    await storage.setItem(getSessionKey(ctx), newSession);
  };

  const getRemarkableObject = async (ctx: ContextMessageUpdate) => {
    const token = await getSession(ctx, 'token');
    return new Remarkable({ token });
  };

  const sendHelp = async (ctx: ContextMessageUpdate) => {
    await ctx.reply('/register [CODE] : register your remarkable. You can generate the code at https://my.remarkable.com/connect/remarkable');
    await ctx.reply('/ls : Display all your files');
    await ctx.reply('Send a PDF file to upload it');
  };

  const bot = new Telegraf(process.env.BOT_TOKEN);

  bot.start(async (ctx) => {
    await ctx.reply('Welcome!');
    await sendHelp(ctx);
  });
  bot.help(sendHelp);
  bot.on('document', async (ctx) => {
    if (!ctx.message || !ctx.message.document) {
      return null;
    }
    const { document } = ctx.message;
    if (ctx.message.document.mime_type !== 'application/pdf') {
      return ctx.reply('This is not a PDF file');
    }
    const { file_path: filePath } = await ctx.telegram.getFile(document.file_id);

    const readStream = got.stream(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`);

    return new Promise((resolve) => {
      const chunks: any[] = [];

      readStream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      // Send the buffer or you can put it into a var
      readStream.on('end', async () => {
        const pdfBuffer = Buffer.concat(chunks);
        const client: Remarkable = await getRemarkableObject(ctx);
        client.uploadPDF(document.file_name ? document.file_name : 'File uploaded', pdfBuffer);
        resolve(await ctx.reply('Document uploaded!'));
      });
    });
  });
  bot.command('register', async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return null;
    }

    const argumentsCommand = ctx.message.text.split(' ');
    if (argumentsCommand.length !== 2) {
      return ctx.reply('You need to specify the code to pair your reMarkable as a parameter');
    }
    await ctx.reply('Working on it...');
    const code = argumentsCommand[1];

    const client = new Remarkable();
    const token = await client.register({ code });

    await setSession(ctx, { token });

    return ctx.reply('Done!');
  });
  bot.command('ls', async (ctx) => {
    const client = await getRemarkableObject(ctx);
    const response = await client.getAllItems();
    return Promise.all(response.map((item) => ctx.reply(JSON.stringify(item))));
  });
  bot.catch((err: Error, ctx: ContextMessageUpdate) => {
    console.log(err);
    return ctx.reply('An error has occured. The admin has been notified!');
  });
  bot.launch();
})();
