/**
 * @name koishi-plugin-mediawiki
 * @desc MediaWiki plugin for Koishijs
 *
 * @author Koishijs(机智的小鱼君) <dragon-fish@qq.com>
 * @license Apache-2.0
 */

import cheerio from 'cheerio';
import { Context, Tables } from 'koishi-core';
import {} from 'koishi-plugin-puppeteer';
import { segment } from 'koishi-utils';
import { getBot, getUrl, isValidApi, resolveBrackets } from './utils';

declare module 'koishi-core' {
  interface Channel {
    mwApi?: string;
  }
}
Tables.extend('channel', {
  fields: {
    mwApi: 'string',
  },
});

export const name = 'mediawiki';

export const apply = (ctx: Context): void => {
  // @command wiki
  ctx
    .command('wiki [title:text]', 'MediaWiki 相关功能', {})
    .example('wiki 页面 - 获取页面链接')
    .channelFields(['mwApi'])
    .option('details', '-d 显示页面的更多资讯', { type: 'boolean' })
    .option('quiet', '-q 静默查询', { type: 'boolean' })
    .action(async ({ session, options }, title = '') => {
      if (!session?.channel) throw new Error();
      const { mwApi } = session.channel;
      if (!mwApi) return options?.quiet ? '' : session.execute('wiki.link');
      const bot = getBot(session);
      if (!title) return getUrl(mwApi);
      let anchor = '#' + encodeURI(title.split('#').pop() || '');
      const { query, error } = await bot.request({
        action: 'query',
        formatversion: 2,
        prop: 'extracts|info',
        meta: 'siteinfo',
        siprop: 'specialpagealiases|namespacealiases|namespaces',
        iwurl: 1,
        titles: title,
        redirects: 1,
        converttitles: 1,
        exchars: '150',
        exlimit: 'max',
        explaintext: 1,
        inprop: 'url|displaytitle',
      });

      // ctx.logger('wiki').info(JSON.stringify({ query, error }, null, 2))

      if (!query) return `出现了亿点问题${error ? '：' + error : ''}。`;

      const {
        redirects: rawRedirects,
        pages: rawPages,
        interwiki,
        specialpagealiases,
        namespaces,
      } = query;
      const msg = [];
      let pages = rawPages;
      let redirects = rawRedirects;
      if (interwiki && interwiki.length) {
        msg.push(`跨语言链接：${interwiki?.[0]?.url}${anchor}`);
      } else {
        /**
         * @desc 某些特殊页面会暴露服务器 IP 地址，必须特殊处理这些页面
         *       已知的危险页面包括 Mypage Mytalk
         */
        // 这里用标准名称
        const dangerPageNames = ['Mypage', 'Mytalk'];
        // 获取全部别名
        const dangerPages = specialpagealiases
          .filter((spAlias: { realname: string }) =>
            dangerPageNames.includes(spAlias.realname),
          )
          .map((spAlias: { aliases: string }) => spAlias.aliases)
          .flat(Infinity);
        // 获取本地特殊名字空间的标准名称
        const specialNsName = namespaces['-1'].name;
        if (
          // 发生重定向
          redirects &&
          // 重定向自特殊页面
          redirects[0].from.split(':').shift() === specialNsName &&
          // 被标记为危险页面
          dangerPages.includes(
            redirects[0].from.split(':').pop().split('/').shift(),
          )
        ) {
          // 覆写页面资料
          pages = [
            {
              ns: -1,
              title: redirects[0].from,
              special: true,
            },
          ];
          // 重置重定向信息
          redirects = undefined;
        }

        ctx.logger('wiki').info({ pages });
        const thisPage = pages[0];
        const {
          pageid,
          title: pagetitle,
          missing,
          invalid,
          // extract,
          // fullurl,
          special,
          editurl,
        } = thisPage;

        msg.push(`您要的“${pagetitle}”：`);
        if (redirects && redirects.length > 0) {
          const { from, to, tofragment } = redirects[0];
          msg.push(
            `重定向：[${from}] → [${to}${tofragment ? '#' + tofragment : ''}]`,
          );
          if (tofragment) anchor = '#' + encodeURI(tofragment);
        }
        if (invalid !== undefined) {
          msg.push(`页面名称不合法：${thisPage.invalidreason || '原因未知'}`);
        } else if (special) {
          msg.push(
            `${getUrl(mwApi, {
              title: pagetitle,
            })}${anchor} (${missing ? '不存在的' : ''}特殊页面)`,
          );
        } else if (missing !== undefined) {
          msg.push(`${editurl} (页面不存在)`);
        } else {
          msg.push(getUrl(mwApi, { curid: pageid }) + anchor);

          // Page Details
          if (options?.details) {
            const { parse } = await bot.request({
              action: 'parse',
              pageid,
              prop: 'text|wikitext',
              wrapoutputclass: 'mw-parser-output',
              disablelimitreport: 1,
              disableeditsection: 1,
              disabletoc: 1,
            });
            const $ = cheerio.load(parse?.text?.['*'] || '');
            const $contents = $('.mw-parser-output > p');
            const extract = $contents.text().trim() || '';
            ctx
              .logger('mediawiki')
              .info({ html: parse.text, $contents, extract });
            // const extract = parse?.wikitext?.['*'] || ''
            if (extract) {
              msg.push(
                extract.length > 150 ? extract.slice(0, 150) + '...' : extract,
              );
            }
          }
        }
      }
      return segment('quote', { id: session.messageId || '' }) + msg.join('\n');
    });

  // @command wiki.link
  ctx
    .command('wiki.link [api:string]', '将群聊与 MediaWiki 网站连接', {
      authority: 2,
    })
    .channelFields(['mwApi'])
    .action(async ({ session }, api) => {
      if (!session?.channel) throw new Error();
      const { channel } = session;
      if (!api) {
        return channel.mwApi
          ? `本群已与 ${channel.mwApi} 连接。`
          : '本群未连接到 MediaWiki 网站，请使用“wiki.link <api网址>”进行连接。';
      } else if (isValidApi(api)) {
        channel.mwApi = api;
        await session.channel._update();
        return session.execute('wiki.link');
      } else {
        return '输入的不是合法 api.php 网址。';
      }
    });

  // @command wiki.search
  ctx
    .command('wiki.search <search:text>', '通过名称搜索页面')
    .channelFields(['mwApi'])
    .action(async ({ session }, search) => {
      if (!session?.send) throw new Error();
      if (!search) {
        session.send('要搜索什么呢？(输入空行或句号取消)');
        search = (await session.prompt(30 * 1000)).trim();
        if (!search || search === '.' || search === '。') return '';
      }
      const bot = getBot(session);
      if (!bot) return session.execute('wiki.link');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [keyword, results, summarys, links] = await bot.request({
        action: 'opensearch',
        format: 'json',
        search,
        redirects: 'resolve',
        limit: 3,
      });

      const msg = [];

      if (results.length < 1) {
        return `关键词“${search}”没有匹配结果。`;
      }

      results.forEach((item: string, index: number) => {
        msg.push(`${index + 1}. ${item}`);
      });
      msg.push('请输入想查看的页面编号。');

      await session.send(msg.join('\n'));
      const answer = parseInt(await session.prompt(30 * 1000));
      if (!isNaN(answer) && results[answer - 1]) {
        session.execute('wiki --details ' + results[answer - 1]);
      }
    });

  // Shortcut
  ctx.middleware(async (session, next) => {
    if (!session.content) throw new Error();
    await next();
    const content = resolveBrackets(session.content);
    const linkReg = /\[\[(.+?)(?:\|.*)?\]\]/g;
    // let matched = [];
    const matched = [...content.matchAll(linkReg)].map((m) => m[1]);
    const titles = [...new Set(matched)];
    if (!titles.length) return;
    ctx.logger('wiki').info('titles', titles);
    const msg = await Promise.all(
      titles.map(async (i) => await session.execute(`wiki -q ${i}`, true)),
    );
    session.send(msg.join('\n----\n'));
  });

  // parse
  ctx
    .command('wiki.parse <text:text>', '解析 wiki 标记文本', {
      minInterval: 10 * 1000,
      authority: 3,
    })
    .option('title', '-t <title:string> 用于渲染的页面标题')
    .option('pure', '-p 纯净模式')
    .channelFields(['mwApi'])
    .action(async ({ session, options }, text = '') => {
      if (!session?.channel) throw new Error();
      if (!text) return '';
      if (!ctx.puppeteer) return '错误：未找到 puppeteer。';
      text = resolveBrackets(text);
      const { mwApi } = session.channel;
      if (!mwApi) return session.execute('wiki.link');
      const bot = getBot(session);

      const { parse, error } = await bot.request({
        action: 'parse',
        title: options?.title,
        text,
        pst: 1,
        disableeditsection: 1,
        preview: 1,
      });

      // koishi.logger('wiki').info(JSON.stringify({ query, error }, null, 2))

      if (!parse) return `出现了亿点问题${error ? '：' + error : ''}。`;

      const page = await ctx.puppeteer.page();

      try {
        if (options?.pure) {
          await page.setContent(parse?.text?.['*']);
          const img = await page.screenshot({ fullPage: true });
          await page.close();
          return segment.image(img);
        }

        await page.goto(getUrl(mwApi, { title: 'special:blankpage' }));
        const $ = cheerio.load(parse?.text?.['*'] || '');
        await page.evaluate((parse) => {
          $('h1').text(parse?.title);
          $('#mw-content-text').html(parse?.text?.['*']);
          $('#mw-content-text').append(
            '<p style="font-style: italic; color: #b00">[注意] 这是由自动程序生成的预览图片，不代表 wiki 观点。</p>',
          );
        }, parse);
        const img = await page.screenshot({ fullPage: true });
        await page.close();

        return segment.image(img);
      } catch (e) {
        await page.close();
        return `Shot failed: ${e}`;
      }
    });

  ctx
    .command('wiki.shot [title]', 'screenshot', { authority: 2 })
    .channelFields(['mwApi'])
    .action(async ({ session }, title) => {
      if (!session?.channel) throw new Error();
      const { mwApi } = session.channel;
      if (!mwApi) return 'Missing api endpoint';
      if (!ctx.puppeteer) return 'Missing puppeteer';
      const page = await ctx.puppeteer.page();
      try {
        await page.goto(getUrl(mwApi, { title }));
        const img = await page.screenshot({ fullPage: true });
        await page.close();
        return segment.image(img);
      } catch (e) {
        await page.close();
        return `Shot failed: ${e}`;
      }
    });
};
