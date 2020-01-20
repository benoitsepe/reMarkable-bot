import Telegraf, { ContextMessageUpdate } from 'telegraf';
import { Remarkable } from 'remarkable-typescript';
import got from 'got';

// Do this as early as possible
require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  throw Error('BOT_TOKEN missing in process.env');
}

type sessionType = {
  [sessionId: string]: {
    [key: string]: any,
  },
};

let session: sessionType = {};

const getSessionKey = (ctx: ContextMessageUpdate) => {
  if (ctx.from && ctx.chat) {
    return `${ctx.from.id}:${ctx.chat.id}`;
  } if (ctx.from && ctx.inlineQuery) {
    return `${ctx.from.id}:${ctx.from.id}`;
  }
  throw Error('Bot didn\'t recognized this method of communication');
};

const getSession = (ctx: ContextMessageUpdate, key: string) => session[getSessionKey(ctx)][key];
const setSession = (ctx: ContextMessageUpdate, key: string, value: any) => {
  session = {
    ...session,
    [getSessionKey(ctx)]: session[getSessionKey(ctx)] ? {
      ...session[getSessionKey(ctx)],
      [key]: value,
    } : {
      [key]: value,
    },
  };
};

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('Welcome!'));
bot.help((ctx) => ctx.reply('Send me a sticker'));
bot.on('sticker', (ctx) => ctx.reply('👍'));
bot.on('document', async (ctx) => {
  if (!ctx.message || !ctx.message.document) {
    return null;
  }
  const { document } = ctx.message;
  if (ctx.message.document.mime_type !== 'application/pdf') {
    console.log(ctx.message.document.mime_type);
    return ctx.reply('This is not a PDF file');
  }
  const { file_path: filePath } = await ctx.telegram.getFile(document.file_id);

  // https://api.telegram.org/file/bot<token>/<file_path>

  const readStream = got.stream(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`);

  return new Promise((resolve) => {
    const chunks: any[] = [];

    readStream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    // Send the buffer or you can put it into a var
    readStream.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      const client: Remarkable = getSession(ctx, 'client');
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
    return null;
  }
  await ctx.reply('Working on it...');
  const code = argumentsCommand[1];

  const client = new Remarkable();
  setSession(ctx, 'client', client);

  await client.register({ code });
  return ctx.reply('Done!');
});
bot.command('ls', async (ctx) => {
  try {
    const client: Remarkable = getSession(ctx, 'client');
    const response = await client.getAllItems();
    return ctx.reply(JSON.stringify(response[0]));
  } catch {
    return null;
  }
});
bot.hears('hi', (ctx) => ctx.reply('Hey there'));
bot.launch();
