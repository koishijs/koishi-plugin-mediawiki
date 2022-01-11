/**
 * @name koishi-plugin-mediawiki
 * @desc MediaWiki plugin for Koishijs
 *
 * @author Koishijs(机智的小鱼君) <dragon-fish@qq.com>
 * @author DDElephant <andy-ding@outlook.com>
 * @license Apache-2.0
 */

import {} from '@koishijs/plugin-puppeteer'
import {} from '@koishijs/plugin-rate-limit'
import axios from 'axios'
import cheerio, { SelectorType } from 'cheerio'
import { Channel, Context, Logger, segment, Session, User } from 'koishi'
import { getBot, getUrl, isValidApi, resolveBrackets } from './utils'
const logger = new Logger('wiki')

declare module 'koishi' {
  interface Channel {
    mwApi?: string
    mwFlag?: number
  }
  interface User {
    mwApi?: string
    mwFlag?: number
  }
}

export const name = 'mediawiki'

export enum Flags {
  /** wikilink 到不存在的页面时是否自动进行搜索*/
  searchNonExist = 1,
  /** 获取详情时，同时获取信息框 */
  infoboxDetails = 2,
}

type ConfigStrict = {
  /**
   * 默认 flag
   * @default 0
   */
  defaultFlag: number
  wikiAuthority: number
  /**
   * 修改群聊环境下 wiki 站点所需的权限
   * @default 2
   */
  linkGroupAuthority: number
  /**
   * 修改与用户自身私聊环境下 wiki 站点所需的权限
   * @default linkGroupAuthority - 1
   */
  linkSelfAuthority: number
  searchAuthority: number
  parseAuthority: number
  parseMinInterval: number
  shotAuthority: number
  /** 默认群聊 wiki 站点 */
  defaultApiGroup?: string
  /** 默认私聊 wiki 站点 */
  defaultApiPrivate?: string
}
const defaultConfig = {
  defaultFlag: 0,
  wikiAuthority: 1,
  linkGroupAuthority: 2,
  searchAuthority: 1,
  parseAuthority: 3,
  parseMinInterval: 10 * 1000,
  shotAuthority: 2,
}
export type Config = Partial<ConfigStrict>

export const apply = (ctx: Context, configPartial: Config): void => {
  ctx.model.extend('channel', {
    mwApi: 'string',
    mwFlag: {
      type: 'unsigned',
    },
  })
  ctx.model.extend('user', {
    mwApi: 'string',
    mwFlag: {
      type: 'unsigned',
    },
  })

  const config: ConfigStrict = {
    linkSelfAuthority:
      (typeof configPartial.linkGroupAuthority === 'number'
        ? configPartial.linkGroupAuthority
        : defaultConfig.linkGroupAuthority) - 1,
    ...defaultConfig,
    ...configPartial,
  }

  if (config.defaultApiPrivate && !isValidApi(config.defaultApiPrivate)) {
    logger.warn(
      `defaultApiPrivate 不是合法 api.php 网址：${config.defaultApiPrivate}`,
    )
    config.defaultApiPrivate = undefined
  }
  if (config.defaultApiGroup && !isValidApi(config.defaultApiGroup)) {
    logger.warn(
      `defaultApiGroup 不是合法 api.php 网址：${config.defaultApiGroup}`,
    )
    config.defaultApiGroup = undefined
  }

  function getMwApi(
    session: Session<'mwApi', 'mwApi'>,
    useDefault = true,
  ): string | undefined {
    let mwApi
    if (session.subtype == 'private') {
      mwApi = session.user?.mwApi
      if (!mwApi && useDefault) mwApi = config.defaultApiPrivate
    } else if (session.subtype == 'group') {
      mwApi = session.channel?.mwApi
      if (!mwApi && useDefault) mwApi = config.defaultApiGroup
    }
    return mwApi
  }

  function getMwFlagFromChat(
    chat: Channel.Observed<'mwFlag'> | User.Observed<'mwFlag'> | undefined,
  ): number {
    const mwFlag = chat?.mwFlag
    return typeof mwFlag === 'number' ? mwFlag : config.defaultFlag
  }

  function getMwFlag(session: Session<'mwFlag', 'mwFlag'>): number {
    const type2chat: Record<
      string,
      Channel.Observed<'mwFlag'> | User.Observed<'mwFlag'> | undefined
    > = { private: session.user, group: session.channel }
    return getMwFlagFromChat(type2chat[session.subtype || ''])
  }

  async function searchWiki(
    session: Session<'mwApi', 'mwApi'>,
    search: string | undefined,
  ): Promise<string | undefined> {
    const mwApi = getMwApi(session)
    if (!mwApi) return session.execute('wiki.link')
    if (!search) {
      session.sendQueued('要搜索什么呢？(输入空行或句号取消)')
      search = (await session.prompt(30 * 1000)).trim()
      if (!search || search === '.' || search === '。') return ''
    }
    getMwApi(session)
    const bot = getBot(mwApi)
    if (!bot) return session.execute('wiki.link')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    results.forEach((item: string, index: number) => {
      msg.push(`${index + 1}. ${item}`)
    })
    msg.push('请输入想查看的页面编号。')
    await session.sendQueued(msg.join('\n'))

    const answer = parseInt(await session.prompt(30 * 1000))
    if (!isNaN(answer) && results[answer - 1]) {
      session.execute('wiki --details ' + results[answer - 1])
    }
  }

  // @command wiki
  ctx
    .command('wiki [title:text]', 'MediaWiki 相关功能', {
      authority: config.wikiAuthority,
    })
    .example('wiki 页面 - 获取页面链接')
    .option('details', '-d 显示页面的更多资讯', { type: 'boolean' })
    .option('quiet', '-q 静默查询', { type: 'boolean' })
    .option('search', '-s 如果页面不存在就进行搜索', { type: 'boolean' })
    .userFields(['mwApi', 'mwFlag'])
    .channelFields(['mwApi', 'mwFlag'])
    .shortcut('查wiki', {
      prefix: false,
      fuzzy: true,
      options: { search: true, details: true },
    })
    .shortcut('搜wiki', {
      prefix: false,
      fuzzy: true,
      options: { search: true, details: true },
    })
    .action(async ({ session, options }, title = '') => {
      if (!session) throw new Error('Missing session in wiki command.')
      const mwApi = getMwApi(session)
      const mwFlag = getMwFlag(session)
      if (!mwApi) return options?.quiet ? '' : session.execute('wiki.link')
      const mwBot = getBot(mwApi)
      if (!title) return getUrl(mwApi)

      let anchor = ''
      if (title.split('#').length > 1)
        anchor = '#' + encodeURI(title.split('#')[1] || '')

      const msg = []
      let fullbackSearch = false
      try {
        const { redirect, page, interwiki } = await getPageSafe(mwBot, title)

        if (interwiki) msg.push(`跨语言链接：${interwiki.url}${anchor}`)
        else {
          logger.debug({ page })
          msg.push(`您要的“${page?.title}”：`)
          if (redirect) {
            const { from, to, tofragment } = redirect
            msg.push(
              `重定向：[${from}] → [${to}${
                tofragment ? '#' + tofragment : ''
              }]`,
            )
            if (tofragment) anchor = '#' + encodeURI(tofragment)
          }

          if (page?.invalid) {
            msg.push(`页面名称不合法：${page.invalidreason || '原因未知'}`)
          } else if (page?.special) {
            const url = getUrl(mwApi, { title: page.title })
            msg.push(
              `${url}${anchor} (${page.missing ? '不存在的' : ''}特殊页面)`,
            )
          } else if (page?.missing) {
            const goSearch =
              options?.search === undefined
                ? (mwFlag & Flags.searchNonExist) !== 0
                : options.search
            if (!goSearch) msg.push(`${page.editurl} (页面不存在)`)
            else {
              msg.push(`${page.editurl} (页面不存在，以下是搜索结果)`)
              fullbackSearch = true
            }
          } else {
            const pageUrl = getUrl(mwApi, { curid: page?.pageid })

            msg.push(pageUrl + anchor)
            if (options?.details) {
              // Page Details
              const intro = await getPageIntro(mwBot, page?.pageid || -1)
              if (intro) msg.push(intro)

              // get infobox shot
              if (mwFlag & Flags.infoboxDetails) {
                getInfobox(ctx, pageUrl)
                  .then((img) => {
                    let quote = ''
                    if (session.messageId)
                      quote = segment('quote', { id: session.messageId })
                    if (img) session.sendQueued(quote + img)
                  })
                  .catch((e) => {
                    logger.warn(e)
                  })
              }
            }
          }
        }
      } catch (e) {
        logger.warn(e)
        return `出现了亿点问题。`
      }
      let result = msg.join('\n')
      if (session.subtype == 'group' && session.messageId)
        result = segment('quote', { id: session.messageId }) + result
      if (fullbackSearch) {
        await session.sendQueued(result)
        const searchResult = await searchWiki(session, title)
        if (searchResult) session.sendQueued(searchResult)
        return
      }
      return result
    })

  // @command wiki.link
  ctx
    .command('wiki.link [api:string]', '将群聊与 MediaWiki 网站连接')
    .userFields(['mwApi', 'authority'])
    .channelFields(['mwApi'])
    .before(({ session }, api) => {
      if (!api) return
      const auth = session?.user?.authority
      if (auth === undefined) return '无法获取当前用户权限'

      let requiredAuth
      if (session?.subtype == 'private') requiredAuth = config.linkSelfAuthority
      else if (session?.subtype == 'group')
        requiredAuth = config.linkGroupAuthority
      else return

      if (auth < requiredAuth) return '权限不足'
    })
    .action(async ({ session }, api) => {
      if (!session) throw new Error()
      let subtype: 'group' | 'private'
      if (session.subtype == 'group' || session.subtype == 'private')
        subtype = session.subtype
      else throw new Error('Should stopped by the checker.')
      const here = { group: '本群', private: '您的查询' }[subtype]
      const userOrChannel = {
        group: session.channel,
        private: session.user,
      }[subtype]
      if (!userOrChannel) throw new Error('Missing channel or user in session')

      if (!api) {
        const mwApiSet = getMwApi(session, false)
        const mwApi = mwApiSet || getMwApi(session)
        if (mwApiSet) return `${here}已与 ${mwApiSet} 连接。`
        else {
          const msg = mwApi
            ? `${here}已与默认站点 ${mwApi} 连接。`
            : `${here}未连接到 MediaWiki 网站。`
          return msg + '请使用“wiki.link <api网址>”进行连接。'
        }
      } else if (['r', 'remove', 'none', 'null'].includes(api)) {
        const oldApi = userOrChannel.mwApi
        if (!oldApi) return `${here}未连接到 MediaWiki 网站。`
        userOrChannel.mwApi = ''
        await userOrChannel.$update()
        return `${here}已清除与 ${oldApi} 的连接`
      } else if (isValidApi(api)) {
        userOrChannel.mwApi = api
        await userOrChannel.$update()
        return session.execute('wiki.link')
      } else {
        return '输入的不是合法 api.php 网址。'
      }
    })

  ctx
    .command('wiki.flag', '修改聊天中wiki的设置')
    .option('infobox', '-i 切换是否使用信息框', { type: 'boolean' })
    .option('search', '-s 切换是否自动搜索', { type: 'boolean' })
    .userFields(['authority', 'mwFlag'])
    .channelFields(['mwFlag'])
    .before(({ session }) => {
      const auth = session?.user?.authority
      if (auth === undefined) return '无法获取当前用户权限'

      let requiredAuth
      if (session?.subtype == 'private') requiredAuth = config.linkSelfAuthority
      else if (session?.subtype == 'group')
        requiredAuth = config.linkGroupAuthority
      else return ''

      if (auth < requiredAuth) return '权限不足'
    })
    .action(async ({ session, options }) => {
      if (!session) throw new Error()
      let subtype: 'group' | 'private'
      if (session.subtype == 'group' || session.subtype == 'private')
        subtype = session.subtype
      else throw new Error('Should stopped by the checker.')
      const userOrChannel = {
        group: session.channel,
        private: session.user,
      }[subtype]
      if (!userOrChannel) throw new Error('Should stopped by the checker.')
      const currentFlag =
        typeof userOrChannel?.mwFlag === 'number'
          ? userOrChannel.mwFlag
          : config.defaultFlag
      if (!options?.infobox && !options?.search) {
        return (
          `当前设置：` +
          `    自动搜索：${(currentFlag & Flags.searchNonExist) !== 0}` +
          `    信息框：${(currentFlag & Flags.infoboxDetails) !== 0}`
        )
      }
      if (options.infobox) {
        userOrChannel.mwFlag = currentFlag ^ Flags.infoboxDetails
      }
      if (options.search) {
        userOrChannel.mwFlag = currentFlag ^ Flags.searchNonExist
      }
      return session.execute('wiki.flag')
    })

  // @command wiki.search
  ctx
    .command('wiki.search <search:text>', '通过名称搜索页面', {
      authority: config.searchAuthority,
    })
    .userFields(['mwApi'])
    .channelFields(['mwApi'])
    .action(async ({ session }, search) => {
      if (!session?.send) throw new Error()
      return await searchWiki(session, search)
    })

  // Shortcut
  ctx.middleware(async (session, next) => {
    if (!session.content) return next()
    if (session.type != 'message') return next()
    if (!['group', 'private'].includes(session.subtype || '')) return next()
    await next()
    const content = resolveBrackets(session.content)
    const linkReg = /\[\[(.+?)(?:\|.*)?\]\]/g
    // let matched = [];
    const matched = [...content.matchAll(linkReg)].map((m) => m[1])
    const titles = [...new Set(matched)]
    if (!titles.length) return
    logger.info('titles', titles)
    let currChat
    if (session.subtype === 'group')
      currChat = await session.observeChannel(['mwFlag'])
    else if (session.subtype === 'private')
      currChat = await session.observeUser(['mwFlag'])
    const currentFlag = getMwFlagFromChat(currChat)
    const optionS =
      titles.length === 1 && currentFlag & Flags.searchNonExist ? '-s' : ''
    let msg = await Promise.all(
      titles.map(
        async (i) => await session.execute(`wiki -q ${optionS} ${i}`, true),
      ),
    )
    msg = msg.filter((m) => m) /** remove empty elements */
    if (msg) session.send(msg.join('\n----\n'))
  })

  // parse
  ctx
    .command('wiki.parse <text:text>', '解析 wiki 标记文本', {
      minInterval: config.parseMinInterval,
      authority: config.parseAuthority,
    })
    .option('title', '-t <title:string> 用于渲染的页面标题')
    .option('pure', '-p 纯净模式')
    .userFields(['mwApi'])
    .channelFields(['mwApi'])
    .action(async ({ session, options }, text = '') => {
      if (!session) throw new Error('Command without session')
      const mwApi = getMwApi(session)
      if (!mwApi) return session.execute('wiki.link')
      if (!text) return ''
      if (!ctx.puppeteer) return '错误：未找到 puppeteer。'
      text = resolveBrackets(text)
      if (!mwApi) return session.execute('wiki.link')
      const bot = getBot(mwApi)

      const { parse, error } = await bot.request({
        action: 'parse',
        title: options?.title,
        text,
        pst: 1,
        disableeditsection: 1,
        preview: 1,
      })

      if (!parse) return `出现了亿点问题${error ? '：' + error : ''}。`

      const page = await ctx.puppeteer.page()

      try {
        if (options?.pure) {
          await page.setContent(parse?.text?.['*'])
          const img = await page.screenshot({ fullPage: true })
          await page.close()
          return segment.image(img)
        }

        await page.goto(getUrl(mwApi, { title: 'special:blankpage' }))
        await page.evaluate((parse) => {
          $('h1').text(parse?.title)
          $('#mw-content-text').html(parse?.text?.['*'])
          $('#mw-content-text').append(
            '<p style="font-style: italic; color: #b00">[注意] 这是由自动程序生成的预览图片，不代表 wiki 观点。</p>',
          )
        }, parse)
        const img = await page.screenshot({ fullPage: true })
        await page.close()

        return segment.image(img)
      } catch (e) {
        await page.close()
        return `Shot failed: ${e}`
      }
    })

  ctx
    .command('wiki.shot [title]', 'screenshot', {
      authority: config.shotAuthority,
    })
    .userFields(['mwApi'])
    .channelFields(['mwApi'])
    .action(async ({ session }, title) => {
      if (!session) throw new Error('Command without session')
      const mwApi = await getMwApi(session)
      if (!mwApi) return session.execute('wiki.link')
      if (!ctx.puppeteer) return '找不到 puppeteer'
      const page = await ctx.puppeteer.page()
      try {
        await page.goto(getUrl(mwApi, { title }))
        const img = await page.screenshot({ fullPage: true })
        await page.close()
        return segment.image(img)
      } catch (e) {
        await page.close()
        return `Shot failed: ${e}`
      }
    })
}

const infoboxSelector: Record<string, SelectorType> = {
  'fandom.com': 'aside.portable-infobox',
  'huijiwiki.com': 'table.infobox',
}

async function getInfobox(ctx: Context, url: string): Promise<string> {
  if (!ctx.puppeteer) throw new Error('Missing puppeteer')

  const host = new URL(url).host
  let selector: SelectorType | undefined
  for (const site in infoboxSelector) {
    if (host.endsWith(site)) {
      selector = infoboxSelector[site]
      break
    }
  }
  if (!selector) throw new Error('Missing infobox selector')

  const res = await axios.get(url)
  const $ = cheerio.load(res.data)
  const css: string = $.html('[rel=stylesheet]')
  let curr = $($(selector)[0])
  while (true) {
    if (curr[0].tagName.toLowerCase() === 'body') break
    curr.siblings().remove()
    curr = curr.parent()
  }
  const body = $.html(curr)
  const html = `<!DOCTYPE html>
  <html>
  <head><base href="${new URL(url).origin}">${css}</head>
  ${body}
  <html>`

  const page = await ctx.puppeteer.page()
  try {
    await page.goto(url)
    page.setViewport({
      width: 640,
      height: 480,
      deviceScaleFactor: 1.5,
    })
    await page.setContent(html)
    await page.waitForNetworkIdle()
    const infobox = await page.$(selector)
    if (!infobox) throw new Error()
    const image = await infobox.screenshot()
    return segment.image(image)
  } finally {
    await page.close()
  }
}

interface pageInfo {
  pageid?: number
  title?: string
  missing?: boolean
  invalid?: boolean
  invalidreason?: string
  special?: boolean
  editurl?: string
  fullurl?: string
}

export async function getPageSafe(
  bot: any,
  title: string,
): Promise<{
  redirect: { from: string; to: string; tofragment?: string } | undefined
  page: pageInfo | undefined
  interwiki: { url: string } | undefined
}> {
  const { query, error } = await bot.request({
    action: 'query',
    formatversion: 2,
    prop: 'info',
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
  })
  if (!query) throw new Error(error)

  let redirect = query.redirects?.[0],
    page = query.pages?.[0]
  const interwiki = query.interwiki?.[0],
    specialpagealiases = query.specialpagealiases,
    namespaces = query.namespaces
  if (!interwiki) {
    /**
     * @desc 某些特殊页面会暴露服务器 IP 地址，必须特殊处理这些页面
     *       已知的危险页面包括 Mypage Mytalk
     */
    // 这里用标准名称
    const dangerPageNames = ['Mypage', 'Mytalk']
    // 获取全部别名
    const dangerPages = specialpagealiases
      .filter((spAlias: { realname: string }) =>
        dangerPageNames.includes(spAlias.realname),
      )
      .map((spAlias: { aliases: string }) => spAlias.aliases)
      .flat(Infinity)
    // 获取本地特殊名字空间的标准名称
    const specialNsName = namespaces['-1'].name
    if (
      // 发生重定向
      redirect?.from?.split(':')?.shift() === specialNsName &&
      // 被标记为危险页面
      dangerPages.includes(redirect.from.split(':').pop().split('/').shift())
    ) {
      // 覆写页面资料
      page = {
        ns: -1,
        title: redirect.from,
        special: true,
      }
      // 重置重定向信息
      redirect = undefined
    }
  }
  return { redirect, page, interwiki }
}

export async function getPageIntro(
  bot: any,
  pageid: number,
  limit = 150,
): Promise<string> {
  try {
    const { parse } = await bot.request({
      action: 'parse',
      pageid,
      prop: 'text|wikitext',
      wrapoutputclass: 'mw-parser-output',
      disablelimitreport: 1,
      disableeditsection: 1,
      disabletoc: 1,
    })
    const $ = cheerio.load(parse?.text?.['*'] || '')
    const $contents = $('.mw-parser-output > p')
    const extract = $contents.text().trim() || ''
    // const extract = parse?.wikitext?.['*'] || ''
    return extract.length > limit ? extract.slice(0, limit) + '...' : extract
  } catch (e) {
    new Logger('wiki').warn(e)
    return ''
  }
}
