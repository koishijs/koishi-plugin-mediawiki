/**
 * @name koishi-plugin-mediawiki
 * @desc MediaWiki plugin for Koishijs
 *
 * @author Koishijs(机智的小鱼君) <dragon-fish@qq.com>
 * @author DDElephant <andy-ding@outlook.com>
 * @license Apache-2.0
 */

import {} from '@koishijs/plugin-puppeteer'
import {} from '@koishijs/plugin-puppeteer/lib/screenshot'
import {} from '@koishijs/plugin-rate-limit'
import axios from 'axios'
import cheerio, { SelectorType } from 'cheerio'
import {
  Channel,
  Context,
  Logger,
  Quester,
  Schema,
  segment,
  Session,
  User,
} from 'koishi'
import { InterwikiInfo, Wiki } from 'mw.js'
import { RequestManager } from 'mw.js/dist/utils'
import ProxyAgent from 'proxy-agent'
import { getUrl, isValidApi, resolveBrackets } from './utils'

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

export enum Flags {
  /** wikilink 到不存在的页面时是否自动进行搜索*/
  searchNonExist = 1,
  /** 获取详情时，同时获取信息框 */
  infoboxDetails = 2,
}

const MOCK_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36 Edg/92.0.902.78',
}

type ConfigResolved = {
  request: Quester.Config
  siteRequest: { url: string; request: Quester.Config }[]
  defaultFlag: {
    searchNonExist: boolean
    infoboxDetails: boolean
  }
  defaultApi: {
    group?: string
    private?: string
  }
}
export type Config = Partial<ConfigResolved>

export const Config = Schema.object({
  request: new Schema({
    ...Quester.Config,
    meta: { ...Quester.Config.meta },
  }).description('api 请求设置；不填则使用 koishi 全局设置1111'),
  siteRequest: Schema.array(
    Schema.object({
      url: Schema.string().required().role('url'),
      request: new Schema({
        ...Quester.Config,
        meta: { ...Quester.Config.meta },
      }).required(),
    }),
  )
    .description(
      '用于指定站点 api 的请求设置，将覆盖 Config.request；不必写全 api；靠下的规则优先度更高333',
    )
    .default([
      {
        url: 'huijiwiki.com',
        request: { headers: MOCK_HEADERS },
      },
    ]),
  defaultFlag: Schema.object({
    searchNonExist: Schema.boolean()
      .default(false)
      .description('尝试获取不存在的页面的链接时是否自动进行搜索'),
    infoboxDetails: Schema.boolean()
      .default(false)
      .description('获取详情时，同时获取信息框'),
  })
    .default({
      searchNonExist: false,
      infoboxDetails: false,
    })
    .description('wiki 查询的默认设置'),
  defaultApi: Schema.object({
    group: Schema.string().role('url'),
    private: Schema.string().role('url'),
  })
    .default({})
    .description('默认链接的站点'),
})

export const name = 'mediawiki'
export const using = ['database']
export const apply = (ctx: Context, config: ConfigResolved): void => {
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

  if (config.defaultApi?.private && !isValidApi(config.defaultApi.private)) {
    logger.warn(
      `私聊默认链接的 MediaWiki 站点设置的不是合法 api.php 网址：${config.defaultApi.private}`,
    )
    config.defaultApi.private = undefined
  }
  if (config.defaultApi?.group && !isValidApi(config.defaultApi.group)) {
    logger.warn(
      `defaultApiGroup 不是合法 api.php 网址：${config.defaultApi.group}`,
    )
    config.defaultApi.group = undefined
  }

  const defaultFlags =
    (config.defaultFlag.infoboxDetails ? Flags.infoboxDetails : 0) |
    (config.defaultFlag.searchNonExist ? Flags.searchNonExist : 0)

  const getWiki = (api: string) => {
    let proxyUrl = config.request.proxyAgent || ctx.http.config.proxyAgent
    let requestHeaders = {
      ...(ctx.http.config.headers || {}),
      ...(config.request.headers || {}),
    }
    for (const rule of config.siteRequest) {
      if (api.includes(rule.url)) {
        proxyUrl = rule.request.proxyAgent || proxyUrl
        requestHeaders = {
          ...requestHeaders,
          ...(rule.request.headers || {}),
        }
      }
    }
    return new Wiki({
      api,
      request: new RequestManager({
        agent: proxyUrl ? ProxyAgent(proxyUrl) : undefined,
        headers: requestHeaders,
      }),
    })
  }

  function getMwApi(
    session: Session<'mwApi', 'mwApi'>,
    useDefault = true,
  ): string | undefined {
    let mwApi
    if (session.subtype == 'private') {
      mwApi = session.user?.mwApi
      if (!mwApi && useDefault) mwApi = config.defaultApi.private
    } else if (session.subtype == 'group') {
      mwApi = session.channel?.mwApi
      if (!mwApi && useDefault) mwApi = config.defaultApi.group
    }
    return mwApi
  }

  function getMwFlagFromChat(
    chat: Channel.Observed<'mwFlag'> | User.Observed<'mwFlag'> | undefined,
  ): number {
    const mwFlag = chat?.mwFlag

    return typeof mwFlag === 'number' ? mwFlag : defaultFlags
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
    const site = getWiki(mwApi)
    if (!site) return session.execute('wiki.link')

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_keyword, results, _summaries, _links] = await site.search({
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
    .command('wiki [title:text]', 'MediaWiki 相关功能')
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
      if (!title) return getUrl(mwApi)
      const site = getWiki(mwApi)

      let anchor = ''
      if (title.split('#').length > 1)
        anchor = '#' + encodeURI(title.split('#')[1] || '')

      const msg = []
      let fullbackSearch = false
      try {
        const { redirect, page, interwiki } = await getPageSafe(site, title)

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
              const intro = await getPageIntro(site, page?.pageid || -1)
              if (intro) msg.push(intro)

              // get infobox shot
              if (mwFlag & Flags.infoboxDetails && ctx.puppeteer) {
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
          : defaultFlags
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
    .command('wiki.search <search:text>', '通过名称搜索页面')
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
    .command('wiki.parse <text:text>', '解析 wiki 标记文本')
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
      const site = getWiki(mwApi)
      const { parse } = await site.parse({
        title: options?.title,
        text,
        pst: true,
        disableeditsection: true,
        preview: true,
      })

      if (!parse) return `出现了亿点问题。`

      const page = await ctx.puppeteer.page()

      try {
        if (options?.pure) {
          await page.setContent(parse?.text)
          const img = await page.screenshot({ fullPage: true })
          await page.close()
          return segment.image(img)
        }

        await page.goto(getUrl(mwApi, { title: 'special:blankpage' }))
        await page.evaluate((parse) => {
          $('h1').text(parse?.title)
          $('#mw-content-text').html(parse?.text)
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
    .command('wiki.shot [title]', 'screenshot')
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

type InfoboxSelector = {
  host: string
  selector: SelectorType
}
const infoboxSelectors: InfoboxSelector[] = [
  { host: 'minecraft.fandom.com', selector: '.notaninfobox' },
  { host: 'minecraft.fandom.com', selector: '.portable-infobox' },
  { host: 'minecraft.fandom.com', selector: '.infobox' },
  { host: 'minecraft.fandom.com', selector: '.tpl-infobox' },
  { host: 'minecraft.fandom.com', selector: '.infoboxtable' },
  { host: 'minecraft.fandom.com', selector: '.infotemplatebox' },
  { host: 'minecraft.fandom.com', selector: '.skin-infobox' },
  { host: 'minecraft.fandom.com', selector: '.arcaeabox' },
  { host: 'fandom.com', selector: 'aside.portable-infobox' },
  { host: 'huijiwiki.com', selector: 'table.infobox' },
]

async function getInfobox(ctx: Context, url: string): Promise<string> {
  if (!ctx.puppeteer) throw new Error('Missing puppeteer')

  const host = new URL(url).host
  const selectors = infoboxSelectors.filter((s) => host.endsWith(s.host))
  if (!selectors) throw new Error('Missing infobox selector')

  const res = await axios.get(url)
  const $ = cheerio.load(res.data)
  const css: string = $.html('[rel=stylesheet]')
  let selector: SelectorType | undefined
  for (const s of selectors) {
    if ($(s.selector).length) {
      selector = s.selector
      break
    }
  }
  if (!selector) throw new Error('Missing infobox selector')

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
    const infobox = await page.$(selector)
    await page.waitForNetworkIdle()
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
  site: Wiki,
  title: string,
): Promise<{
  redirect: { from: string; to: string; tofragment?: string } | undefined
  page: pageInfo | undefined
  interwiki?: InterwikiInfo
}> {
  const siteInfo = await site.getSiteInfo(
    'specialpagealiases',
    'namespacealiases',
    'namespaces',
  )
  const res = await site.rawQueryProp({
    prop: 'info',
    titles: title,
    iwurl: true,
    redirects: true,
    converttitles: true,
    inprop: ['url', 'displaytitle'],
  })

  let redirect = res.redirects?.[0]
  let page: Partial<typeof res.pages[number]> & { special?: boolean } =
    res.pages?.[0]
  const interwiki = res.interwiki?.[0],
    specialpagealiases = siteInfo.query.specialpagealiases,
    namespaces = siteInfo.query.namespaces
  if (!interwiki) {
    /**
     * @desc 某些特殊页面会暴露服务器 IP 地址，必须特殊处理这些页面
     *       已知的危险页面包括 Mypage Mytalk
     */
    // 这里用标准名称
    const dangerPageNames = ['Mypage', 'Mytalk']
    // 获取全部别名
    const dangerPages = specialpagealiases
      .filter(({ realname }) => dangerPageNames.includes(realname))
      .map(({ aliases }) => aliases)
      .flat()
    // 获取本地特殊名字空间的标准名称
    const specialNsName = namespaces['-1'].name
    const [redirectNs, redirectTitle] = redirect?.from?.split(':', 2) || []
    if (
      // 发生重定向
      redirect &&
      redirectNs === specialNsName &&
      // 被标记为危险页面
      dangerPages.includes(redirectTitle.split('/')[0])
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
  site: Wiki,
  pageid: number,
  limit = 150,
): Promise<string> {
  try {
    const { parse } = await site.parse({
      pageid,
      prop: ['text', 'wikitext'],
      wrapoutputclass: 'mw-parser-output',
      disablelimitreport: true,
      disableeditsection: true,
      disabletoc: true,
    })
    const $ = cheerio.load(parse?.text || '')
    const $contents = $('.mw-parser-output > p')
    const extract = $contents.text().trim() || ''
    // const extract = parse?.wikitext || ''
    return extract.length > limit ? extract.slice(0, limit) + '...' : extract
  } catch (e) {
    new Logger('wiki').warn(e)
    return ''
  }
}
