/**
 * @name koishi-plugin-mediawiki
 * @desc MediaWiki plugin for Koishijs
 *
 * @author Koishijs(机智的小鱼君) <dragon-fish@qq.com>
 * @license Apache-2.0
 */
const cheerio = require('cheerio')
const { segment } = require('koishi-utils')

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
    .option('details', '-d 显示页面的更多资讯', { type: 'boolean' })
    .option('quiet', '-q 静默查询', { type: 'boolean' })
    .action(async ({ session, options }, title = '') => {
      const { mwApi } = session.channel
      if (!mwApi) return options.quiet ? '' : session.execute('wiki.link')
      const bot = getBot(session)
      if (!title) return getUrl(mwApi)
      const { query, error } = await bot.request({
        action: 'query',
        prop: 'extracts|info',
        iwurl: 1,
        titles: title,
        redirects: 1,
        converttitles: 1,
        exchars: '150',
        exlimit: 'max',
        explaintext: 1,
        inprop: 'url|displaytitle',
      })

      // koishi.logger('wiki').info(JSON.stringify({ query, error }, null, 2))

      if (!query) return `出现了亿点问题${error ? '：' + error : ''}。`

      const { redirects, interwiki, pages } = query
      const msg = []

      if (interwiki && interwiki.length) {
        msg.push(`跨语言链接：${interwiki?.[0]?.url}`)
      } else {
        const thisPage = pages[Object.keys(pages)[0]]
        const {
          pageid,
          title: pagetitle,
          missing,
          invalid,
          extract,
          fullurl,
          editurl,
        } = thisPage
        msg.push(`您要的“${thisPage.title}”：`)
        if (redirects && redirects.length > 0) {
          const { from, to } = redirects[0]
          msg.push(`重定向：[${from}] → [${to}]`)
        }
        if (invalid !== undefined) {
          msg.push(`页面名称不合法：${thisPage.invalidreason || '原因未知'}`)
        } else if (missing !== undefined) {
          msg.push(`${editurl} (页面不存在)`)
        } else {
          msg.push(getUrl(mwApi, { curid: pageid }))
          if (options.details && extract && extract !== '...') {
            msg.push(extract)
          }
        }
      }
      return segment('quote', { id: session.messageId }) + msg.join('\n')
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
    .command('wiki.search <search:text>', '通过名称搜索页面')
    .channelFields(['mwApi'])
    .action(async ({ session }, search) => {
      if (!search) {
        session.send('要搜索什么呢？(输入空行或句号取消)')
        search = (await session.prompt(30 * 1000)).trim()
        if (!search || search === '.' || search === '。') return ''
      }
      const bot = getBot(session)
      if (!bot) return session.execute('wiki.link')
      const [keyword, results, summarys, links] = await bot.request({
        action: 'opensearch',
        format: 'json',
        search,
        redirects: 'resolve',
        limit: 3,
      })

      const msg = []

      if (results.length < 1) {
        return `关键词“${search}”没有匹配结果。`
      }

      results.forEach((item, index) => {
        msg.push(`${index + 1}. ${item}`)
      })
      msg.push('请输入想查看的页面编号。')

      await session.send(msg.join('\n'))
      const answer = parseInt(await session.prompt(30 * 1000))
      if (!isNaN(answer) && results[answer - 1]) {
        session.execute('wiki --details ' + results[answer - 1])
      }
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
