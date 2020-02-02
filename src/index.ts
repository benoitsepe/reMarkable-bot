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
    file: Buffer,
    handle: string,
    token: string,
  };

  const getSessionKey = (ctx: ContextMessageUpdate) => {
    // if (ctx.from && ctx.chat) {
    //   return `${ctx.from.id}:${ctx.chat.id}`;
    // } if (ctx.from && ctx.inlineQuery) {
    //   return `${ctx.from.id}:${ctx.from.id}`;
    // }
    if (ctx.from) {
      return `${ctx.from.id}`;
    }
    throw Error('Bot didn\'t recognized this method of communication');
  };

  const getSession = async (ctx: ContextMessageUpdate, key: keyof sessionType) => (
    await storage.getItem(getSessionKey(ctx)) as sessionType
  )[key];
  const setSession = async (sessionKey: string, session: Partial<sessionType>) => {
    const prevSession = await storage.getItem(sessionKey) as sessionType;
    const newSession: sessionType = {
      ...prevSession,
      ...session,
    };
    await storage.setItem(sessionKey, newSession);
  };
  const setSessionWithCtx = async (ctx: ContextMessageUpdate, session: Partial<sessionType>) => {
    await setSession(getSessionKey(ctx), session);
  };

  const getRemarkableObject = async (ctx: ContextMessageUpdate) => {
    const token = await getSession(ctx, 'token') as string;
    return new Remarkable({ token });
  };

  const doesHandleExist = async (handle: string) => {
    const matches = (await storage.keys()).filter(async (key) => {
      const item = (await storage.getItem(key)) as sessionType;
      return item.handle && item.handle === handle;
    });
    return matches.length > 0 ? matches[0] : null;
  };

  const sendHelp = async (ctx: ContextMessageUpdate) => {
    await ctx.reply('/register [CODE] : register your remarkable. You can generate the code at https://my.remarkable.com/connect/remarkable');
    await ctx.reply('/ls : Display all your files');
    await ctx.reply('/share [FILE ID] [USERNAME] : Send one of your file to the following telegram user');
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

    await setSessionWithCtx(ctx, { token });

    return ctx.reply('Done!');
  });
  bot.command('ls', async (ctx) => {
    const client = await getRemarkableObject(ctx);
    const response = await client.getAllItems();
    return Promise.all(response.map((item) => ctx.reply(JSON.stringify(item))));
  });
  bot.command('share', async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return null;
    }
    const argumentsCommand = ctx.message.text.split(' ');
    if (argumentsCommand.length !== 3) {
      return ctx.reply('You need to specify the ID of the document, followed by the handle of the user');
    }
    await ctx.reply('Working on it...');
    const id = argumentsCommand[1];
    const handleNotFiltered = argumentsCommand[2];
    const handle = handleNotFiltered.slice(0, 1) === '@' ? handleNotFiltered.slice(1) : handleNotFiltered;

    const client = await getRemarkableObject(ctx);

    const file = await client.downloadZip(id) as Buffer;

    const chatId = await doesHandleExist(handle);
    if (chatId) {
      setSession(chatId, { file });
      bot.telegram.sendMessage(chatId, `@${ctx.from?.username} has send you a document. /accept or /refuse`);
      return ctx.reply(`The file has been sent to @${ctx.from?.username}`);
    }
    return ctx.reply('User was not found');
  });
  bot.command('accept', async (ctx) => {
    await ctx.reply('Working on it...');
    const file = await getSession(ctx, 'file') as Buffer;
    if (!file) {
      return ctx.reply('No document in queue');
    }
    const client: Remarkable = await getRemarkableObject(ctx);
    await client.uploadPDF(`Shared file ${(new Date()).toDateString()}`, file);
    return ctx.reply('File uploaded to your reMarkable');
  });
  bot.command('refuse', async (ctx) => {
    await setSessionWithCtx(ctx, { file: undefined });
    return ctx.reply('The file has been rejected');
  });
  bot.catch((err: Error, ctx: ContextMessageUpdate) => {
    console.log(err);
    return ctx.reply('An error has occured. The admin has been notified!');
  });
  bot.launch();
})();
