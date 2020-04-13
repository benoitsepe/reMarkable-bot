import Telegraf, { ContextMessageUpdate } from 'telegraf';
import rateLimit from 'telegraf-ratelimit';
import { Remarkable } from 'remarkable-typescript';
import got from 'got';
import storage from 'node-persist';

// Do this as early as possible
require('dotenv').config();

(async () => {
  if (!process.env.BOT_TOKEN) {
    throw Error('BOT_TOKEN missing in process.env');
  }
  if (!process.env.WHITELISTED) {
    throw Error('WHITELISTED missing in process.env');
  }

  const whitelistedHandles = process.env.WHITELISTED.split(' ');

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
    file?: string,
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
    const deviceToken = await getSession(ctx, 'token') as string;
    const client = new Remarkable({ deviceToken });
    await client.refreshToken();
    return client;
  };

  const doesHandleExist = async (handle: string) => {
    const items = await Promise.all((await storage.keys()).map(async (key) => {
      const item = (await storage.getItem(key)) as sessionType;
      return { key, handle: item.handle };
    }));
    const matches = items.filter((item) => item.handle === handle);
    return matches.length > 0 ? matches[0].key : null;
  };

  const sendHelp = async (ctx: ContextMessageUpdate) => {
    await ctx.reply('/register [CODE] : register your remarkable. You can generate the code at https://my.remarkable.com/connect/remarkable');
    await ctx.reply('/search [TERM] : Search a document across your files');
    await ctx.reply('/share [FILE ID] [USERNAME] : Send one of your file to the following telegram user');
    await ctx.reply('Send a PDF file to upload it');
  };

  // Set limit to 1 message per 3 seconds
  const limitConfig = {
    window: 3000,
    limit: 1,
    onLimitExceeded: (ctx: ContextMessageUpdate) => ctx.reply('Rate limit exceeded'),
  };

  const bot = new Telegraf(process.env.BOT_TOKEN);
  bot.use(rateLimit(limitConfig));
  bot.use(async (ctx, next) => {
    if (ctx.from?.username && whitelistedHandles.includes(ctx.from?.username)) {
      return next ? next() : null;
    }
    return ctx.reply('You are not whitelisted');
  });

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
        const documentId = await client.uploadPDF(document.file_name ? document.file_name : 'File uploaded', pdfBuffer);
        resolve(await ctx.reply(`Document uploaded! ID: \`${documentId}\``, { parse_mode: 'Markdown' }));
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

    await setSessionWithCtx(ctx, { token, handle: ctx.from?.username });

    return ctx.reply('Done!');
  });
  bot.command('search', async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return null;
    }
    const argumentsCommand = ctx.message.text.split(' ', 2);
    if (argumentsCommand.length !== 2) {
      return ctx.reply('You need to specify the term you are searching');
    }

    const cleanUp = (sentence: string) => sentence.toLowerCase().replace(/[^a-z0-9]+/g, '');

    const termCleanedUp = cleanUp(argumentsCommand[1]);

    const client = await getRemarkableObject(ctx);
    const response = await client.getAllItems();

    const results = response.filter(
      (item) => cleanUp(item.VissibleName).search(termCleanedUp) !== -1,
    ).slice(0, 5);

    return results.length > 0 ? Promise.all(results.map((item) => ctx.reply(
      `ID: <code>${item.ID}</code>\nName: ${item.VissibleName}\nType: ${item.Type}\n${item.BlobURLGet ? `<a href="${item.BlobURLGet}">Download</a>` : null}`,
      { parse_mode: 'HTML' },
    ))) : ctx.reply('Found nothing');
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
      setSession(chatId, { file: file.toString('binary') });
      bot.telegram.sendMessage(chatId, `@${ctx.from?.username} has send you a document. /accept or /refuse`);
      return ctx.reply(`The file has been sent to @${handle}`);
    }
    return ctx.reply('User was not found');
  });
  bot.command('accept', async (ctx) => {
    await ctx.reply('Working on it...');
    const stringFile = await getSession(ctx, 'file') as string;
    if (!stringFile) {
      return ctx.reply('No document in queue');
    }
    const file = Buffer.from(stringFile, 'binary');
    const client: Remarkable = await getRemarkableObject(ctx);
    const id = await client.uploadPDF(`Shared file ${(new Date()).toDateString()}`, file);
    await setSessionWithCtx(ctx, { file: undefined });
    return ctx.reply(`File uploaded to your reMarkable with the ID \`${id}\``, { parse_mode: 'Markdown' });
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
