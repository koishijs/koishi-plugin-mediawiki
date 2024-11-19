/**
 * koishi-plugin-mediawiki
 * @desc MediaWiki plugin for Koishijs
 * @author Koishijs(机智的小鱼君) <dragon-fish@qq.com>
 * @license Apache-2.0
 */
import { Context, h, Logger, Schema } from 'koishi'
import type {} from 'koishi-plugin-puppeteer'
import type {
  MWApiResponseQueryPagesWithSiteinfo,
  MWApiResponsQueryPagesGeneratedBySearch,
} from './types/MediaWiki'
import {
  getUrl,
  getWikiDisplayTitle,
  isValidApi,
  parseTitlesFromText,
  useApi,
} from './utils/wiki'
import { getInjectStyles, INFOBOX_DEFINITION } from './infoboxes'
import { BulkMessageBuilder } from './utils/BulkMessageBuilder'
import { Config } from './types/Config'

declare module 'koishi' {
  interface Channel {
    mwApi?: string
  }
}

const DEFAULT_CONFIGS: Partial<Config> = {
  cmdAuthWiki: 1,
  cmdAuthConnect: 2,
  cmdAuthSearch: 1,
  searchIfNotExist: false,
  showDetailsByDefault: false,
  customInfoboxes: [],
}

export const name = 'mediawiki'
export default class PluginMediawiki {
  static inject = ['database']
  public INFOBOX_DEFINITION = [
    ...(this.config.customInfoboxes || []),
    ...INFOBOX_DEFINITION,
  ]
  static Config = Schema.object({
    cmdAuthWiki: Schema.number()
      .description('指令`wiki`的权限等级：基础指令，请求条目链接与基本信息等')
      .default(1),
    cmdAuthConnect: Schema.number()
      .description('指令`wiki.connect`的权限等级：将wiki绑定到群聊')
      .default(2),
    cmdAuthSearch: Schema.number()
      .description('指令`wiki.search`的权限等级：在绑定的wiki中搜索')
      .default(1),
    searchIfNotExist: Schema.boolean().description(
      '触发`wiki`指令时，结果有且仅有一个不存在的主名字空间的页面时否自动触发搜索',
    ),
    customInfoboxes: Schema.array(
      Schema.object({
        match: Schema.string()
          .description(
            '正则表达式，决定该组信息框定义是否匹配当前请求的URL。(URL示例 `https://example.com/wiki/PageName`，填写示例：`^https?://example\\\\.com/`)',
          )
          .required(),
        selector: Schema.array(String).description('信息框的选择器').required(),
        injectStyles: Schema.string()
          .description('额外插入的CSS')
          .role('textarea'),
        skin: Schema.string().description(
          '渲染时使用的皮肤，建议配置为 `apioutput` 提高加载速度',
        ),
      }),
    ).description('自定义信息框定义组，每一个定义组至少需要match以及selector'),
  })

  constructor(
    public ctx: Context,
    public config: Partial<Config> = DEFAULT_CONFIGS,
  ) {
    this.config = { ...DEFAULT_CONFIGS, ...config }
    ctx.model.extend('channel', {
      mwApi: 'string',
    })
    this.#initCommands()
  }

  get logger(): Logger {
    return this.ctx.logger('mediawiki')
  }

  #initCommands(): void {
    // @command wiki
    this.ctx
      .command('wiki [titles:text]', 'MediaWiki 相关功能', {
        authority: this.config.cmdAuthWiki,
      })
      .example('wiki 页面 - 获取页面链接')
      .channelFields(['mwApi'])
      .option('details', '-d 显示页面的更多资讯', {
        type: 'boolean',
        fallback: this.config.showDetailsByDefault,
      })
      .option('search', '-s 如果页面不存在就进行搜索', {
        type: 'boolean',
        fallback: this.config.searchIfNotExist,
      })
      .option('quiet', '-q 静默执行（忽略未绑定提示）', {
        type: 'boolean',
        // @ts-ignore
        hidden: true,
      })
      .action(async ({ session, options }, titlesInput = '') => {
        if (!session?.channel) throw new Error('Missing channel context')
        const { mwApi } = session.channel

        // Missing connection init
        if (!mwApi) {
          return options?.quiet ? '' : session.execute('wiki.connect -h')
        }
        // Missing titles
        if (!titlesInput) {
          return getUrl(mwApi)
        }

        // Generate API client
        const api = useApi(mwApi)

        // 去重并缓存用户输入的标题及锚点
        const titles = Array.from(
          new Set(titlesInput.split('|').map(getWikiDisplayTitle)),
        )
          .map((i) => {
            return {
              name: i.split('#')[0],
              anchor: i.split('#')[1] ? '#' + encodeURI(i.split('#')[1]) : '',
            }
          })
          .filter((i) => !!i.name)
          .slice(0, 5)

        const { data } = await api
          .get<MWApiResponseQueryPagesWithSiteinfo>({
            action: 'query',
            prop: 'extracts|info',
            meta: 'siteinfo',
            siprop: 'specialpagealiases|namespacealiases|namespaces',
            iwurl: 1,
            titles: titles.map((i) => i.name),
            redirects: 1,
            converttitles: 1,
            exchars: '120',
            exlimit: 'max',
            explaintext: 1,
            exintro: 1,
            exsectionformat: 'plain',
            inprop: 'url|displaytitle',
          })
          .catch((e) => {
            session.send(`查询时遇到问题：${e || '-'}`)
            throw e
          })

        this.logger.debug('QUERY DATA', data.query)

        // Cache variables
        const { pages, redirects, interwiki, specialpagealiases, namespaces } =
          data.query
        /**
         * @desc 某些特殊页面会暴露服务器 IP 地址，必须特殊处理这些页面
         *       已知的危险页面包括 Mypage Mytalk
         */
        // 这里用标准名称
        const dangerPageNames = ['Mypage', 'Mytalk']
        // 获取全部别名
        const dangerPages = specialpagealiases
          .filter((i) => dangerPageNames.includes(i.realname))
          .map((i) => i.aliases)
          .flat(Infinity) as string[]
        // 获取本地特殊名字空间的标准名称
        const specialNsName = namespaces['-1'].name

        const pageMsgs =
          pages?.map((page) => {
            // Cache variables
            const msg: string[] = []
            let pageRedirect = redirects?.find(({ to }) => to === page.title)
            let pageAnchor =
              titles.find(
                (i) =>
                  i.name.toLocaleLowerCase() === page.title.toLocaleLowerCase(),
              )?.anchor || ''

            // 开始判断危险重定向
            if (
              // 发生重定向
              pageRedirect &&
              // 重定向自特殊页面
              pageRedirect.from.split(':')[0] === specialNsName &&
              // 被标记为危险页面
              dangerPages.includes(
                pageRedirect.from.split(':')?.[1].split('/')[0] || '',
              )
            ) {
              // 覆写页面资料
              page = {
                ...page,
                ns: -1,
                title: pageRedirect.from,
                special: true,
              }
              // 重置重定向信息
              pageRedirect = undefined
              delete page.missing
            }

            const {
              pageid,
              title: pagetitle,
              missing,
              invalid,
              // extract,
              canonicalurl,
              special,
              editurl,
            } = page

            // 打印开头
            msg.push(`您要的“${pagetitle}”：`)
            /** 处理特殊情况 */
            // 重定向
            if (pageRedirect) {
              const { from, to, tofragment } = pageRedirect || {}
              msg.push(
                `重定向：[${from}] → [${to}${
                  tofragment ? '#' + tofragment : ''
                }]`,
              )
              if (tofragment) pageAnchor = '#' + encodeURI(tofragment)
            }
            // 页面名不合法
            if (invalid !== undefined) {
              msg.push(
                `😟页面名称不合法：${
                  JSON.stringify(page.invalidreason) || '原因未知'
                }`,
              )
            }
            // 特殊页面
            else if (special) {
              msg.push(
                `${getUrl(mwApi, {
                  title: pagetitle,
                })}${pageAnchor} (${missing ? '不存在的' : ''}特殊页面)`,
              )
            }
            // 不存在页面
            else if (missing !== undefined) {
              if (!options?.search) {
                msg.push(`${editurl} (💔页面不存在)`)
              } else {
                msg.push(`${editurl}\n💡页面不存在，即将搜索wiki……`)
              }
            } else {
              const shortUrl = getUrl(mwApi, { curid: pageid })
              msg.push(
                (shortUrl.length <= canonicalurl.length
                  ? shortUrl
                  : canonicalurl) + pageAnchor,
              )
            }

            if (options?.details && page.extract) {
              msg.push(page.extract)
            }

            return msg.join('\n')
          }) || []

        const interwikiMsgs =
          interwiki?.map((item) => {
            return [`跨语言链接：`, item.url].join('\n')
          }) || []

        const allMsgList = [...pageMsgs, ...interwikiMsgs]
        let finalMsg: string | h = ''
        if (allMsgList.length === 1) {
          finalMsg = h.quote(session.messageId as string) + allMsgList[0]
        } else if (allMsgList.length > 1) {
          const msgBuilder = new BulkMessageBuilder(session)
          allMsgList.forEach((i) => {
            msgBuilder.botSay(i)
          })
          finalMsg = msgBuilder.prependOriginal().all()
        }

        // 结果有且仅有一个存在的主名字空间的页面
        if (
          pages &&
          pages.length === 1 &&
          pages[0].ns === 0 &&
          !pages[0].missing &&
          !pages[0].invalid
        ) {
          await session.send(finalMsg)
          session.send(await this.shotInfobox(pages[0].canonicalurl, true))
        }
        // 结果有且仅有一个不存在的主名字空间的页面
        else if (
          options?.search &&
          pages.length === 1 &&
          pages[0].ns === 0 &&
          pages[0].missing &&
          !pages[0].invalid
        ) {
          await session.send(finalMsg)
          await session.execute(`wiki.search ${pages[0].title}`)
        }
        // 其他情况
        else {
          return finalMsg
        }
      })

    this.ctx.middleware(async (session, next) => {
      await next()
      const titles = parseTitlesFromText(session.content || '')
      if (!titles.length) {
        return
      }
      session.execute(`wiki -q ${titles.join('|')}`)
    })

    // @command wiki.connect
    // @command wiki.link
    this.ctx
      .command('wiki.connect [api:string]', '将群聊与 MediaWiki 网站连接', {
        authority: this.config.cmdAuthConnect,
      })
      .alias('wiki.link')
      .channelFields(['mwApi'])
      .action(async ({ session }, api) => {
        if (!session?.channel) throw new Error()
        const { channel } = session
        if (!api) {
          return channel.mwApi
            ? `本群已与 ${channel.mwApi} 连接~`
            : '本群未连接到 MediaWiki 网站，请使用“wiki.connect <api网址>”进行连接。'
        } else if (isValidApi(api)) {
          channel.mwApi = api
          await session.channel.$update()
          return session.execute('wiki.connect')
        } else {
          return '输入的不是合法 api.php 网址。'
        }
      })

    // @command wiki.search
    this.ctx
      .command('wiki.search [srsearch:text]')
      .channelFields(['mwApi'])
      .action(async ({ session }, keywords) => {
        if (!session?.channel?.mwApi) {
          return session?.execute('wiki.connect -h')
        }
        if (!keywords) {
          session.sendQueued('要搜索什么呢？(输入空行或句号取消)')
          keywords = (await session.prompt(30 * 1000)).trim()
          if (!keywords || keywords === '.' || keywords === '。') return ''
        }
        const api = useApi(session.channel.mwApi)
        const {
          data: {
            query: { searchinfo, search, pages },
          },
        } = await api.post<MWApiResponsQueryPagesGeneratedBySearch>({
          action: 'query',
          prop: 'extracts',
          list: 'search',
          generator: 'search',
          exchars: '120',
          exintro: 1,
          explaintext: 1,
          exsectionformat: 'plain',
          srsearch: keywords,
          srnamespace: '0',
          srlimit: '5',
          srinfo: 'totalhits',
          srprop: '',
          gsrsearch: keywords,
          gsrnamespace: '0',
          gsrlimit: '5',
        })

        const bulk = new BulkMessageBuilder(session)

        if (search.length < 1) {
          return `💔找不到与“${keywords}”匹配的结果。`
        } else if (search.length === 1) {
          return session.execute(`wiki -d ${search[0].title}`)
        } else {
          bulk.prependOriginal()
          bulk.botSay(
            `🔍关键词“${keywords}”共匹配到 ${
              searchinfo?.totalhits || '∅'
            } 个相关结果，我来简单整理一下前 ${search.length} 个结果：`,
          )
        }
        pages
          .sort((a, b) => a.index - b.index)
          .forEach((item, index: number) => {
            bulk.botSay(
              `(${index + 1}) ${item.title}
${item.extract}
${getUrl(session.channel!.mwApi!, { curid: item.pageid })}`,
            )
          })

        return bulk.all()
      })
  }

  async shotInfobox(url: string, silence = false): Promise<string | h> {
    if (!this.ctx.puppeteer) {
      return silence ? '' : '无法获取截图，请安装 puppeteer 插件后再试~'
    }
    const matched = this.INFOBOX_DEFINITION.find((i) => {
      if (typeof i.match === 'string') {
        return new RegExp(i.match).test(url)
      } else {
        return i.match(new URL(url))
      }
    })
    if (!matched) return ''
    this.logger.info('SHOT_INFOBOX', url, matched.selector)
    const start = Date.now()
    const timeSpend = () => ((Date.now() - start) / 1000).toFixed(3) + 's'

    const pageURL = new URL(url)
    pageURL.searchParams.set('useskin', matched.skin || '')

    let pageLoaded = false
    const page = await this.ctx.puppeteer.page()
    await page.setViewport({ width: 960, height: 720 })

    try {
      // 开始竞速，load 事件触发后最多再等 5s
      await Promise.race([
        page.goto(pageURL.href, {
          timeout: 10 * 1000,
          waitUntil: 'networkidle0',
        }),
        new Promise((resolve) => {
          page.on('load', () => {
            console.info('[TIMER]', 'page loaded', timeSpend())
            pageLoaded = true
            setTimeout(() => resolve(1), 5 * 1000)
          })
        }),
      ])
    } catch (e) {
      console.info('[TIMER]', 'Navigation timeout', timeSpend())
      this.logger.warn(
        'SHOT_INFOBOX',
        'Navigation timeout:',
        `(page HAS ${pageLoaded ? '' : 'NOT'} loaded)`,
        e,
      )

      await page
        .$('.mw-parser-output')
        .then((i) => {
          this.logger.info(
            'SHOT_INFOBOX',
            '`.mw-parser-output` exist, render it anyway',
          )
          pageLoaded = true
          return i
        })
        .catch(() => {})

      if (!pageLoaded) {
        await page.close()
        return ''
      }
    }

    try {
      await page.addStyleTag({ content: getInjectStyles(matched) })
    } catch (e) {
      this.logger.warn('SHOT_INFOBOX', 'Inject styles error', e)
    }

    try {
      const target = await page.$(
        Array.isArray(matched.selector)
          ? matched.selector.join(', ')
          : matched.selector,
      )
      if (!target) {
        this.logger.info('SHOT_INFOBOX', 'Canceled', 'Missing target')
        await page.close()
        return ''
      }
      const img = await target.screenshot({ type: 'jpeg', quality: 85 })
      console.info('[TIMER]', 'OK', timeSpend())
      this.logger.info('SHOT_INFOBOX', 'OK', img)
      await page.close()
      return h.image(img, 'image/jpeg')
    } catch (e) {
      this.logger.warn('SHOT_INFOBOX', 'Failed', e)
      await page?.close()
      return ''
    }
  }
}
