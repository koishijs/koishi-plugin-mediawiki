/**
 * @name koishi-plugin-mediawiki
 * @desc MediaWiki plugin for Koishijs
 *
 * @author Koishijs(机智的小鱼君) <dragon-fish@qq.com>
 * @license Apache-2.0
 */
const cheerio = require('cheerio')

const getBot = require('./module/getBot')
const isValidApi = require('./util/isValidApi')
const getUrl = require('./util/getUrl')
const resolveBrackets = require('./util/resolveBrackets')

module.exports.name = 'mediawiki'

module.exports.apply = (koishi, pOptions) => {
  // @command wiki
  koishi
    .command('wiki [title:text]', 'MediaWiki 相关功能', {})
    .example('wiki 页面 - 获取页面链接')
    .channelFields(['mwApi'])
    .option('details', '-d 显示页面的更多咨询', { type: 'boolean' })
    .option('quiet', '-q 静默查询', { type: 'boolean' })
    .action(async ({ session, options }, title = '') => {
      const { mwApi } = session.channel
      if (!mwApi) return options.quiet ? '' : session.execute('wiki.link')
      const bot = getBot(session)
      if (!title) return getUrl(mwApi)
      const { query, error } = await bot.request({
        action: 'query',
        prop: '',
        rvprop: '',
        titles: title,
        iwurl: 1,
        redirects: 1,
        converttitles: 1,
      })

      // koishi.logger('wiki').info(JSON.stringify({ query, error }, null, 2))

      if (!query) return `出现了亿点问题${error ? '：' + error : ''}。`

      const { redirects, interwiki, pages } = query
      const thisPage = pages[Object.keys(pages)[0]]
      const { pageid, title: pagetitle, missing, invalid } = thisPage

      const msg = []

      if (interwiki && interwiki.length) {
        msg.push(`跨语言链接：${interwiki[0].url}`)
      } else {
        msg.push(`您要的 ${thisPage.title}：`)
        if (redirects && redirects.length > 0) {
          const { from, to } = redirects[0]
          msg.push(`  重定向：[${from}] ➡️ [${to}]`)
        }
        if (invalid !== undefined) {
          msg.push(
            `警告：页面名称不合法。(${thisPage.invalidreason || '原因未知'})`
          )
        } else if (missing !== undefined) {
          msg.push(
            `${getUrl(mwApi, {
              title: pagetitle,
              action: 'edit',
            })} (页面不存在)`
          )
        } else {
          msg.push(getUrl(mwApi, { curid: pageid }))
          if (options.details) {
            const { parse } = await bot.request({
              action: 'parse',
              pageid,
              prop: 'text',
              disableeditsection: 1,
              disabletoc: 1,
            })
            const $ = cheerio.load(parse?.text?.['*'] || '')
            const text = $('div > p')
              .text()
              .replace(/\s+/g, ' ')
            msg.push(text.substr(0, 120))
          }
        }
      }
      return msg.join('\n')
    })

  // @command wiki.link
  koishi
    .command('wiki.link [api:string]', '将群聊与 MediaWiki 网站连接', {
      authority: 2,
    })
    .channelFields(['mwApi'])
    .action(async ({ session }, api) => {
      const { channel } = session
      if (!api) {
        return channel.mwApi
          ? `本群已与 ${channel.mwApi} 连接。`
          : '本群未连接到 MediaWiki 网站，请使用“wiki.link <api网址>”进行连接。'
      } else if (isValidApi(api)) {
        channel.mwApi = api
        await session.channel._update()
        return session.execute('wiki.link')
      } else {
        return '输入的不是合法 api.php 网址。'
      }
    })

  // @command wiki.search
  koishi
    .command('wiki.search <page:string>', '通过名称搜索页面')
    .channelFields(['mwApi'])
    .action(({ session }, page) => {
      const bot = getBot(session)
      if (!bot) return session.execute('wiki.link')
      return '施工中…'
    })

  // Shortcut
  koishi.middleware(async (session, next) => {
    await next()
    const content = resolveBrackets(session.content)
    const link = /\[\[(.+?)(?:\|.*)?\]\]/.exec(content)
    const template = /{{(.+?)(?:\|.*)?}}/.exec(content)
    if (link && link[1]) {
      session.execute('wiki --quiet ' + link[1])
    }
    if (template && template[1]) {
      session.execute('wiki --quiet --details ' + template[1])
    }
  })
}
